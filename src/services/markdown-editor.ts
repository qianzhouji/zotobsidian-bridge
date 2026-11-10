import type { AnnotationCardReference } from "./annotation-card.ts";
import type { UserNoteContent } from "../core/note-content.ts";
import { readFrontmatterValue } from "../core/markdown.ts";
import {
  readSourceMarkdown,
  readUserNoteContent,
} from "../core/note-content.ts";
import { acquireEditorSession, type EditorSession } from "./editor-session.ts";
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
import { readVaultFile, readVaultImage } from "../adapters/vault-storage.ts";
import {
  CompanionPendingError,
  getCompanionRequestOutcome,
} from "../adapters/companion-queue.ts";
import { getString } from "../utils/locale.ts";
import type {
  KnowledgeCardSurface,
  KnowledgeCardSurfaceOptions,
} from "../core/knowledge-card-surface.ts";
import { observeWindowClose } from "../adapters/window-close-lifecycle.ts";
import {
  createZoteroNoteQueryClient,
  type NoteQueryClient,
} from "../adapters/note-query-client.ts";
import {
  createDesktopKnowledgeCardSurface,
  desktopKnowledgeCardsEnabled,
} from "./desktop-knowledge-card-surface.ts";

export type EditorSaveResult =
  | { status: "saved" }
  | { status: "pending"; requestId: string }
  | { status: "conflict"; current: UserNoteContent }
  | { status: "error"; message: string };

export interface MarkdownEditorBridge {
  prepareKnowledgeCardSurface?(
    client: NoteQueryClient,
    options: KnowledgeCardSurfaceOptions,
  ): Promise<KnowledgeCardSurface>;
  createNoteQueryClient(): NoteQueryClient;
  readCard(): Promise<string | null>;
  readPreviewImage(relativePath: string): Promise<Uint8Array>;
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

function editorWindowKey(reference: AnnotationCardReference): string {
  return JSON.stringify([
    reference.vaultPath,
    reference.cardID,
    reference.sourceID,
    reference.relativePath,
  ]);
}

export function createMarkdownEditorRuntime(
  reference: AnnotationCardReference,
): {
  bridge: MarkdownEditorBridge;
  session: EditorSession;
} {
  const bridge: MarkdownEditorBridge = {
    prepareKnowledgeCardSurface: desktopKnowledgeCardsEnabled()
      ? (client, options) => createDesktopKnowledgeCardSurface(client, options)
      : undefined,
    createNoteQueryClient: createZoteroNoteQueryClient,
    readCard: () => readVaultFile(reference.vaultPath, reference.relativePath),
    readPreviewImage: (relativePath) =>
      readVaultImage(reference.vaultPath, relativePath),
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
        if (error instanceof CompanionPendingError) {
          return { status: "pending", requestId: error.requestId };
        }
        return { status: "error", message: String(error) };
      }
    },
    launchURL: (target) => Zotero.launchURL(target),
  };
  const session = acquireEditorSession(
    {
      vaultPath: reference.vaultPath,
      cardID: reference.cardID,
      sourceID: reference.sourceID,
      relativePath: reference.relativePath,
    },
    {
      async readDisk() {
        const markdown = await bridge.readCard();
        if (markdown === null) {
          throw new Error("The linked card no longer exists.");
        }
        if (
          readFrontmatterValue(markdown, "bridge_card_id") !== reference.cardID
        ) {
          throw new Error(
            "Card identity changed; the editor is now read-only.",
          );
        }
        return {
          content: readUserNoteContent(markdown),
          source: readSourceMarkdown(markdown),
        };
      },
      readDraft: (cardID) => bridge.readDraft(cardID),
      writeDraft: (draft) => bridge.writeDraft(draft),
      deleteDraft: (cardID) => bridge.deleteDraft(cardID),
      save: (baseline, next, force) =>
        bridge.saveUserContent(baseline, next, force),
      getSaveOutcome: (requestId) => getCompanionRequestOutcome(requestId),
    },
  );
  return { bridge, session };
}

export function openMarkdownEditor(
  reference: AnnotationCardReference,
): EditorSession {
  const { bridge, session } = createMarkdownEditorRuntime(reference);
  const key = editorWindowKey(reference);
  const existing = editorWindows.get(key) as
    | (Window & { closed?: boolean })
    | undefined;
  if (existing && !existing.closed) {
    existing.focus();
    return session;
  }

  const mainWindow = Zotero.getMainWindow() as Window & {
    openDialog: (
      url: string,
      name: string,
      features: string,
      argument: AnnotationCardReference,
      bridge: MarkdownEditorBridge,
      session: EditorSession,
    ) => Window | null;
  };
  const url = `chrome://${addon.data.config.addonRef}/content/editor.html`;
  const releaseSession = session.retain();
  let editor: Window | null;
  try {
    editor = mainWindow.openDialog(
      url,
      `zotero-obsidian-bridge-${reference.cardID}`,
      "chrome,dialog=no,resizable,centerscreen,width=1180,height=820",
      reference,
      bridge,
      session,
    );
  } catch (error) {
    releaseSession();
    throw error;
  }
  if (!editor) {
    releaseSession();
    throw new Error("Zotero could not open the Markdown editor.");
  }
  editorWindows.set(key, editor);
  observeWindowClose(editor, url, () => {
    if (editorWindows.get(key) === editor) editorWindows.delete(key);
    releaseSession();
  });
  editor.focus();
  return session;
}
