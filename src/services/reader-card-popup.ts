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
import {
  createMarkdownEditorRuntime,
  openMarkdownEditor,
} from "./markdown-editor.ts";
import {
  renderCardMarkdown,
  type RenderedCardMarkdown,
} from "./card-markdown-preview.ts";
import { getString } from "../utils/locale.ts";
import type { UserNoteContent } from "../core/note-content.ts";
import type { EditorSessionSnapshot } from "./editor-session.ts";
import {
  createReaderCardMarkdownTextarea,
  markReaderEditorAsTextEntry,
} from "./reader-card-editor.ts";
import {
  clampPopupSize,
  getPopupSizeConstraints,
} from "../core/reader-popup-size.ts";
import { installReaderMathStyles } from "./reader-math-styles.ts";

export interface MountedReaderCardPopup {
  element: HTMLElement;
  prepareForModeChange(): Promise<"clean" | "checkpointed" | "pending">;
  cancelModeChange(): void;
  dispose(): void;
}

const styleID = "zob-reader-card-popup-styles";

const styles = `
.annotation-popup.zob-reader-card-host {
  box-sizing: border-box !important; display: block !important; width: fit-content !important;
  min-width: 0 !important; max-width: calc(100vw - 16px) !important; height: auto !important;
  max-height: none !important; padding: 0 !important; overflow: visible !important;
  color: #202426 !important; background: transparent !important; border: 0 !important;
  box-shadow: none !important; visibility: hidden !important;
}
.annotation-popup.zob-reader-card-host > :not(.zob-reader-card) { display: none !important; }
.annotation-popup.zob-reader-card-host > .zob-reader-card { display: grid !important; visibility: visible !important; }
.annotation-popup.zob-reader-card-host::before,
.annotation-popup.zob-reader-card-host::after { content: none !important; display: none !important; }
.zob-reader-popup-prototype.zob-reader-card {
  box-sizing: border-box; position: relative; display: grid;
  grid-template-rows: auto auto minmax(80px, 1fr) auto auto;
  width: min(460px, calc(100vw - 24px)); height: min(320px, calc(100vh - 112px));
  min-width: min(320px, calc(100vw - 24px)); max-width: calc(100vw - 16px);
  max-height: calc(100vh - 96px); min-height: 238px; overflow: hidden;
  --zob-accent: #78bfe9; --zob-accent-strong: #285e7b; --zob-accent-soft: #e8f5fd;
  color: #202426;
  background: var(--material-background, var(--color-background, #fff));
  border: 1px solid var(--material-divider, #d6dcda); border-radius: 6px;
  box-shadow: 0 5px 18px rgb(0 0 0 / 18%); font: 13px/1.45 system-ui, sans-serif;
}
.zob-reader-card * { box-sizing: border-box; }
.zob-reader-card-header, .zob-reader-card-actions, .zob-reader-card-modes,
.zob-reader-card-status { display: flex; align-items: center; gap: 6px; }
.zob-reader-card-header { min-width: 0; justify-content: space-between; padding: 7px 8px; border-bottom: 1px solid var(--material-divider, #d6dcda); }
.zob-reader-card-name { min-width: 0; overflow: hidden; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.zob-reader-card-actions { flex: 0 0 auto; gap: 2px; }
.zob-reader-card button { min-height: 28px; padding: 3px 7px; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 4px; font: inherit; cursor: pointer; }
.zob-reader-card button:hover { background: var(--material-button-hover, rgb(127 127 127 / 14%)); }
.zob-reader-card button:focus-visible { outline: 2px solid var(--zob-accent); outline-offset: 1px; }
.zob-reader-card-modes { padding: 6px 8px 0; }
.zob-reader-card-modes button { min-width: 54px; border-color: var(--material-divider, #d6dcda); }
.zob-reader-card-modes button[aria-pressed="true"] { color: var(--zob-accent-strong); background: var(--zob-accent-soft); border-color: var(--zob-accent); }
.zob-reader-card-body { min-width: 0; min-height: 0; margin: 6px 8px; overflow: hidden; border: 1px solid var(--material-divider, #d6dcda); border-radius: 4px; }
.zob-reader-card-editor, .zob-reader-card-preview { width: 100%; height: 100%; min-height: 0; overflow: auto; }
.zob-reader-card-editor.label-popup { position: static !important; left: auto !important; padding: 0 !important; }
.zob-reader-card-editor.label-popup::before, .zob-reader-card-editor.label-popup::after { content: none !important; display: none !important; }
.zob-reader-card-textarea { display: block; width: 100%; height: 100%; min-height: 0; padding: 8px; resize: none; border: 0; outline: 0; color: inherit; background: transparent; font: inherit; line-height: 1.45; }
.zob-reader-card-textarea:focus-visible { box-shadow: inset 0 0 0 2px var(--zob-accent); }
.zob-reader-card-preview { padding: 8px 10px; overflow-wrap: anywhere; }
.zob-reader-card-preview > :first-child { margin-top: 0; }
.zob-reader-card-preview > :last-child { margin-bottom: 0; }
.zob-reader-card-preview.markdown-body h1,
.zob-reader-card-preview.markdown-body h2,
.zob-reader-card-preview.markdown-body h3,
.zob-reader-card-preview.markdown-body h4,
.zob-reader-card-preview.markdown-body p,
.zob-reader-card-preview.markdown-body ul,
.zob-reader-card-preview.markdown-body ol,
.zob-reader-card-preview.markdown-body blockquote,
.zob-reader-card-preview.markdown-body pre,
.zob-reader-card-preview.markdown-body table,
.zob-reader-card-preview.markdown-body .math-block { display: block !important; }
.zob-reader-card-preview.markdown-body h1 { font-size: 1.5em; }
.zob-reader-card-preview.markdown-body h2 { font-size: 1.3em; }
.zob-reader-card-preview.markdown-body h3 { font-size: 1.15em; }
.zob-reader-card-preview.markdown-body h1,
.zob-reader-card-preview.markdown-body h2,
.zob-reader-card-preview.markdown-body h3,
.zob-reader-card-preview.markdown-body h4 { margin: 0.85em 0 0.4em; font-weight: 650; }
.zob-reader-card-preview.markdown-body p,
.zob-reader-card-preview.markdown-body ul,
.zob-reader-card-preview.markdown-body ol,
.zob-reader-card-preview.markdown-body blockquote,
.zob-reader-card-preview.markdown-body pre,
.zob-reader-card-preview.markdown-body table { margin: 0.55em 0; }
.zob-reader-card-preview.markdown-body ul,
.zob-reader-card-preview.markdown-body ol { padding-inline-start: 1.5em; }
.zob-reader-card-preview.markdown-body li { display: list-item !important; }
.zob-reader-card-preview pre { max-width: 100%; overflow: auto; padding: 8px; background: rgb(127 127 127 / 10%); }
.zob-reader-card-preview.markdown-body pre { white-space: pre; }
.zob-reader-card-preview.markdown-body code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.zob-reader-card-preview img { display: block; max-width: 100%; max-height: 180px; object-fit: contain; }
.zob-reader-card-preview a { overflow-wrap: anywhere; }
.zob-reader-card-preview blockquote { margin-inline: 0; padding-inline-start: 10px; border-inline-start: 3px solid var(--zob-accent); }
.zob-reader-card-preview.markdown-body .math-block { padding: 4px 0; overflow-x: auto; text-align: center; }
.zob-reader-card-preview .katex .katex-mathml { border: 0; clip-path: inset(50%); height: 1px; overflow: hidden; padding: 0; position: absolute; width: 1px; }
.zob-reader-card-context { max-height: 78px; padding: 0 9px 6px; overflow: auto; color: var(--material-text-secondary, #5e6965); font-size: 12px; }
.zob-reader-card-context summary { cursor: pointer; }
.zob-reader-card-context p { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.zob-reader-card-status { min-height: 27px; justify-content: space-between; padding: 3px 24px 3px 9px; border-top: 1px solid var(--material-divider, #d6dcda); color: var(--material-text-secondary, #5e6965); font-size: 11px; }
.zob-reader-card-status[data-state="error"], .zob-reader-card-status[data-state="offline"], .zob-reader-card-status[data-state="conflict"] { color: var(--error-color, #a6342a); }
.zob-reader-card-resize { position: absolute; right: 2px; bottom: 2px; width: 17px; height: 17px; min-height: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; background: linear-gradient(135deg, transparent 48%, #8b969b 50%, #8b969b 56%, transparent 58%), linear-gradient(135deg, transparent 67%, #8b969b 69%, #8b969b 75%, transparent 77%) !important; cursor: nwse-resize !important; touch-action: none; user-select: none; }
.zob-reader-card-resize:hover { background-color: var(--zob-accent-soft) !important; }
@media (max-width: 360px) {
  .zob-reader-popup-prototype.zob-reader-card { min-width: 0; width: calc(100vw - 16px); }
  .zob-reader-card-context { max-height: 52px; }
}
`;

