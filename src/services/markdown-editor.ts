import type { AnnotationCardReference } from "./annotation-card.ts";
import type { UserNoteContent } from "../core/note-content.ts";
import {
  updateCardUserContent,
  UserContentConflictError,
} from "./card-updater.ts";
import {
  archiveEditorConflict,
  deleteEditorDraft,
  listEditorConflictRecoveryCopies,
  readEditorDraft,
  writeEditorDraft,
} from "../adapters/editor-drafts.ts";
import type {
  EditorConflictArchive,
  EditorConflictRecoveryCopy,
  EditorDraft,
} from "../adapters/editor-drafts.ts";
import { readVaultFile } from "../adapters/vault-storage.ts";
import { getString } from "../utils/locale.ts";

export type EditorSaveResult =
  | { status: "saved" }
  | { status: "conflict"; current: UserNoteContent }
  | { status: "error"; message: string };

export interface MarkdownEditorBridge {
  readCard(): Promise<string | null>;
  readDraft(cardID: string): Promise<EditorDraft | null>;
  writeDraft(draft: EditorDraft): Promise<void>;
  deleteDraft(cardID: string): Promise<void>;
  archiveConflict(conflict: EditorConflictArchive): Promise<string>;
  listRecoveryCopies(
    cardID: string,
    sourceID: string,
    relativePath: string,
  ): Promise<EditorConflictRecoveryCopy[]>;
  recoveryMessages: {
    copies: string;
    description: string;
    label: string;
    empty: string;
    restore: string;
    confirm: string;
    restored: string;
    conflict: string;
    failedPrefix: string;
  };
  saveUserContent(
    baseline: UserNoteContent,
    next: UserNoteContent,
    force?: boolean,
  ): Promise<EditorSaveResult>;
  launchURL(url: string): void;
}

const editorWindows = new Map<string, Window>();

export function openMarkdownEditor(reference: AnnotationCardReference): void {
  const existing = editorWindows.get(reference.cardID) as
    | (Window & { closed?: boolean })
    | undefined;
  if (existing && !existing.closed) {
    existing.focus();
    return;
  }

  const mainWindow = Zotero.getMainWindow() as Window & {
    openDialog: (
      url: string,
      name: string,
      features: string,
      argument: AnnotationCardReference,
      bridge: MarkdownEditorBridge,
    ) => Window | null;
  };
  const url = `chrome://${addon.data.config.addonRef}/content/editor.xhtml`;
  const bridge: MarkdownEditorBridge = {
    readCard: () => readVaultFile(reference.vaultPath, reference.relativePath),
    readDraft: (cardID) => readEditorDraft(cardID),
    writeDraft: (draft) => writeEditorDraft(draft),
    deleteDraft: (cardID) => deleteEditorDraft(cardID),
    archiveConflict: (conflict) => archiveEditorConflict(conflict),
    listRecoveryCopies: (cardID, sourceID, relativePath) =>
      listEditorConflictRecoveryCopies(cardID, sourceID, relativePath),
    recoveryMessages: {
      copies: getString("editor-recovery-copies"),
      description: getString("editor-recovery-description"),
      label: getString("editor-recovery-label"),
      empty: getString("editor-recovery-empty"),
      restore: getString("editor-recovery-restore"),
      confirm: getString("editor-recovery-confirm"),
      restored: getString("editor-recovery-restored"),
      conflict: getString("editor-recovery-conflict"),
      failedPrefix: getString("editor-recovery-failed-prefix"),
    },
    async saveUserContent(baseline, next, force = false) {
      try {
        await updateCardUserContent(
          reference.vaultPath,
          reference.relativePath,
          reference.cardID,
          baseline,
          next,
          force,
        );
        return { status: "saved" };
      } catch (error) {
        if (error instanceof UserContentConflictError) {
          return { status: "conflict", current: error.current };
        }
        return { status: "error", message: String(error) };
      }
    },
    launchURL: (target) => Zotero.launchURL(target),
  };
  const editor = mainWindow.openDialog(
    url,
    `zotero-obsidian-bridge-${reference.cardID}`,
    "chrome,dialog=no,resizable,centerscreen,width=1180,height=820",
    reference,
    bridge,
  );
  if (!editor) throw new Error("Zotero could not open the Markdown editor.");
  editorWindows.set(reference.cardID, editor);
  editor.addEventListener(
    "unload",
    () => {
      if (editorWindows.get(reference.cardID) === editor) {
        editorWindows.delete(reference.cardID);
      }
    },
    { once: true },
  );
  editor.focus();
}
