import type { PendingCardDraft } from "../adapters/pending-card-drafts.ts";
import {
  flushPendingCardDraft,
  readPendingCardDraft,
  writePendingCardDraft,
} from "../adapters/pending-card-drafts.ts";
import type {
  EditorConflictArchive,
  EditorConflictRecoveryCopy,
  EditorDraft,
} from "../adapters/editor-drafts.ts";
import type { UserNoteContent } from "../core/note-content.ts";
import { readSourceMarkdown } from "../core/note-content.ts";
import {
  createMarkdownWithHiddenMetadata,
  formatSourceBlock,
} from "../core/markdown.ts";
import type { AnnotationCardReference } from "./annotation-card.ts";
import {
  getLibraryIdentity,
  getVaultPath,
  zoteroLibraryPath,
} from "./annotation-card.ts";
import { observeWindowClose } from "../adapters/window-close-lifecycle.ts";
import { createZoteroNoteQueryClient } from "../adapters/note-query-client.ts";
import { openMarkdownEditor } from "./markdown-editor.ts";
import { acquireEditorSession, type EditorSession } from "./editor-session.ts";
import type {
  MarkdownEditorBridge,
  EditorSaveResult,
} from "./markdown-editor.ts";
import type { EditorWindowOptions } from "./editor-window.ts";
import { getString } from "../utils/locale.ts";
import {
  createDesktopKnowledgeCardSurface,
  desktopKnowledgeCardsEnabled,
} from "./desktop-knowledge-card-surface.ts";

export interface PendingMarkdownEditorController {
  readonly window: Window;
  readonly session: EditorSession;
  flush(): Promise<void>;
  close(): void;
}

type OpenEditorCallback = (error?: unknown) => void;
type PendingEditorEntry = PendingMarkdownEditorController & {
  callbacks: Set<OpenEditorCallback>;
};

const pendingEditors = new Map<string, PendingEditorEntry>();