export function installReaderCardStyles(doc: Document): void {
  void installReaderMathStyles(doc).catch((error: unknown) => {
    Zotero.debug(
      `[Zotero Obsidian Bridge] Reader math styles failed: ${String(error)}`,
    );
  });
  if (doc.getElementById(styleID)) return;
  const style = doc.createElement("style");
  style.id = styleID;
  style.textContent = styles;
  const target = doc.head ?? doc.documentElement;
  target?.append(style);
}

function pageFromAnnotation(annotation: Zotero.Item): number | null {
  try {
    const position = JSON.parse(annotation.annotationPosition);
    const pageIndex = Number(position?.pageIndex);
    return Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex + 1 : null;
  } catch {
    return null;
  }
}

function cardName(reference: AnnotationCardReference): string {
  return (
    reference.relativePath.split("/").at(-1)?.replace(/\.md$/i, "") ||
    "Markdown card"
  );
}

function statusLabel(snapshot: EditorSessionSnapshot): string {
  if (snapshot.status === "dirty" && snapshot.draftPersisted) {
    return getString("reader-card-status-checkpointed");
  }
  return getString(
    `reader-card-status-${snapshot.status}` as Parameters<typeof getString>[0],
  );
}

function isSafeLaunchURL(rawURL: string): boolean {
  try {
    return ["http:", "https:", "mailto:", "zotero:", "obsidian:"].includes(
      new URL(rawURL).protocol,
    );
  } catch {
    return false;
  }
}

