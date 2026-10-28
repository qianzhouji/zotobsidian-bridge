import {
  findCardByFrontmatter,
  findMarkdownByFrontmatter,
  listMarkdownFiles,
  makeIndexEntry,
  readCardIndex,
  readSyncTaskLog,
  readVaultFile,
  writeCardIndex,
  writeSyncTaskLog,
} from "../adapters/vault-storage.ts";
import {
  formatPaperSourceBlock,
  formatSourceBlock,
  readFrontmatterValue,
} from "../core/markdown.ts";
import {
  annotationSourceID,
  libraryIdentityKey,
  noteSourceID,
  validateVaultRelativePath,
} from "../core/models.ts";
import type {
  AnnotationRecord,
  LibraryIdentity,
  PaperRecord,
  SyncTask,
  SyncTaskLog,
  SyncTaskStatus,
} from "../core/models.ts";
import {
  updateCardSourceContent,
  updateCardSourceFields,
  updatePaperSource,
} from "./card-updater.ts";
import { snapshotNativeNote } from "./native-note-card.ts";
import { exportAnnotationImage } from "./image-assets.ts";

const prefPrefix = "extensions.zotero.zoteroobsidianbridge";
const defaultOutputFolder = "Zotero Literature";
const debounceMs = 1000;
const maximumAutomaticAttempts = 5;
const tasks = new Map<string, SyncTask>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Set<string>();
const dirtyDuringRun = new Map<string, string>();
const notifierEvents: NotifierEvent[] = [];
let eventTimer: ReturnType<typeof setTimeout> | null = null;
let loaded = false;
let stopped = false;
let lastLoadError = "";
let persistenceQueue: Promise<void> = Promise.resolve();
let workerQueue: Promise<void> = Promise.resolve();

interface NotifierEvent {
  event: _ZoteroTypes.Notifier.Event;
  type: _ZoteroTypes.Notifier.Type;
  ids: Array<string | number>;
  extraData: unknown;
}

export interface SyncStatus {
  counts: Record<SyncTaskStatus, number>;
  tasks: SyncTask[];
  error: string;
}

function pref(name: string): string {
  const value = Zotero.Prefs.get(`${prefPrefix}.${name}`, true);
  return typeof value === "string" ? value.trim() : "";
}

function vaultPath(): string {
  const value = pref("vaultPath");
  return value && PathUtils.isAbsolute(value)
    ? PathUtils.normalize(value)
    : value;
}

function outputFolder(): string {
  return validateVaultRelativePath(pref("outputFolder") || defaultOutputFolder);
}

function taskLogPath(): string {
  const directory = Zotero.DataDirectory.dir;
  if (!directory || !PathUtils.isAbsolute(directory)) {
    throw new Error("Zotero's data directory is unavailable.");
  }
  return PathUtils.join(
    directory,
    "storage",
    "zotero-obsidian-bridge",
    "sync-tasks.json",
  );
}

function log(message: string): void {
  Zotero.debug(`[Zotero Obsidian Bridge] ${message}`);
}

function identityForLibraryID(libraryID: number): LibraryIdentity {
  const library = Zotero.Libraries.get(libraryID);
  if (!library) throw new Error(`Zotero library ${libraryID} was not found.`);
  return {
    type: library.libraryType,
    typeID: library.libraryTypeID,
  };
}

function parseSourceID(sourceID: string): {
  identity: LibraryIdentity;
  kind: "annotation" | "note";
  key: string;
} {
  const match = /^(user|group|feed):(\d+)\/(annotation|note)\/([^/]+)$/.exec(
    sourceID,
  );
  if (!match)
    throw new SyncConflictError(`Unsupported source identity: ${sourceID}`);
  return {
    identity: {
      type: match[1] as LibraryIdentity["type"],
      typeID: Number(match[2]),
    },
    kind: match[3] as "annotation" | "note",
    key: match[4],
  };
}

