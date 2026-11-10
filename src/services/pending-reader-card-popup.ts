import type { AnnotationCardReference } from "./annotation-card.ts";
import { bindTextareaWikiCompletion } from "./textarea-wiki-completion.ts";
import { createKnowledgeNoteCard } from "./knowledge-note-card.ts";
import {
  createDesktopKnowledgeCardSurface,
  desktopKnowledgeCardsEnabled,
} from "./desktop-knowledge-card-surface.ts";
import { createZoteroNoteQueryClient } from "../adapters/note-query-client.ts";
import {
  bindNoteLinkNavigation,
  createLinkStatus,
} from "./note-link-navigation.ts";
import type { MountedReaderCardPopup } from "./reader-card-popup.ts";
import {
  installReaderCardStyles,
  mountReaderCardPopup,
} from "./reader-card-popup.ts";
import {
  flushPendingCardDraft,
  pendingCardDraftFailure,
  readPendingCardDraft,
  writePendingCardDraft,
  type PendingCardDraft,
} from "../adapters/pending-card-drafts.ts";
import {
  clearPendingCardDraft,
  stagePendingCardDraft,
} from "./pending-card-handoff.ts";
import {
  flushPendingMarkdownEditor,
  openPendingMarkdownEditor,
  promotePendingMarkdownEditor,
  type PendingMarkdownEditorController,
} from "./pending-markdown-editor.ts";
import {
  renderCardMarkdown,
  setMarkdownPreviewHTML,
} from "./card-markdown-preview.ts";
import { getVaultPath } from "./annotation-card.ts";
import { getString } from "../utils/locale.ts";
import {
  createReaderCardMarkdownTextarea,
  markReaderEditorAsTextEntry,
} from "./reader-card-editor.ts";

export interface MountedPendingReaderCardPopup extends MountedReaderCardPopup {
  complete(reference: AnnotationCardReference): Promise<MountedReaderCardPopup>;
  setError(message: string): void;
}

export type OpenPendingMarkdownEditor = typeof openPendingMarkdownEditor;

