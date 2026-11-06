import type { UserNoteContent } from "../core/note-content.ts";

export interface PendingCardDraft {
  schema: 1;
  vaultPath: string;
  sourceID: string;
  content: UserNoteContent;
  updatedAt: string;
}

const pending = new Map<string, PendingCardDraft>();
type PendingWriteState = {
  latest: PendingCardDraft | null;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
  waiters: Array<{ resolve(): void; reject(error: unknown): void }>;
};
const writes = new Map<string, PendingWriteState>();
const failures = new Map<string, unknown>();
const writeDebounceMs = 100;

function copyDraft(draft: PendingCardDraft): PendingCardDraft {
  return { ...draft, content: { ...draft.content } };
}

export function pendingCardDraftFailure(
  vaultPath: string,
  sourceID: string,
): unknown | null {
  return failures.get(key(vaultPath, sourceID)) ?? null;
}

function key(vaultPath: string, sourceID: string): string {
  return JSON.stringify([vaultPath, sourceID]);
}

async function pathFor(vaultPath: string, sourceID: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key(vaultPath, sourceID)),
  );
  const filename = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const dataDirectory = Zotero.DataDirectory.dir;
  if (!dataDirectory || !PathUtils.isAbsolute(dataDirectory)) {
    throw new Error("Zotero's data directory is unavailable.");
  }
  return PathUtils.join(
    dataDirectory,
    "storage",
    "zotero-obsidian-bridge",
    "pending-cards",
    `${filename}.json`,
  );
}

function validate(
  value: unknown,
  vaultPath: string,
  sourceID: string,
): PendingCardDraft {
  const draft = value as PendingCardDraft | null;
  if (
    !draft ||
    draft.schema !== 1 ||
    draft.vaultPath !== vaultPath ||
    draft.sourceID !== sourceID ||
    typeof draft.content?.title !== "string" ||
    typeof draft.content?.markdown !== "string" ||
    typeof draft.updatedAt !== "string"
  ) {
    throw new Error("The pending card draft is malformed; it was preserved.");
  }
  return draft;
}

export async function readPendingCardDraft(
  vaultPath: string,
  sourceID: string,
): Promise<PendingCardDraft | null> {
  const id = key(vaultPath, sourceID);
  const current = pending.get(id);
  if (current) return copyDraft(current);
  await flushPendingCardDraft(vaultPath, sourceID);
  const path = await pathFor(vaultPath, sourceID);
  if (!(await IOUtils.exists(path))) return null;
  return validate(await IOUtils.readJSON(path), vaultPath, sourceID);
}

export async function listPendingCardDrafts(): Promise<PendingCardDraft[]> {
  for (const id of writes.keys()) {
    const [vaultPath, sourceID] = JSON.parse(id) as [string, string];
    await flushPendingCardDraft(vaultPath, sourceID);
  }
  const dataDirectory = Zotero.DataDirectory.dir;
  if (!dataDirectory || !PathUtils.isAbsolute(dataDirectory)) {
    throw new Error("Zotero's data directory is unavailable.");
  }
  const directory = PathUtils.join(
    dataDirectory,
    "storage",
    "zotero-obsidian-bridge",
    "pending-cards",
  );
  const paths = await IOUtils.getChildren(directory, { ignoreAbsent: true });
  const drafts = new Map<string, PendingCardDraft>();
  for (const path of paths) {
    if (!/^[0-9a-f]{64}\.json$/i.test(PathUtils.split(path).at(-1) ?? ""))
      continue;
    const value = await IOUtils.readJSON(path);
    const draft = value as PendingCardDraft;
    validate(draft, draft?.vaultPath, draft?.sourceID);
    drafts.set(key(draft.vaultPath, draft.sourceID), copyDraft(draft));
  }
  for (const [id, draft] of pending) drafts.set(id, copyDraft(draft));
  return [...drafts.values()];
}

async function writeDraftToDisk(draft: PendingCardDraft): Promise<void> {
  const path = await pathFor(draft.vaultPath, draft.sourceID);
  const directory = PathUtils.parent(path);
  if (!directory) throw new Error("Could not resolve pending card storage.");
  await IOUtils.makeDirectory(directory, {
    createAncestors: true,
    ignoreExisting: true,
  });
  await IOUtils.writeJSON(path, draft, {
    mode: "overwrite",
    tmpPath: `${path}.${crypto.randomUUID()}.tmp`,
    flush: true,
  });
}

function scheduleWrite(id: string, state: PendingWriteState): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    void drainWrites(id, state);
  }, writeDebounceMs);
}

async function drainWrites(
  id: string,
  state: PendingWriteState,
): Promise<void> {
  if (state.inFlight) return state.inFlight;
  const operation = (async () => {
    try {
      while (state.latest) {
        const next = state.latest;
        state.latest = null;
        await writeDraftToDisk(next);
      }
      failures.delete(id);
      for (const waiter of state.waiters.splice(0)) waiter.resolve();
    } catch (error) {
      failures.set(id, error);
      for (const waiter of state.waiters.splice(0)) waiter.reject(error);
    }
  })();
  state.inFlight = operation;
  try {
    await operation;
  } finally {
    state.inFlight = null;
    if (state.latest) {
      void drainWrites(id, state);
    } else if (writes.get(id) === state && !state.timer) {
      writes.delete(id);
    }
  }
}

export function writePendingCardDraft(draft: PendingCardDraft): Promise<void> {
  validate(draft, draft.vaultPath, draft.sourceID);
  const id = key(draft.vaultPath, draft.sourceID);
  const copy = copyDraft(draft);
  pending.set(id, copy);
  let state = writes.get(id);
  if (!state) {
    state = { latest: null, timer: null, inFlight: null, waiters: [] };
    writes.set(id, state);
  }
  state.latest = copy;
  const operation = new Promise<void>((resolve, reject) => {
    state!.waiters.push({ resolve, reject });
  });
  scheduleWrite(id, state);
  return operation;
}

export async function flushPendingCardDraft(
  vaultPath: string,
  sourceID: string,
): Promise<void> {
  const id = key(vaultPath, sourceID);
  let state = writes.get(id);
  while (state) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    try {
      await drainWrites(id, state);
    } catch (error) {
      if (!state.latest && !state.inFlight) throw error;
    }
    if (state.latest || state.inFlight || state.timer) continue;
    if (writes.get(id) === state) writes.delete(id);
    state = writes.get(id);
  }
  if (failures.has(id)) throw failures.get(id);
}

export async function deletePendingCardDraft(
  vaultPath: string,
  sourceID: string,
  expected?: PendingCardDraft,
): Promise<boolean> {
  const id = key(vaultPath, sourceID);
  await flushPendingCardDraft(vaultPath, sourceID);
  const operation = (async () => {
    const path = await pathFor(vaultPath, sourceID);
    const current =
      pending.get(id) ??
      ((await IOUtils.exists(path))
        ? validate(await IOUtils.readJSON(path), vaultPath, sourceID)
        : null);
    if (
      expected &&
      (!current ||
        current.updatedAt !== expected.updatedAt ||
        current.content.title !== expected.content.title ||
        current.content.markdown !== expected.content.markdown)
    ) {
      return false;
    }
    await IOUtils.remove(path, { ignoreAbsent: true });
    pending.delete(id);
    failures.delete(id);
    return true;
  })();
  return operation;
}