function findLibraryID(identity: LibraryIdentity): number {
  const library = Zotero.Libraries.getAll().find(
    (candidate) =>
      candidate.libraryType === identity.type &&
      candidate.libraryTypeID === identity.typeID,
  );
  if (!library) {
    throw new Error(
      `Zotero library ${libraryIdentityKey(identity)} is currently unavailable.`,
    );
  }
  return library.libraryID;
}

function annotationID(item: Zotero.Item): string {
  return annotationSourceID(identityForLibraryID(item.libraryID), item.key);
}

function makeConflict(message: string): Error {
  return new SyncConflictError(message);
}

class SyncConflictError extends Error {}

async function persistTasks(): Promise<void> {
  const snapshot: SyncTaskLog = {
    bridge_schema: 1,
    tasks: [...tasks.values()].sort((left, right) =>
      left.updatedAt.localeCompare(right.updatedAt),
    ),
  };
  const path = taskLogPath();
  const write = persistenceQueue.then(() => writeSyncTaskLog(path, snapshot));
  persistenceQueue = write.catch((error) => {
    lastLoadError = `Could not persist sync state: ${String(error)}`;
    log(lastLoadError);
  });
  await write;
}

function clearTimer(sourceID: string): void {
  const timer = timers.get(sourceID);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(sourceID);
}

function schedule(sourceID: string, delay = debounceMs): void {
  if (stopped) return;
  clearTimer(sourceID);
  timers.set(
    sourceID,
    setTimeout(() => {
      timers.delete(sourceID);
      void runTask(sourceID);
    }, delay),
  );
}

function pruneCompletedTasks(): void {
  const completed = [...tasks.values()]
    .filter((task) => task.status === "done")
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  for (const task of completed.slice(0, Math.max(0, completed.length - 200))) {
    tasks.delete(task.sourceID);
  }
}

async function enqueueSources(
  sourceIDs: string[],
  event: string,
  requireDurable = false,
): Promise<boolean> {
  if (!loaded) await startSyncQueue();
  const uniqueSourceIDs = [...new Set(sourceIDs)];
  let changed = false;
  let deferredWhileRunning = false;
  for (const sourceID of uniqueSourceIDs) {
    try {
      parseSourceID(sourceID);
    } catch (error) {
      log(String(error));
      continue;
    }
    if (running.has(sourceID)) {
      dirtyDuringRun.set(sourceID, event);
      deferredWhileRunning = true;
      continue;
    }
    const previous = tasks.get(sourceID);
    tasks.set(sourceID, {
      id: previous?.id ?? crypto.randomUUID(),
      sourceID,
      status: "pending",
      attempts: 0,
      updatedAt: new Date().toISOString(),
      lastEvent: event,
    });
    changed = true;
  }
  if (!changed) return !deferredWhileRunning;
  pruneCompletedTasks();
  try {
    await persistTasks();
  } catch (error) {
    log(
      `Sync task is queued in memory but could not be saved: ${String(error)}`,
    );
    if (requireDurable) throw error;
    return false;
  }
  for (const sourceID of uniqueSourceIDs) {
    if (tasks.get(sourceID)?.status === "pending") schedule(sourceID);
  }
  return !deferredWhileRunning;
}

function scheduleRetry(task: SyncTask): void {
  if (task.attempts >= maximumAutomaticAttempts) return;
  const delay = Math.min(60_000, 1000 * 2 ** Math.max(0, task.attempts - 1));
  schedule(task.sourceID, delay);
}