export async function mountPendingReaderCardPopup(
  doc: Document,
  annotation: Zotero.Item,
  sourceID: string,
  retry: () => void,
  openEditor: OpenPendingMarkdownEditor = openPendingMarkdownEditor,
): Promise<MountedPendingReaderCardPopup> {
  installReaderCardStyles(doc);
  const vaultPath = getVaultPath();
  if (!vaultPath || !PathUtils.isAbsolute(vaultPath)) {
    throw new Error("A paired Obsidian Vault is required for Bridge cards.");
  }
  const saved = await readPendingCardDraft(vaultPath, sourceID);
  let content = saved?.content ?? { title: "", markdown: "" };
  let changed = Boolean(saved);
  let disposed = false;
  let handedOff = false;
  let rendering = 0;
  let previewCleanup: (() => void) | null = null;
  let writeGeneration = 0;
  let creationError = "";
  let expandedEditor: PendingMarkdownEditorController | null = null;
  let openingExpandedEditor = false;

  const root = doc.createElement("section");
  root.className = "zob-reader-popup-prototype zob-reader-card";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", getString("reader-card-label"));
  root.dataset.annotationID = annotation.key;
  const header = doc.createElement("div");
  header.className = "zob-reader-card-header";
  const name = doc.createElement("strong");
  name.className = "zob-reader-card-name";
  name.textContent = getString("reader-card-status-creating");
  const retryButton = doc.createElement("button");
  retryButton.type = "button";
  retryButton.dataset.action = "retry";
  retryButton.textContent = getString("reader-card-retry");
  retryButton.hidden = true;
  retryButton.addEventListener("click", () => {
    void (changed ? persist() : Promise.resolve())
      .then(() => flushPendingCardDraft(vaultPath, sourceID))
      .then(
        () => {
          if (disposed) return;
          creationError = "";
          retryButton.hidden = true;
          status.textContent = getString("reader-card-status-creating");
          status.dataset.state = "pending";
          retry();
        },
        () => {},
      );
  });
  const expandButton = doc.createElement("button");
  expandButton.type = "button";
  expandButton.dataset.action = "expand";
  expandButton.textContent = getString("reader-card-expand");
  expandButton.title = expandButton.textContent;
  expandButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (openingExpandedEditor) return;
    openingExpandedEditor = true;
    void (async () => {
      try {
        if (changed) await persist();
        await flushPendingCardDraft(vaultPath, sourceID);
        editor.readOnly = true;
        status.textContent = "Expanded editor open; local draft remains active";
        status.dataset.state = "pending";
        expandedEditor = await openEditor(
          annotation,
          sourceID,
          (closeError) => {
            void (async () => {
              if (disposed || handedOff) {
                expandedEditor = null;
                return;
              }
              expandedEditor = null;
              if (closeError) throw closeError;
              const latest = await readPendingCardDraft(vaultPath, sourceID);
              if (latest) {
                content = { ...latest.content };
                editor.value = content.markdown;
                knowledgeCard.refreshRelations();
                changed = true;
              }
              editor.readOnly = false;
              status.textContent = getString(
                "reader-card-status-creating-draft",
              );
              status.dataset.state = "pending";
            })().catch((error: unknown) => {
              if (disposed || handedOff) return;
              editor.readOnly = false;
              status.textContent = String(error);
              status.dataset.state = "error";
            });
          },
        );
      } catch (error) {
        editor.readOnly = false;
        status.textContent = String(error);
        status.dataset.state = "error";
      } finally {
        openingExpandedEditor = false;
      }
    })();
  });
  const actions = doc.createElement("div");
  actions.className = "zob-reader-card-actions";
  actions.append(retryButton, expandButton);
  header.append(name, actions);

  const modes = doc.createElement("div");
  modes.className = "zob-reader-card-modes";
  const edit = doc.createElement("button");
  edit.type = "button";
  edit.textContent = getString("reader-card-edit");
  edit.setAttribute("aria-pressed", "true");
  const showPreview = doc.createElement("button");
  showPreview.type = "button";
  showPreview.textContent = getString("reader-card-preview");
  showPreview.setAttribute("aria-pressed", "false");
  modes.append(edit, showPreview);

  const body = doc.createElement("div");
  body.className = "zob-reader-card-body";
  const editorHost = doc.createElement("div");
  editorHost.className = "zob-reader-card-editor";
  const editor = createReaderCardMarkdownTextarea(doc, content.markdown);
  editor.setAttribute("aria-label", getString("reader-card-edit"));
  editorHost.append(editor);
  const disposeCompletion = bindTextareaWikiCompletion(editor, "pending.md");
  const removeTextEntryMarker = markReaderEditorAsTextEntry(editorHost);
  const preview = doc.createElement("div");
  preview.className = "zob-reader-card-preview markdown-body";
  preview.hidden = true;
  body.append(editorHost, preview);

  const context = doc.createElement("details");
  context.className = "zob-reader-card-context";
  const summary = doc.createElement("summary");
  summary.textContent = getString("reader-card-context");
  const quote = doc.createElement("p");
  quote.textContent = annotation.annotationText || "";
  context.append(summary, quote);

  const status = doc.createElement("div");
  status.className = "zob-reader-card-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = saved
    ? getString("reader-card-status-creating-draft")
    : getString("reader-card-status-creating");
  const previousFailure = pendingCardDraftFailure(vaultPath, sourceID);
  if (previousFailure) {
    status.textContent = String(previousFailure);
    status.dataset.state = "error";
    retryButton.hidden = false;
  }
  root.append(header, modes, body, context, status);
  const knowledgeCard = createKnowledgeNoteCard({
    owner: root,
    controlHost: actions,
    createClient: createZoteroNoteQueryClient,
    prepareSurface: desktopKnowledgeCardsEnabled()
      ? createDesktopKnowledgeCardSurface
      : undefined,
    vaultPath,
    launchURL: (url) => Zotero.launchURL(url),
    root: {
      sourcePath: "pending.md",
      markdown: () => editor.value,
      previews: [preview],
      anchor: name,
    },
  });
  const disposeLinks = bindNoteLinkNavigation({
    previews: [preview],
    editor,
    sourcePath: "pending.md",
    markdown: () => editor.value,
    offset: () =>
      editor.selectionStart === editor.selectionEnd
        ? editor.selectionStart
        : null,
    locateLocal: (offset) => {
      editorHost.hidden = false;
      preview.hidden = true;
      editor.focus();
      editor.setSelectionRange(offset, offset);
    },
    status: createLinkStatus(modes),
    onNavigate: knowledgeCard.open,
  });

  const persist = (): Promise<void> => {
    changed = true;
    const generation = ++writeGeneration;
    status.textContent = getString("reader-card-status-creating-saving");
    status.dataset.state = "pending";
    const draft: PendingCardDraft = {
      schema: 1,
      vaultPath,
      sourceID,
      content: { ...content },
      updatedAt: new Date().toISOString(),
    };
    const operation = writePendingCardDraft(draft);
    void operation.then(
      () => {
        if (disposed || generation !== writeGeneration) return;
        status.textContent =
          creationError || getString("reader-card-status-creating-draft");
        status.dataset.state = creationError ? "error" : "pending";
      },
      (error: unknown) => {
        if (disposed || generation !== writeGeneration) return;
        status.textContent = String(error);
        status.dataset.state = "error";
        retryButton.hidden = false;
      },
    );
    return operation;
  };

  editor.addEventListener("input", () => {
    if (disposed) return;
    content = { ...content, markdown: editor.value };
    knowledgeCard.refreshRelations();
    void persist();
  });
  editor.addEventListener("blur", () => {
    if (disposed || !changed) return;
    void flushPendingCardDraft(vaultPath, sourceID);
  });

  const renderPreview = () => {
    const generation = ++rendering;
    void renderCardMarkdown(
      editor.value,
      { vaultPath, relativePath: "pending.md" },
      doc,
      async () => {
        throw new Error("Local images are available after card creation.");
      },
    ).then(
      (result) => {
        if (disposed || generation !== rendering) {
          result.dispose();
          return;
        }
        previewCleanup?.();
        previewCleanup = result.dispose;
        setMarkdownPreviewHTML(preview, result.html);
        knowledgeCard.refreshRelations();
      },
      (error: unknown) => {
        if (!disposed && generation === rendering)
          preview.textContent = String(error);
      },
    );
  };
  edit.addEventListener("click", () => {
    editorHost.hidden = false;
    preview.hidden = true;
    edit.setAttribute("aria-pressed", "true");
    showPreview.setAttribute("aria-pressed", "false");
    editor.focus();
  });
  showPreview.addEventListener("click", () => {
    editorHost.hidden = true;
    preview.hidden = false;
    edit.setAttribute("aria-pressed", "false");
    showPreview.setAttribute("aria-pressed", "true");
    renderPreview();
  });

  return {
    element: root,
    setError(message) {
      if (disposed) return;
      creationError = message;
      status.textContent = message;
      status.dataset.state = "error";
      retryButton.hidden = false;
    },
    async complete(reference) {
      if (
        disposed ||
        reference.sourceID !== sourceID ||
        reference.vaultPath !== vaultPath
      ) {
        throw new Error(
          "Pending card identity changed; the draft was preserved.",
        );
      }
      const expandedWasOpen = await flushPendingMarkdownEditor(sourceID);
      editor.readOnly = true;
      try {
        const latestDraft = expandedWasOpen
          ? await readPendingCardDraft(vaultPath, sourceID)
          : null;
        if (latestDraft) {
          content = { ...latestDraft.content };
          editor.value = content.markdown;
        } else if (content.markdown !== editor.value) {
          content = { ...content, markdown: editor.value };
          await persist();
        }
        await flushPendingCardDraft(vaultPath, sourceID);
        const staged = await stagePendingCardDraft(reference);
        const mounted = await mountReaderCardPopup(
          doc,
          annotation,
          reference,
          staged?.content,
        );
        handedOff = true;
        let promotionFailed = false;
        if (expandedWasOpen) {
          try {
            await promotePendingMarkdownEditor(sourceID, reference);
          } catch (error) {
            promotionFailed = true;
            Zotero.debug(
              `[Zotero Obsidian Bridge] Pending editor promotion failed: ${String(error)}`,
            );
          }
        }
        try {
          if (staged && !promotionFailed)
            await clearPendingCardDraft(reference, staged);
        } catch (error) {
          Zotero.debug(
            `[Zotero Obsidian Bridge] Pending draft cleanup failed: ${String(error)}`,
          );
        }
        return mounted;
      } finally {
        if (!handedOff) editor.readOnly = false;
      }
    },
    async prepareForModeChange() {
      if (disposed) return "clean";
      if (expandedEditor) {
        await expandedEditor.flush();
      } else if (content.markdown !== editor.value) {
        content = { ...content, markdown: editor.value };
        await persist();
      }
      await flushPendingCardDraft(vaultPath, sourceID);
      return changed ? "checkpointed" : "pending";
    },
    cancelModeChange() {},
    dispose() {
      if (disposed) return;
      if (!handedOff && !expandedEditor && content.markdown !== editor.value) {
        content = { ...content, markdown: editor.value };
        void persist();
      }
      if (!handedOff && !expandedEditor && changed) {
        void flushPendingCardDraft(vaultPath, sourceID).catch(
          (error: unknown) => {
            Zotero.debug(
              `[Zotero Obsidian Bridge] Pending card draft flush failed: ${String(error)}`,
            );
          },
        );
      }
      disposed = true;
      disposeCompletion();
      disposeLinks();
      knowledgeCard.dispose();
      rendering++;
      previewCleanup?.();
      removeTextEntryMarker();
    },
  };
}
