import type { UserNoteContent } from "../core/note-content.ts";

export interface EditorDraft {
  schema: 1;
  cardID: string;
  sourceID: string;
  relativePath: string;
  baseline: UserNoteContent;
  draft: UserNoteContent;
  updatedAt: string;
}

export interface EditorConflictArchive extends EditorDraft {
  disk: UserNoteContent;
  resolution: "use-disk" | "keep-local" | "restore-copy";
  archivedAt: string;
}

export interface EditorConflictRecoveryCopy extends EditorConflictArchive {
  recoveryID: string;
}

const storageDirectory = "zotero-obsidian-bridge";
const cardIDPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dataDirectory(): string {
  const root = Zotero.DataDirectory.dir;
  if (!root || !PathUtils.isAbsolute(root)) {
    throw new Error("Zotero's data directory is unavailable.");
  }
  return PathUtils.join(root, "storage", storageDirectory);
}

function assertCardID(cardID: string): void {
  if (!cardIDPattern.test(cardID)) {
    throw new Error("Invalid card ID for editor draft storage.");
  }
}

function isUserNoteContent(value: unknown): value is UserNoteContent {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as UserNoteContent).title === "string" &&
    typeof (value as UserNoteContent).markdown === "string",
  );
}

function validateDraft(value: unknown, expectedCardID: string): EditorDraft {
  const draft = value as EditorDraft | null;
  if (
    !draft ||
    draft.schema !== 1 ||
    draft.cardID !== expectedCardID ||
    typeof draft.sourceID !== "string" ||
    typeof draft.relativePath !== "string" ||
    !isUserNoteContent(draft.baseline) ||
    !isUserNoteContent(draft.draft) ||
    typeof draft.updatedAt !== "string"
  ) {
    throw new Error("Saved editor draft is malformed; it was left untouched.");
  }
  return draft;
}

function validateConflictArchive(
  value: unknown,
  expectedCardID: string,
): EditorConflictArchive {
  const archive = value as EditorConflictArchive | null;
  if (
    !archive ||
    archive.schema !== 1 ||
    archive.cardID !== expectedCardID ||
    typeof archive.sourceID !== "string" ||
    typeof archive.relativePath !== "string" ||
    !isUserNoteContent(archive.baseline) ||
    !isUserNoteContent(archive.disk) ||
    !isUserNoteContent(archive.draft) ||
    typeof archive.updatedAt !== "string" ||
    !["use-disk", "keep-local", "restore-copy"].includes(archive.resolution) ||
    typeof archive.archivedAt !== "string"
  ) {
    throw new Error("Saved recovery copy is malformed; it was left untouched.");
  }
  return archive;
}

function draftPath(cardID: string): string {
  assertCardID(cardID);
  return PathUtils.join(dataDirectory(), "editor-drafts", `${cardID}.json`);
}

async function writeJSONAtomically(
  filePath: string,
  value: unknown,
  mode: "create" | "overwrite",
): Promise<void> {
  const directory = PathUtils.parent(filePath);
  if (!directory) throw new Error("Could not resolve editor storage path.");
  await IOUtils.makeDirectory(directory, {
    createAncestors: true,
    ignoreExisting: true,
  });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await IOUtils.writeJSON(filePath, value, {
    mode,
    tmpPath: temporaryPath,
    flush: true,
  });
}

export async function readEditorDraft(
  cardID: string,
): Promise<EditorDraft | null> {
  const filePath = draftPath(cardID);
  if (!(await IOUtils.exists(filePath))) return null;
  return validateDraft(await IOUtils.readJSON(filePath), cardID);
}

export async function writeEditorDraft(draft: EditorDraft): Promise<void> {
  assertCardID(draft.cardID);
  await writeJSONAtomically(draftPath(draft.cardID), draft, "overwrite");
}

export async function deleteEditorDraft(cardID: string): Promise<void> {
  const filePath = draftPath(cardID);
  await IOUtils.remove(filePath, { ignoreAbsent: true });
}

export async function archiveEditorConflict(
  conflict: EditorConflictArchive,
): Promise<string> {
  assertCardID(conflict.cardID);
  const filePath = PathUtils.join(
    dataDirectory(),
    "editor-conflicts",
    `${conflict.cardID}-${Date.now()}-${crypto.randomUUID()}.json`,
  );
  await writeJSONAtomically(filePath, conflict, "create");
  return filePath;
}

export async function listEditorConflictRecoveryCopies(
  cardID: string,
  sourceID: string,
  relativePath: string,
): Promise<EditorConflictRecoveryCopy[]> {
  assertCardID(cardID);
  const directory = PathUtils.join(dataDirectory(), "editor-conflicts");
  const entries = await IOUtils.getChildren(directory, { ignoreAbsent: true });
  const prefix = `${cardID}-`;
  const copies: EditorConflictRecoveryCopy[] = [];

  for (const filePath of entries) {
    const recoveryID = PathUtils.split(filePath).at(-1) ?? "";
    if (!recoveryID.startsWith(prefix) || !recoveryID.endsWith(".json")) {
      continue;
    }
    const file = Zotero.File.pathToFile(filePath);
    if (file.isSymlink() || file.isDirectory()) continue;
    try {
      const archive = validateConflictArchive(
        await IOUtils.readJSON(filePath),
        cardID,
      );
      if (
        archive.sourceID !== sourceID ||
        archive.relativePath !== relativePath
      ) {
        continue;
      }
      copies.push({ ...archive, recoveryID });
    } catch {
      // A damaged archive remains untouched and cannot be selected for restore.
    }
  }

  return copies
    .sort(
      (left, right) =>
        Date.parse(right.archivedAt) - Date.parse(left.archivedAt),
    )
    .slice(0, 100);
}