async function runTask(sourceID: string): Promise<void> {
  const task = tasks.get(sourceID);
  if (!task || (task.status !== "pending" && task.status !== "retry")) return;
  if (running.has(sourceID)) return;
  running.add(sourceID);

  const job = workerQueue.then(async () => {
    const current = tasks.get(sourceID);
    if (!current || stopped) return;
    current.status = "running";
    current.updatedAt = new Date().toISOString();
    current.lastError = undefined;

    try {
      await persistTasks();
      const parsed = parseSourceID(current.sourceID);
      if (parsed.kind === "note") {
        await syncNativeNoteSource(
          current.sourceID,
          current.lastEvent || "modify",
        );
      } else {
        await syncAnnotationSource(
          current.sourceID,
          current.lastEvent || "modify",
        );
      }
      current.status = "done";
      current.lastError = undefined;
      current.attempts = 0;
    } catch (error) {
      current.attempts++;
      current.lastError = String(error);
      current.status = isCardConflict(error) ? "conflict" : "retry";
      log(`Sync ${current.status} for ${sourceID}: ${String(error)}`);
    }
    current.updatedAt = new Date().toISOString();
    await persistTasks().catch((error) => log(String(error)));
    if (current.status === "retry") scheduleRetry(current);
  });
  workerQueue = job.then(
    () => undefined,
    (error) => log(`Sync worker failed: ${String(error)}`),
  );

  try {
    await job;
  } finally {
    running.delete(sourceID);
    const dirtyEvent = dirtyDuringRun.get(sourceID);
    if (dirtyEvent) {
      dirtyDuringRun.delete(sourceID);
      const current = tasks.get(sourceID);
      tasks.set(sourceID, {
        id: current?.id ?? crypto.randomUUID(),
        sourceID,
        status: "pending",
        attempts: 0,
        updatedAt: new Date().toISOString(),
        lastEvent: dirtyEvent,
      });
      await persistTasks().catch((error) => log(String(error)));
      schedule(sourceID);
    }
  }
}

function isCardConflict(error: unknown): boolean {
  return (
    error instanceof SyncConflictError ||
    /malformed|unsupported schema|identity changed|ambiguous|refusing|suspended|source section|frontmatter|outside the configured|normalized relative paths|symbolic link/i.test(
      String(error),
    )
  );
}

function indexPath(): string {
  const directory = Zotero.DataDirectory.dir;
  if (!directory || !PathUtils.isAbsolute(directory)) {
    throw new Error("Zotero's data directory is unavailable.");
  }
  return PathUtils.join(
    directory,
    "storage",
    "zotero-obsidian-bridge",
    "cards.json",
  );
}

async function locateCard(
  sourceID: string,
  index: Awaited<ReturnType<typeof readCardIndex>>,
  rootPath: string,
  folder: string,
): Promise<{ cardID: string; relativePath: string; markdown: string } | null> {
  const suspended = index.suspendedCards[sourceID];
  if (suspended) {
    throw makeConflict(
      `Card ${suspended.cardID} is suspended because it is missing from the output folder. Restore it there and retry.`,
    );
  }

  const entry = index.cards[sourceID];
  if (entry) {
    const markdown = await readVaultFile(rootPath, entry.relativePath);
    if (markdown !== null) {
      assertCardIdentity(markdown, sourceID, entry.cardID);
      return { ...entry, markdown };
    }
    const moved = await findCardByFrontmatter(
      rootPath,
      folder,
      "bridge_card_id",
      entry.cardID,
    );
    if (moved) {
      const movedMarkdown = await readVaultFile(rootPath, moved);
      if (movedMarkdown === null)
        throw new Error("Moved card disappeared during sync.");
      assertCardIdentity(movedMarkdown, sourceID, entry.cardID);
      index.cards[sourceID] = makeIndexEntry(entry.cardID, moved);
      await writeCardIndex(indexPath(), index);
      return {
        cardID: entry.cardID,
        relativePath: moved,
        markdown: movedMarkdown,
      };
    }
    index.suspendedCards[sourceID] = {
      cardID: entry.cardID,
      relativePath: entry.relativePath,
      suspendedAt: new Date().toISOString(),
      reason: "missing",
    };
    delete index.cards[sourceID];
    await writeCardIndex(indexPath(), index);
    throw makeConflict(
      `Card ${entry.cardID} was removed from the output folder and is suspended; it will not be recreated automatically.`,
    );
  }

  const discovered = await findCardByFrontmatter(
    rootPath,
    folder,
    "bridge_source_id",
    sourceID,
  );
  if (!discovered) return null;
  const markdown = await readVaultFile(rootPath, discovered);
  if (markdown === null)
    throw new Error("Discovered card disappeared during sync.");
  const cardID = readFrontmatterValue(markdown, "bridge_card_id");
  if (typeof cardID !== "string" || !cardID) {
    throw makeConflict("Matching card has no valid bridge_card_id.");
  }
  assertCardIdentity(markdown, sourceID, cardID);
  index.cards[sourceID] = makeIndexEntry(cardID, discovered);
  delete index.suspendedCards[sourceID];
  await writeCardIndex(indexPath(), index);
  return { cardID, relativePath: discovered, markdown };
}