function createPendingReference(
  annotation: Zotero.Item,
  sourceID: string,
  vaultPath: string,
): AnnotationCardReference {
  const attachment = annotation.parentItem;
  if (!attachment || !attachment.isAttachment()) {
    throw new Error("The annotation's PDF attachment is unavailable.");
  }
  const parent = attachment.parentItemID
    ? Zotero.Items.get(attachment.parentItemID)
    : null;
  const paper = parent ?? attachment;
  const identity = getLibraryIdentity(annotation.libraryID);
  const pageIndex = (() => {
    try {
      const value = Number(
        JSON.parse(annotation.annotationPosition)?.pageIndex,
      );
      return Number.isInteger(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  })();
  const page = pageIndex === null ? "" : `?page=${pageIndex + 1}`;
  const relativeDirectory = "__bridge_pending__";
  const filename = `${annotation.key}.md`;
  const relativePath = `${relativeDirectory}/${filename}`;
  return {
    cardID: crypto.randomUUID(),
    sourceID,
    vaultPath,
    relativePath,
    absolutePath: PathUtils.join(vaultPath, relativeDirectory, filename),
    paperTitle: paper.getField("title") || "Untitled paper",
    paperCreator: parent?.getField("firstCreator") || "",
    zoteroURI: `zotero://open-pdf/${zoteroLibraryPath(identity)}/items/${attachment.key}${page}`,
    annotationColor: annotation.annotationColor || "",
  };
}

export function buildPendingEditorCardMarkdown(
  reference: AnnotationCardReference,
  content: UserNoteContent,
  annotationText: string,
  annotationComment: string,
  pageLabel: string,
): string {
  const source = formatSourceBlock(
    annotationText,
    annotationComment,
    pageLabel ? `Page ${pageLabel}` : "Annotation",
    reference.zoteroURI,
    reference.annotationColor,
  );
  return createMarkdownWithHiddenMetadata(
    { paper_title: reference.paperTitle },
    {
      type: "zotero-annotation",
      bridge_schema: 1,
      bridge_card_id: reference.cardID,
      bridge_source_id: reference.sourceID,
      note_title: content.title || null,
    },
    `## My notes\n\n${content.markdown}${content.markdown ? "\n\n" : ""}${source}`,
  );
}

function pendingBridge(
  reference: AnnotationCardReference,
  annotation: Zotero.Item,
): MarkdownEditorBridge {
  const getDraft = async (): Promise<PendingCardDraft> => {
    const draft = await readPendingCardDraft(
      reference.vaultPath,
      reference.sourceID,
    );
    if (!draft) throw new Error("The local pending card draft is unavailable.");
    return draft;
  };
  const persist = async (content: UserNoteContent): Promise<void> => {
    await writePendingCardDraft({
      schema: 1,
      vaultPath: reference.vaultPath,
      sourceID: reference.sourceID,
      content: { ...content },
      updatedAt: new Date().toISOString(),
    });
    await flushPendingCardDraft(reference.vaultPath, reference.sourceID);
  };

  return {
    prepareKnowledgeCardSurface: desktopKnowledgeCardsEnabled()
      ? (client, options) => createDesktopKnowledgeCardSurface(client, options)
      : undefined,
    createNoteQueryClient: createZoteroNoteQueryClient,
    async readCard() {
      const draft = await getDraft();
      return buildPendingEditorCardMarkdown(
        reference,
        draft.content,
        annotation.annotationText || "",
        annotation.annotationComment || "",
        annotation.annotationPageLabel || "",
      );
    },
    async readPreviewImage() {
      throw new Error(
        "Images are available after the Obsidian card is created.",
      );
    },
    async readDraft() {
      return null;
    },
    async writeDraft(draft: EditorDraft) {
      await persist(draft.draft);
    },
    async deleteDraft() {
      // Keep the pending draft until card creation and handoff are confirmed.
    },
    async archiveConflict(_conflict: EditorConflictArchive) {
      return "";
    },
    async listRecoveryCopies(
      _cardID: string,
      _sourceID: string,
      _relativePath: string,
    ): Promise<EditorConflictRecoveryCopy[]> {
      return [];
    },
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
    async saveUserContent(
      _baseline: UserNoteContent,
      next: UserNoteContent,
    ): Promise<EditorSaveResult> {
      try {
        await persist(next);
        return { status: "saved" };
      } catch (error) {
        return { status: "error", message: String(error) };
      }
    },
    launchURL: (url) => Zotero.launchURL(url),
  };
}

export async function openPendingMarkdownEditor(
  annotation: Zotero.Item,
  sourceID: string,
  onClose: OpenEditorCallback,
): Promise<PendingMarkdownEditorController> {
  const existing = pendingEditors.get(sourceID);
  if (existing && !(existing.window as Window & { closed?: boolean }).closed) {
    existing.callbacks.add(onClose);
    existing.window.focus();
    return existing;
  }

  const vaultPath = getVaultPath();
  if (!vaultPath || !PathUtils.isAbsolute(vaultPath)) {
    throw new Error("A paired Obsidian Vault is required for Bridge cards.");
  }
  const draft = await readPendingCardDraft(vaultPath, sourceID);
  if (!draft)
    throw new Error("Save the local draft before expanding the card.");

  const reference = createPendingReference(annotation, sourceID, vaultPath);
  const identity = {
    vaultPath,
    cardID: reference.cardID,
    sourceID,
    relativePath: reference.relativePath,
  };
  const bridge = pendingBridge(reference, annotation);
  // Checkpoints share the pending file with saves, but are not external edits.
  let committedContent = { ...draft.content };
  const session = acquireEditorSession(identity, {
    async readDisk() {
      const markdown = await bridge.readCard();
      if (!markdown)
        throw new Error("The local pending card draft is unavailable.");
      return {
        content: { ...committedContent },
        source: readSourceMarkdown(markdown),
      };
    },
    async readDraft() {
      return null;
    },
    writeDraft: (value) => bridge.writeDraft(value),
    async deleteDraft() {
      // The pending draft is the source of truth until the card handoff.
    },
    async save(baseline, next) {
      const result = await bridge.saveUserContent(baseline, next);
      if (result.status === "saved") {
        committedContent = {
          title: next.title.trim(),
          markdown: next.markdown,
        };
      }
      return result;
    },
  });
  const releaseSession = session.retain();

  const mainWindow = Zotero.getMainWindow() as Window & {
    openDialog: (
      url: string,
      name: string,
      features: string,
      argument: AnnotationCardReference,
      bridge: MarkdownEditorBridge,
      session: EditorSession,
      options: EditorWindowOptions,
    ) => Window | null;
  };
  const url = `chrome://${addon.data.config.addonRef}/content/editor.html`;
  let editor: Window | null;
  try {
    editor = mainWindow.openDialog(
      url,
      `zotero-obsidian-bridge-pending-${sourceID}`,
      "chrome,dialog=no,resizable,centerscreen,width=1180,height=820",
      reference,
      bridge,
      session,
      { mode: "pending-card" },
    );
  } catch (error) {
    releaseSession();
    throw error;
  }
  if (!editor) {
    releaseSession();
    throw new Error("Zotero could not open the pending card editor.");
  }

  const callbacks = new Set([onClose]);
  const controller: PendingEditorEntry = {
    window: editor,
    session,
    callbacks,
    async flush() {
      await session.initialize();
      await session.flushDraft();
      await session.requestSave();
      await session.flushDraft();
      await flushPendingCardDraft(vaultPath, sourceID);
    },
    close() {
      editor.close();
    },
  };
  pendingEditors.set(sourceID, controller);
  observeWindowClose(editor, url, () => {
    const finish = (error?: unknown) => {
      if (pendingEditors.get(sourceID) === controller) {
        pendingEditors.delete(sourceID);
      }
      try {
        for (const callback of callbacks) callback(error);
      } finally {
        callbacks.clear();
        releaseSession();
      }
    };
    void controller.flush().then(() => finish(), finish);
  });
  editor.focus();
  return controller;
}

export async function flushPendingMarkdownEditor(
  sourceID: string,
): Promise<boolean> {
  const editor = pendingEditors.get(sourceID);
  if (!editor) return false;
  await editor.flush();
  return true;
}

export async function promotePendingMarkdownEditor(
  sourceID: string,
  reference: AnnotationCardReference,
): Promise<boolean> {
  const editor = pendingEditors.get(sourceID);
  if (!editor) return false;
  await editor.flush();
  editor.close();
  openMarkdownEditor(reference);
  return true;
}