export async function mountReaderCardPopup(
  doc: Document,
  annotation: Zotero.Item,
  reference: AnnotationCardReference,
  expectedPendingContent?: UserNoteContent | null,
): Promise<MountedReaderCardPopup> {
  installReaderCardStyles(doc);
  const { bridge, session } = createMarkdownEditorRuntime(reference);
  const initial = await session.initialize();
  if (
    expectedPendingContent &&
    (initial.content.title !== expectedPendingContent.title ||
      initial.content.markdown !== expectedPendingContent.markdown)
  ) {
    throw new Error(
      "An active editor has different content; the pending draft was preserved.",
    );
  }
  const root = doc.createElement("section");
  root.className = "zob-reader-popup-prototype zob-reader-card";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", getString("reader-card-label"));
  root.dataset.annotationID = annotation.key;
  const page = pageFromAnnotation(annotation);
  root.dataset.pdfPage = page === null ? "" : String(page);

  const header = doc.createElement("div");
  header.className = "zob-reader-card-header";
  const name = doc.createElement("strong");
  name.className = "zob-reader-card-name";
  name.textContent =
    page === null
      ? cardName(reference)
      : `P${String(page).padStart(2, "0")} · ${cardName(reference)}`;
  const actions = doc.createElement("div");
  actions.className = "zob-reader-card-actions";
  const openObsidian = doc.createElement("button");
  openObsidian.type = "button";
  openObsidian.textContent = getString("reader-card-open-obsidian");
  openObsidian.title = getString("reader-card-open-obsidian");
  openObsidian.addEventListener("click", () => {
    bridge.launchURL(
      `obsidian://open?path=${encodeURIComponent(reference.absolutePath)}`,
    );
  });
  const expand = doc.createElement("button");
  expand.type = "button";
  expand.textContent = getString("reader-card-expand");
  expand.title = getString("reader-card-expand");
  expand.addEventListener("click", () => {
    try {
      openMarkdownEditor(reference);
    } catch (error) {
      const snapshot = session.snapshot();
      status.textContent = `${statusLabel(snapshot)}: ${String(error)}`;
      status.dataset.state = "error";
    }
  });
  actions.append(openObsidian, expand);
  header.append(name, actions);

  const modes = doc.createElement("div");
  modes.className = "zob-reader-card-modes";
  const editMode = doc.createElement("button");
  editMode.type = "button";
  editMode.textContent = getString("reader-card-edit");
  editMode.setAttribute("aria-pressed", "true");
  const previewMode = doc.createElement("button");
  previewMode.type = "button";
  previewMode.textContent = getString("reader-card-preview");
  previewMode.setAttribute("aria-pressed", "false");
  modes.append(editMode, previewMode);

  const body = doc.createElement("div");
  body.className = "zob-reader-card-body";
  const editorHost = doc.createElement("div");
  editorHost.className = "zob-reader-card-editor";
  const preview = doc.createElement("div");
  preview.className = "zob-reader-card-preview markdown-body";
  preview.hidden = true;
  body.append(editorHost, preview);

  const context = doc.createElement("details");
  context.className = "zob-reader-card-context";
  const summary = doc.createElement("summary");
  summary.textContent = getString("reader-card-context");
  const paper = doc.createElement("p");
  paper.textContent = reference.paperTitle || "Untitled paper";
  const quote = doc.createElement("p");
  quote.textContent = annotation.annotationText || "";
  quote.setAttribute("aria-label", getString("reader-card-quote"));
  context.append(summary, paper);
  if (quote.textContent) context.append(quote);

  const status = doc.createElement("div");
  status.className = "zob-reader-card-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.dataset.state = initial.status;
  status.textContent = statusLabel(initial);
  const resizeHandle = doc.createElement("button");
  resizeHandle.type = "button";
  resizeHandle.className = "zob-reader-card-resize";
  resizeHandle.setAttribute("aria-label", getString("reader-card-resize"));
  resizeHandle.title = getString("reader-card-resize");
  root.append(header, modes, body, context, status, resizeHandle);
  const setPopupSize = (size: { width: number; height: number }) => {
    root.style.width = `${size.width}px`;
    root.style.height = `${size.height}px`;
  };
  const sizeConstraints = () => {
    const view = doc.defaultView;
    const rect = root.getBoundingClientRect();
    if (!view) {
      return getPopupSizeConstraints(460, 320, 0, 0);
    }
    return getPopupSizeConstraints(
      view.innerWidth,
      view.innerHeight,
      rect.left,
      rect.top,
    );
  };
  const applySizeConstraints = (
    constraints: ReturnType<typeof getPopupSizeConstraints>,
  ) => {
    root.style.minWidth = `${constraints.minWidth}px`;
    root.style.maxWidth = `${constraints.maxWidth}px`;
    root.style.minHeight = `${constraints.minHeight}px`;
    root.style.maxHeight = `${constraints.maxHeight}px`;
  };
  const constrainToViewport = () => {
    const constraints = sizeConstraints();
    applySizeConstraints(constraints);
    const rect = root.getBoundingClientRect();
    setPopupSize(
      clampPopupSize(
        { width: rect.width || 460, height: rect.height || 320 },
        constraints,
      ),
    );
  };
  const windowView = doc.defaultView;
  const onViewportResize = () => constrainToViewport();
  windowView?.addEventListener("resize", onViewportResize);
  resizeHandle.addEventListener("keydown", (event: KeyboardEvent) => {
    const view = doc.defaultView;
    if (
      !view ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const rect = root.getBoundingClientRect();
    const width = rect.width || 460;
    const height = rect.height || 320;
    const step = event.shiftKey ? 32 : 12;
    const deltaX =
      event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const deltaY =
      event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    setPopupSize(
      clampPopupSize(
        { width: width + deltaX, height: height + deltaY },
        sizeConstraints(),
      ),
    );
  });

  let resizeCleanup: (() => void) | null = null;
  resizeHandle.addEventListener("pointerdown", (event: PointerEvent) => {
    const view = doc.defaultView;
    if (!view || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeCleanup?.();
    const rect = root.getBoundingClientRect();
    const startWidth = rect.width || 460;
    const startHeight = rect.height || 320;
    const constraints = getPopupSizeConstraints(
      view.innerWidth,
      view.innerHeight,
      rect.left,
      rect.top,
    );
    applySizeConstraints(constraints);
    const startX = event.clientX;
    const startY = event.clientY;
    try {
      resizeHandle.setPointerCapture(event.pointerId);
    } catch {
      // Some Zotero Reader builds do not support pointer capture in popups.
    }
    const onMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      setPopupSize(
        clampPopupSize(
          {
            width: startWidth + moveEvent.clientX - startX,
            height: startHeight + moveEvent.clientY - startY,
          },
          constraints,
        ),
      );
    };
    const stop = () => {
      view.removeEventListener("pointermove", onMove);
      view.removeEventListener("pointerup", stop);
      view.removeEventListener("pointercancel", stop);
      try {
        if (resizeHandle.hasPointerCapture(event.pointerId)) {
          resizeHandle.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Pointer capture may already have been released by the browser.
      }
      resizeCleanup = null;
    };
    resizeCleanup = stop;
    view.addEventListener("pointermove", onMove);
    view.addEventListener("pointerup", stop, { once: true });
    view.addEventListener("pointercancel", stop, { once: true });
  });
  resizeHandle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  let localContent: UserNoteContent = initial.content;
  let hydrating = false;
  let disposed = false;
  let previewGeneration = 0;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let renderedPreview: RenderedCardMarkdown | null = null;
  let sessionViewID = 0;
  let modeChangeReadOnly: boolean | null = null;
  const editor = createReaderCardMarkdownTextarea(doc, localContent.markdown);
  editor.setAttribute("aria-label", getString("reader-card-edit"));
  editorHost.append(editor);
  const disposeCompletion = bindTextareaWikiCompletion(
    editor,
    reference.relativePath,
  );
  const removeTextEntryMarker = markReaderEditorAsTextEntry(editorHost);

  const renderPreview = () => {
    const generation = ++previewGeneration;
    const markdownText = session.snapshot().content.markdown;
    void renderCardMarkdown(markdownText, reference, doc)
      .then((rendered) => {
        if (disposed || generation !== previewGeneration) {
          rendered.dispose();
          return;
        }
        renderedPreview?.dispose();
        renderedPreview = rendered;
        preview.innerHTML = rendered.html;
        knowledgeCard.refreshRelations();
      })
      .catch((error) => {
        if (generation !== previewGeneration) return;
        preview.textContent = String(error);
      });
  };

  function schedulePreview(): void {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPreview, 120);
  }

  const setMode = (mode: "edit" | "preview") => {
    const editing = mode === "edit";
    editorHost.hidden = !editing;
    preview.hidden = editing;
    editMode.setAttribute("aria-pressed", String(editing));
    previewMode.setAttribute("aria-pressed", String(!editing));
    if (editing) editor.focus();
    else renderPreview();
  };
  editMode.addEventListener("click", () => setMode("edit"));
  previewMode.addEventListener("click", () => setMode("preview"));

  editor.addEventListener("input", () => {
    if (hydrating || disposed) return;
    localContent = { ...localContent, markdown: editor.value };
    session.edit(localContent, sessionViewID);
    knowledgeCard.refreshRelations();
    if (!preview.hidden) schedulePreview();
  });
  editor.addEventListener("keydown", (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void session.requestSave();
    }
  });

  editor.addEventListener("compositionstart", () => {
    if (!session.beginComposition(sessionViewID)) {
      editor.readOnly = true;
    }
  });
  editor.addEventListener("compositionend", () => {
    session.endComposition(
      { ...localContent, markdown: editor.value },
      sessionViewID,
    );
  });

  for (const container of [preview]) {
    container.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]");
      const href = anchor?.getAttribute("href");
      if (!href || !isSafeLaunchURL(href)) {
        if (href) event.preventDefault();
        return;
      }
      event.preventDefault();
      bridge.launchURL(href);
    });
  }

  const knowledgeCard = createKnowledgeNoteCard({
    owner: root,
    controlHost: actions,
    createClient: createZoteroNoteQueryClient,
    prepareSurface: desktopKnowledgeCardsEnabled()
      ? createDesktopKnowledgeCardSurface
      : undefined,
    vaultPath: reference.vaultPath,
    launchURL: (url) => bridge.launchURL(url),
    root: {
      sourcePath: reference.relativePath,
      markdown: () => editor.value,
      previews: [preview],
      anchor: name,
    },
  });
  const disposeNoteLinks = bindNoteLinkNavigation({
    onNavigate: knowledgeCard.open,
    previews: [preview],
    editor,
    sourcePath: reference.relativePath,
    markdown: () => editor.value,
    offset: () =>
      editor.selectionStart === editor.selectionEnd
        ? editor.selectionStart
        : null,
    locateLocal: (offset) => {
      setMode("edit");
      editor.focus();
      editor.setSelectionRange(offset, offset);
    },
    status: createLinkStatus(modes),
  });
  const view = session.attachView((snapshot) => {
    void Promise.resolve().then(() => {
      if (!disposed) knowledgeCard.refreshRelations();
    });
    const anotherViewComposing =
      snapshot.composing && snapshot.compositionOwner !== sessionViewID;
    editor.readOnly = anotherViewComposing;
    if (snapshot.content.markdown !== editor.value) {
      hydrating = true;
      localContent = snapshot.content;
      editor.value = snapshot.content.markdown;
      hydrating = false;
      if (!preview.hidden) schedulePreview();
    } else {
      localContent = snapshot.content;
    }
    status.textContent = statusLabel(snapshot);
    status.dataset.state = snapshot.status;
    status.title = snapshot.error || status.textContent;
  });
  sessionViewID = view.id;

  const captureEditorContent = () => {
    const snapshot = session.snapshot();
    const content = { ...localContent, markdown: editor.value };
    if (snapshot.composing && snapshot.compositionOwner === sessionViewID) {
      session.endComposition(content, sessionViewID);
    } else if (
      content.title !== snapshot.content.title ||
      content.markdown !== snapshot.content.markdown
    ) {
      if (!session.edit(content, sessionViewID)) {
        throw new Error(
          "The editor is locked by another active IME composition.",
        );
      }
      localContent = content;
    }
  };

  return {
    element: root,
    async prepareForModeChange() {
      if (disposed) return "clean";
      if (modeChangeReadOnly === null) modeChangeReadOnly = editor.readOnly;
      captureEditorContent();
      editor.readOnly = true;
      try {
        await session.flushDraft();
      } catch (error) {
        editor.readOnly = modeChangeReadOnly;
        modeChangeReadOnly = null;
        throw error;
      }
      const snapshot = session.snapshot();
      if (snapshot.status === "pending") return "pending";
      if (
        snapshot.status !== "saved" ||
        snapshot.content.title !== snapshot.baseline.title ||
        snapshot.content.markdown !== snapshot.baseline.markdown
      ) {
        return "checkpointed";
      }
      return "clean";
    },
    cancelModeChange() {
      if (disposed || modeChangeReadOnly === null) return;
      editor.readOnly = modeChangeReadOnly;
      modeChangeReadOnly = null;
    },
    dispose() {
      if (disposed) return;
      try {
        captureEditorContent();
      } catch (error) {
        Zotero.debug(
          `[Zotero Obsidian Bridge] Could not capture Reader editor before teardown: ${String(error)}`,
        );
      }
      disposed = true;
      disposeCompletion();
      knowledgeCard.dispose();
      disposeNoteLinks();
      modeChangeReadOnly = null;
      windowView?.removeEventListener("resize", onViewportResize);
      removeTextEntryMarker();
      previewGeneration++;
      if (renderTimer) clearTimeout(renderTimer);
      resizeCleanup?.();
      renderedPreview?.dispose();
      renderedPreview = null;
      view.detach();
    },
  };
}