function assertCardIdentity(
  markdown: string,
  sourceID: string,
  cardID: string,
): void {
  if (
    readFrontmatterValue(markdown, "bridge_source_id") !== sourceID ||
    readFrontmatterValue(markdown, "bridge_card_id") !== cardID
  ) {
    throw makeConflict(
      "Card identity changed or is ambiguous; no content was overwritten.",
    );
  }
}

function getPageIndex(annotation: Zotero.Item): number | null {
  try {
    const position = JSON.parse(annotation.annotationPosition);
    const pageIndex = Number(position?.pageIndex);
    return Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : null;
  } catch {
    return null;
  }
}

function makePaperRecord(
  annotation: Zotero.Item,
  attachment: Zotero.Item,
  parent: Zotero.Item | null,
  identity: LibraryIdentity,
): PaperRecord {
  const libraryPath =
    identity.type === "group"
      ? `groups/${identity.typeID}`
      : identity.type === "feed"
        ? `feeds/${identity.typeID}`
        : "library";
  const item = parent ?? attachment;
  return {
    identity,
    key: item.key,
    title: item.getField("title") || "Untitled paper",
    creator: parent?.getField("firstCreator") || "",
    date: parent?.getField("date") || "",
    publication: parent?.getField("publicationTitle") || "",
    doi: parent?.getField("DOI") || "",
    zoteroURI: `zotero://select/${libraryPath}/items/${item.key}`,
  };
}

function makeAnnotationRecord(
  annotation: Zotero.Item,
  attachment: Zotero.Item,
  identity: LibraryIdentity,
): AnnotationRecord {
  const pageIndex = getPageIndex(annotation);
  const pageQuery = pageIndex === null ? "" : `?page=${pageIndex + 1}`;
  const libraryPath =
    identity.type === "group"
      ? `groups/${identity.typeID}`
      : identity.type === "feed"
        ? `feeds/${identity.typeID}`
        : "library";
  return {
    identity,
    key: annotation.key,
    attachmentKey: attachment.key,
    pageIndex,
    pageLabel: annotation.annotationPageLabel,
    color: annotation.annotationColor,
    text: annotation.annotationText,
    comment: annotation.annotationComment,
    zoteroURI: `zotero://open-pdf/${libraryPath}/items/${attachment.key}${pageQuery}`,
  };
}

function annotationFields(
  paper: PaperRecord,
  annotation: AnnotationRecord,
  contentHash: string,
  status: "available" | "missing",
): Record<string, unknown> {
  return {
    bridge_source_status: status,
    bridge_source_missing_at:
      status === "missing" ? new Date().toISOString() : null,
    bridge_source_missing_reason: null,
    bridge_source_hash: contentHash,
    zotero_library: libraryIdentityKey(annotation.identity),
    zotero_library_id: annotation.identity.typeID,
    zotero_paper_key: paper.key,
    zotero_paper_title: paper.title,
    zotero_creator: paper.creator || null,
    zotero_date: paper.date || null,
    zotero_publication: paper.publication || null,
    zotero_doi: paper.doi || null,
    zotero_attachment_key: annotation.attachmentKey,
    zotero_annotation_key: annotation.key,
    zotero_page_index: annotation.pageIndex,
    zotero_page_label: annotation.pageLabel || null,
    zotero_annotation_color: annotation.color || null,
    zotero_uri: annotation.zoteroURI,
  };
}

