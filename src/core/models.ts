export type LibraryType = "user" | "group" | "feed";

export interface LibraryIdentity {
  type: LibraryType;
  typeID: number;
}

export interface PaperRecord {
  identity: LibraryIdentity;
  key: string;
  title: string;
  creator: string;
  date: string;
  publication: string;
  doi: string;
  zoteroURI: string;
}

export interface AnnotationRecord {
  identity: LibraryIdentity;
  key: string;
  attachmentKey: string;
  pageIndex: number | null;
  pageLabel: string;
  color: string;
  text: string;
  comment: string;
  zoteroURI: string;
}

export interface CardRecord {
  id: string;
  sourceID: string;
  relativePath: string;
  paper: PaperRecord;
  annotation: AnnotationRecord;
}

export interface CardIndexEntry {
  cardID: string;
  relativePath: string;
  updatedAt: string;
}

export interface SuspendedCardEntry {
  cardID: string;
  relativePath: string;
  suspendedAt: string;
  reason: "missing";
}

export interface CardIndex {
  bridge_schema: 1;
  cards: Record<string, CardIndexEntry>;
  suspendedCards: Record<string, SuspendedCardEntry>;
}

export type SyncTaskStatus =
  | "pending"
  | "running"
  | "done"
  | "retry"
  | "conflict";

export interface SyncTask {
  id: string;
  sourceID: string;
  status: SyncTaskStatus;
  attempts: number;
  updatedAt: string;
  lastEvent?: string;
  lastError?: string;
}

export interface SyncTaskLog {
  bridge_schema: 1;
  tasks: SyncTask[];
}

export function libraryIdentityKey(identity: LibraryIdentity): string {
  if (!Number.isSafeInteger(identity.typeID) || identity.typeID < 0) {
    throw new Error("Invalid Zotero library identity.");
  }
  return `${identity.type}:${identity.typeID}`;
}

export function annotationSourceID(
  identity: LibraryIdentity,
  annotationKey: string,
): string {
  if (!annotationKey || annotationKey.includes("/")) {
    throw new Error("Invalid Zotero annotation key.");
  }
  return `${libraryIdentityKey(identity)}/annotation/${annotationKey}`;
}

export function noteSourceID(
  identity: LibraryIdentity,
  noteKey: string,
): string {
  if (!noteKey || noteKey.includes("/")) {
    throw new Error("Invalid Zotero note key.");
  }
  return `${libraryIdentityKey(identity)}/note/${noteKey}`;
}

export function safePathSegment(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFC")
    .split("")
    .filter((character) => character.charCodeAt(0) > 0x1f)
    .join("")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned || fallback;
}

export function validateVaultRelativePath(value: string): string {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) {
    throw new Error("Output folder must be a non-empty path inside the vault.");
  }
  const segments = trimmed.split("/");
  if (segments.some((part) => !part || part === "." || part === "..")) {
    throw new Error(
      "Output folder cannot contain empty, '.' or '..' segments.",
    );
  }
  return segments.join("/");
}