async function sha256(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function markSourceMissing(
  sourceID: string,
  located: { cardID: string; relativePath: string; markdown: string },
  reason: string,
): Promise<void> {
  if (
    readFrontmatterValue(located.markdown, "bridge_source_status") ===
      "missing" &&
    readFrontmatterValue(located.markdown, "bridge_source_missing_reason") ===
      reason
  ) {
    return;
  }
  await updateCardSourceFields(
    vaultPath(),
    located.relativePath,
    located.cardID,
    {
      bridge_source_status: "missing",
      bridge_source_missing_at: new Date().toISOString(),
      bridge_source_missing_reason: reason,
    },
  );
  log(`Marked source missing without deleting card: ${sourceID} (${reason})`);
}

async function updatePaperOverview(
  paper: PaperRecord,
  sourceHash: string,
  status: "available" | "missing",
): Promise<void> {
  const rootPath = vaultPath();
  const folder = outputFolder();
  const fields = {
    type: "zotero-paper",
    bridge_paper_id: `${libraryIdentityKey(paper.identity)}/paper/${paper.key}`,
    bridge_source_id: `${libraryIdentityKey(paper.identity)}/paper/${paper.key}`,
    zotero_library: libraryIdentityKey(paper.identity),
    zotero_item_key: paper.key,
  };
  const matches = await findMarkdownByFrontmatter(rootPath, folder, fields);
  if (matches.length > 1) {
    throw makeConflict(
      `More than one paper overview matches ${libraryIdentityKey(paper.identity)}/${paper.key}.`,
    );
  }
  if (!matches.length) return;
  const markdown = await readVaultFile(rootPath, matches[0]);
  if (markdown === null) return;
  if (
    readFrontmatterValue(markdown, "bridge_source_hash") === sourceHash &&
    readFrontmatterValue(markdown, "bridge_source_status") === status
  ) {
    return;
  }
  await updatePaperSource(
    rootPath,
    matches[0],
    libraryIdentityKey(paper.identity),
    paper.key,
    {
      bridge_source_hash: sourceHash,
      bridge_source_status: status,
      bridge_source_missing_at:
        status === "missing" ? new Date().toISOString() : null,
      zotero_title: paper.title,
      zotero_creator: paper.creator || null,
      zotero_date: paper.date || null,
      zotero_publication: paper.publication || null,
      zotero_doi: paper.doi || null,
      zotero_uri: paper.zoteroURI,
    },
    formatPaperSourceBlock(paper.title, paper.zoteroURI),
  );
}

async function syncAnnotationSource(
  sourceID: string,
  lastEvent: string,
): Promise<void> {
  const { identity, key: annotationKey } = parseSourceID(sourceID);
  const rootPath = vaultPath();
  const folder = outputFolder();
  const index = await readCardIndex(indexPath());
  const located = await locateCard(sourceID, index, rootPath, folder);
  if (!located) return;

  const libraryID = findLibraryID(identity);
  const item = await Zotero.Items.getByLibraryAndKeyAsync(
    libraryID,
    annotationKey,
  );
  if (!item || item.deleted || !item.isAnnotation()) {
    const reason = ["delete", "trash"].includes(lastEvent)
      ? "zotero-deleted"
      : "source-not-found";
    await markSourceMissing(sourceID, located, reason);
    return;
  }

  const attachment = item.parentItem;
  if (!attachment || !attachment.isAttachment()) {
    await markSourceMissing(sourceID, located, "attachment-unavailable");
    return;
  }
  const parent = attachment.parentItemID
    ? await Zotero.Items.getAsync(attachment.parentItemID)
    : null;
  const paper = makePaperRecord(item, attachment, parent || null, identity);
  const annotation = makeAnnotationRecord(item, attachment, identity);
  const image = await exportAnnotationImage(
    item,
    attachment,
    rootPath,
    located.relativePath,
    located.cardID,
    sourceID,
  );
  const sourceBlock = formatSourceBlock(
    annotation.text,
    annotation.comment,
    annotation.pageLabel ? `Page ${annotation.pageLabel}` : "Annotation",
    annotation.zoteroURI,
    annotation.color,
    image ? `![Zotero annotation image](${image.markdownPath})` : "",
  );
  const sourceHash = await sha256({
    paper,
    annotation,
    imageHash: image?.sha256 ?? null,
  });
  const fields = annotationFields(paper, annotation, sourceHash, "available");
  const paperHash = await sha256(paper);
  await updatePaperOverview(paper, paperHash, "available");

  if (
    readFrontmatterValue(located.markdown, "bridge_source_hash") ===
      sourceHash &&
    readFrontmatterValue(located.markdown, "bridge_source_status") ===
      "available"
  ) {
    return;
  }
  await updateCardSourceContent(
    rootPath,
    located.relativePath,
    located.cardID,
    fields,
    sourceBlock,
  );
}

async function syncNativeNoteSource(
  sourceID: string,
  lastEvent: string,
): Promise<void> {
  const parsed = parseSourceID(sourceID);
  if (parsed.kind !== "note") {
    throw makeConflict(`Expected a Zotero note source: ${sourceID}`);
  }
  const rootPath = vaultPath();
  const folder = outputFolder();
  const index = await readCardIndex(indexPath());
  const located = await locateCard(sourceID, index, rootPath, folder);
  if (!located) return;

  const libraryID = findLibraryID(parsed.identity);
  const item = await Zotero.Items.getByLibraryAndKeyAsync(
    libraryID,
    parsed.key,
  );
  if (!item || item.deleted || !item.isNote()) {
    const reason = ["delete", "trash"].includes(lastEvent)
      ? "zotero-deleted"
      : "zotero-note-unavailable";
    await markSourceMissing(sourceID, located, reason);
    return;
  }
  const snapshot = await snapshotNativeNote(item, {
    relativePath: located.relativePath,
    cardID: located.cardID,
  });
  if (
    readFrontmatterValue(located.markdown, "bridge_source_hash") ===
      snapshot.sourceHash &&
    readFrontmatterValue(located.markdown, "bridge_source_status") ===
      "available"
  ) {
    return;
  }
  await updateCardSourceContent(
    rootPath,
    located.relativePath,
    located.cardID,
    snapshot.fields,
    snapshot.sourceBlock,
  );
}

async function linkedSourcesForPaper(
  identity: LibraryIdentity,
  paperKey: string,
): Promise<string[]> {
  const index = await readCardIndex(indexPath());
  const rootPath = vaultPath();
  const folder = outputFolder();
  const expectedLibrary = libraryIdentityKey(identity);
  const linked: string[] = [];
  for (const sourceID of Object.keys(index.cards)) {
    try {
      const parsed = parseSourceID(sourceID);
      if (libraryIdentityKey(parsed.identity) !== expectedLibrary) continue;
      const located = await locateCard(sourceID, index, rootPath, folder);
      if (!located) continue;
      const linkedKey =
        parsed.kind === "note"
          ? readFrontmatterValue(located.markdown, "zotero_parent_item_key")
          : readFrontmatterValue(located.markdown, "zotero_paper_key");
      if (linkedKey === paperKey) {
        linked.push(sourceID);
      }
    } catch (error) {
      log(
        `Skipped a linked card while resolving paper changes: ${String(error)}`,
      );
    }
  }
  return linked;
}

async function linkedSourcesFromOutput(): Promise<string[]> {
  const rootPath = vaultPath();
  const folder = outputFolder();
  const index = await readCardIndex(indexPath());
  const sourceIDs = new Set(Object.keys(index.cards));
  for (const relativePath of await listMarkdownFiles(rootPath, folder)) {
    const markdown = await readVaultFile(rootPath, relativePath);
    if (markdown === null) continue;
    try {
      if (
        !["zotero-annotation", "zotero-note"].includes(
          String(readFrontmatterValue(markdown, "type")),
        )
      )
        continue;
      const sourceID = readFrontmatterValue(markdown, "bridge_source_id");
      if (typeof sourceID === "string") sourceIDs.add(sourceID);
    } catch {
      // Damaged notes stay untouched and are excluded from automatic reconciliation.
    }
  }
  return [...sourceIDs];
}

export async function queueSourceSync(
  sourceID: string,
  event = "manual",
  requireDurable = false,
): Promise<void> {
  const persisted = await enqueueSources([sourceID], event, requireDurable);
  if (requireDurable && !persisted) {
    throw new Error(
      "Source reconciliation is waiting for an active sync task.",
    );
  }
}

function snapshotItems(extraData: unknown): Zotero.Item[] {
  const values: unknown[] = Array.isArray(extraData)
    ? extraData
    : extraData && typeof extraData === "object"
      ? Object.values(extraData as Record<string, unknown>)
      : [];
  return values.filter(
    (value): value is Zotero.Item =>
      Boolean(value) &&
      typeof value === "object" &&
      typeof (value as Zotero.Item).key === "string" &&
      Number.isSafeInteger((value as Zotero.Item).libraryID),
  );
}

function itemKind(
  item: Zotero.Item,
): "annotation" | "note" | "attachment" | "paper" {
  if (item.isAnnotation()) return "annotation";
  if (typeof item.isNote === "function" && item.isNote()) return "note";
  if (item.isAttachment()) return "attachment";
  return "paper";
}

async function sourcesForItem(item: Zotero.Item): Promise<string[]> {
  const kind = itemKind(item);
  if (kind === "annotation") return [annotationID(item)];
  if (kind === "note") {
    return [noteSourceID(identityForLibraryID(item.libraryID), item.key)];
  }
  if (kind === "attachment") {
    if (item.isEmbeddedImageAttachment()) {
      const parent = item.parentItemID
        ? await Zotero.Items.getAsync(item.parentItemID)
        : null;
      if (parent?.isNote()) {
        return [
          noteSourceID(identityForLibraryID(parent.libraryID), parent.key),
        ];
      }
    }
    return item.getAnnotations(true).map(annotationID);
  }
  return linkedSourcesForPaper(identityForLibraryID(item.libraryID), item.key);
}

async function processNotifierEvent(event: NotifierEvent): Promise<void> {
  if ((event.type as string) === "trash") {
    await reconcileLinkedCards();
    return;
  }
  if (event.type !== "item") return;
  if (!["add", "modify", "delete", "trash", "refresh"].includes(event.event)) {
    return;
  }

  const sources = new Set<string>();
  if (event.event === "delete") {
    for (const item of snapshotItems(event.extraData)) {
      for (const sourceID of await sourcesForItem(item)) sources.add(sourceID);
    }
    if (sources.size === 0) {
      for (const sourceID of await linkedSourcesFromOutput())
        sources.add(sourceID);
    }
  } else {
    for (const id of event.ids) {
      const item = await Zotero.Items.getAsync(id);
      if (!item) continue;
      for (const sourceID of await sourcesForItem(item)) sources.add(sourceID);
    }
  }
  await enqueueSources([...sources], event.event);
}

export function handleNotifierEvent(
  event: _ZoteroTypes.Notifier.Event,
  type: _ZoteroTypes.Notifier.Type,
  ids: string[] | number[],
  extraData: unknown,
): void {
  if (stopped) return;
  notifierEvents.push({ event, type, ids: [...ids], extraData });
  if (eventTimer !== null) return;
  eventTimer = setTimeout(() => {
    eventTimer = null;
    const batch = notifierEvents.splice(0);
    void Promise.all(
      batch.map((entry) =>
        processNotifierEvent(entry).catch((error) =>
          log(`Notifier event could not be queued: ${String(error)}`),
        ),
      ),
    );
  }, 0);
}

export async function reconcileLinkedCards(): Promise<void> {
  const sourceIDs = await linkedSourcesFromOutput();
  await enqueueSources(sourceIDs, "reconcile");
}

export async function retryFailedSyncTasks(): Promise<void> {
  if (!loaded) await startSyncQueue();
  const retryable = [...tasks.values()].filter(
    (task) => task.status === "retry" || task.status === "conflict",
  );
  for (const task of retryable) {
    task.status = "pending";
    task.attempts = 0;
    task.updatedAt = new Date().toISOString();
    task.lastError = undefined;
    task.lastEvent = "manual-retry";
  }
  if (!retryable.length) return;
  await persistTasks();
  for (const task of retryable) schedule(task.sourceID, 0);
}

export async function retrySyncTask(sourceID: string): Promise<void> {
  if (!loaded) await startSyncQueue();
  const task = tasks.get(sourceID);
  if (!task || (task.status !== "retry" && task.status !== "conflict")) return;
  task.status = "pending";
  task.attempts = 0;
  task.updatedAt = new Date().toISOString();
  task.lastError = undefined;
  task.lastEvent = "manual-retry-single";
  await persistTasks();
  schedule(sourceID, 0);
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const counts: Record<SyncTaskStatus, number> = {
    pending: 0,
    running: 0,
    done: 0,
    retry: 0,
    conflict: 0,
  };
  let currentTasks: SyncTask[];
  let error = lastLoadError;
  try {
    if (!loaded) {
      currentTasks = (await readSyncTaskLog(taskLogPath())).tasks;
    } else {
      currentTasks = [...tasks.values()];
    }
  } catch (reason) {
    currentTasks = [];
    error = String(reason);
  }
  for (const task of currentTasks) counts[task.status]++;
  return {
    counts,
    tasks: currentTasks
      .filter((task) => task.status === "retry" || task.status === "conflict")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 10),
    error,
  };
}

export async function startSyncQueue(): Promise<void> {
  if (loaded) {
    stopped = false;
    for (const task of tasks.values()) {
      if (task.status === "pending" || task.status === "retry") {
        schedule(task.sourceID, 0);
      }
    }
    return;
  }
  stopped = false;
  try {
    const taskLog = await readSyncTaskLog(taskLogPath());
    for (const task of taskLog.tasks) {
      tasks.set(task.sourceID, {
        ...task,
        status: task.status === "running" ? "pending" : task.status,
        updatedAt: new Date().toISOString(),
      });
    }
    loaded = true;
    const sources = await linkedSourcesFromOutput();
    for (const sourceID of sources) {
      const current = tasks.get(sourceID);
      if (!current || current.status === "done") {
        tasks.set(sourceID, {
          id: current?.id ?? crypto.randomUUID(),
          sourceID,
          status: "pending",
          attempts: 0,
          updatedAt: new Date().toISOString(),
          lastEvent: "startup-reconcile",
        });
      }
    }
    await persistTasks();
    for (const task of tasks.values()) {
      if (task.status === "pending" || task.status === "retry") {
        schedule(task.sourceID, 0);
      }
    }
  } catch (error) {
    loaded = false;
    lastLoadError = String(error);
    log(`Sync queue startup failed: ${lastLoadError}`);
  }
}

export async function stopSyncQueue(): Promise<void> {
  stopped = true;
  if (eventTimer !== null) clearTimeout(eventTimer);
  eventTimer = null;
  notifierEvents.length = 0;
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  await workerQueue;
  await persistenceQueue;
}

export async function flushSyncQueue(): Promise<void> {
  const sourceIDs = [...timers.keys()];
  for (const sourceID of sourceIDs) clearTimer(sourceID);
  await Promise.all(sourceIDs.map((sourceID) => runTask(sourceID)));
  await workerQueue;
}
