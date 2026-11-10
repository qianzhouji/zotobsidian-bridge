import { basicSetup } from "codemirror";
import { codemirrorWikiCompletion } from "./codemirror-wiki-completion.ts";
import { createKnowledgeNoteCard } from "./knowledge-note-card.ts";
import { setEditorInputEnabled } from "../adapters/editor-input-state.ts";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
import {
  bindNoteLinkNavigation,
  createLinkStatus,
} from "./note-link-navigation.ts";
import { readFrontmatterValue } from "../core/markdown.ts";
import {
  createMarkdownRenderer,
  renderMarkdown,
} from "../core/markdown-preview.ts";
import {
  renderCardMarkdown,
  setMarkdownPreviewHTML,
  type RenderedCardMarkdown,
} from "./card-markdown-preview.ts";
import { formatLineDiff } from "../core/text-diff.ts";
import {
  readSourceMarkdown,
  readUserNoteContent,
  sameUserNoteContent,
} from "../core/note-content.ts";
import type { UserNoteContent } from "../core/note-content.ts";
import type { AnnotationCardReference } from "./annotation-card.ts";
import type { MarkdownEditorBridge } from "./markdown-editor.ts";
import type { EditorConflictRecoveryCopy } from "../adapters/editor-drafts.ts";
import {
  acquireEditorSession,
  type EditorSession,
  type EditorSessionConflict,
} from "./editor-session.ts";

type EditorWindow = Window & {
  arguments?: unknown[];
};

interface DiskVersion {
  content: UserNoteContent;
  source: string;
}

export interface EditorWindowOptions {
  mode?: "pending-card";
}

async function readDiskVersion(
  reference: AnnotationCardReference,
  bridge: MarkdownEditorBridge,
): Promise<DiskVersion> {
  const markdown = await bridge.readCard();
  if (markdown === null) throw new Error("The linked card no longer exists.");
  if (readFrontmatterValue(markdown, "bridge_card_id") !== reference.cardID) {
    throw new Error("Card identity changed; the editor is now read-only.");
  }
  return {
    content: readUserNoteContent(markdown),
    source: readSourceMarkdown(markdown),
  };
}

function getElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Editor window is missing #${id}.`);
  return element as T;
}

function setStatus(document: Document, text: string, state = "idle"): void {
  const status = getElement<HTMLDivElement>(document, "status");
  status.textContent = text;
  status.dataset.state = state;
}

function renderLineDiff(
  document: Document,
  container: HTMLElement,
  before: string,
  after: string,
): void {
  container.replaceChildren();
  const chunks = formatLineDiff(before, after);
  if (chunks.length === 0) {
    container.textContent = "No differences.";
    return;
  }
  for (const chunk of chunks) {
    const span = document.createElement("span");
    span.className = `diff-${chunk.kind}`;
    const prefix =
      chunk.kind === "added" ? "+ " : chunk.kind === "removed" ? "- " : "  ";
    span.textContent =
      chunk.lines.map((line) => `${prefix}${line}`).join("\n") + "\n";
    container.append(span);
  }
}

function setDocumentText(element: HTMLElement, markdownText: string): void {
  setMarkdownPreviewHTML(element, renderMarkdown(markdownText));
}

function setSourcePreview(
  element: HTMLElement,
  markdownText: string,
  preferredColor?: string,
): void {
  const legacyColor = /^\s*\*\*Highlight color:\*\*\s*(#[\da-f]{6})\s*$/im.exec(
    markdownText,
  )?.[1];
  const color = [preferredColor, legacyColor].find(
    (value) => typeof value === "string" && /^#[\da-f]{6}$/i.test(value),
  );
  const visibleMarkdown = markdownText
    .replace(/^\s*\*\*Highlight color:\*\*\s*#[\da-f]{6}\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n");
  setDocumentText(element, visibleMarkdown);

  const quote = element.querySelector<HTMLElement>("blockquote");
  if (!quote) return;
  quote.style.padding = "0";
  quote.style.color = "#202426";
  quote.style.backgroundColor = "transparent";
  quote.style.border = "0";
  for (const paragraph of quote.querySelectorAll<HTMLElement>("p")) {
    paragraph.style.backgroundColor = color ?? "transparent";
    paragraph.style.color = "#202426";
  }
}

function installResizableLayout(
  window: EditorWindow,
  document: Document,
): void {
  const app = getElement<HTMLElement>(document, "app");
  const source = getElement<HTMLElement>(document, "source-section");
  const sourceSplitter = getElement<HTMLElement>(document, "source-splitter");
  const workspace = getElement<HTMLElement>(document, "workspace");
  const paneSplitter = getElement<HTMLElement>(document, "workspace-splitter");
  const storageKey = "zotero-obsidian-bridge:editor-layout:v1";
  let sourceHeight = 112;
  let editorRatio = 1;
  let storage: Storage | null = null;

  try {
    storage = window.localStorage;
    const saved = JSON.parse(storage?.getItem(storageKey) ?? "null");
    if (Number.isFinite(saved?.sourceHeight)) sourceHeight = saved.sourceHeight;
    if (Number.isFinite(saved?.editorRatio)) editorRatio = saved.editorRatio;
  } catch {
    // Layout remains usable when chrome storage is unavailable.
  }

  const saveLayout = () => {
    if (!storage) return;
    try {
      storage.setItem(
        storageKey,
        JSON.stringify({ sourceHeight, editorRatio }),
      );
    } catch {
      // Resizing does not depend on persistence.
    }
  };
  const setSourceHeight = (value: number) => {
    const max = Math.max(56, window.innerHeight - 240);
    sourceHeight = Math.round(Math.min(max, Math.max(56, value)));
    app.style.setProperty("--source-height", `${sourceHeight}px`);
    sourceSplitter.setAttribute("aria-valuenow", String(sourceHeight));
  };
  const setEditorRatio = (value: number) => {
    editorRatio = Math.min(2.2, Math.max(0.45, value));
    workspace.style.setProperty("--editor-track", `${editorRatio}fr`);
    paneSplitter.setAttribute(
      "aria-valuenow",
      String(Math.round((editorRatio / (editorRatio + 1)) * 100)),
    );
  };

  setSourceHeight(sourceHeight);
  setEditorRatio(editorRatio);

  const bindSplitter = (
    splitter: HTMLElement,
    orientation: "horizontal" | "vertical",
  ) => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        orientation === "horizontal" &&
        ["ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        setSourceHeight(sourceHeight + (event.key === "ArrowDown" ? 12 : -12));
        saveLayout();
      } else if (
        orientation === "vertical" &&
        ["ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        event.preventDefault();
        setEditorRatio(editorRatio + (event.key === "ArrowRight" ? 0.1 : -0.1));
        saveLayout();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startHeight = source.getBoundingClientRect().height;
      const startRatio = editorRatio;
      const startWorkspace = workspace.getBoundingClientRect();
      const onMove = (moveEvent: PointerEvent) => {
        if (orientation === "horizontal") {
          setSourceHeight(startHeight + moveEvent.clientY - startY);
          return;
        }
        const fraction = Math.min(
          0.72,
          Math.max(
            0.28,
            (moveEvent.clientX - startWorkspace.left) / startWorkspace.width,
          ),
        );
        setEditorRatio(fraction / (1 - fraction));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        saveLayout();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
      window.addEventListener("pointercancel", onUp, { once: true });
      if (orientation === "vertical") setEditorRatio(startRatio);
    };
    splitter.addEventListener("keydown", onKeyDown);
    splitter.addEventListener("pointerdown", onPointerDown);
  };

  bindSplitter(sourceSplitter, "horizontal");
  bindSplitter(paneSplitter, "vertical");
  window.addEventListener("resize", () => setSourceHeight(sourceHeight));
}

function isSafeExternalLink(rawURL: string): boolean {
  try {
    const url = new URL(rawURL);
    return ["http:", "https:", "mailto:", "zotero:", "obsidian:"].includes(
      url.protocol,
    );
  } catch {
    return false;
  }
}

export async function initializeMarkdownEditor(
  window: EditorWindow,
  reference: AnnotationCardReference,
  bridge: MarkdownEditorBridge,
  sharedSession?: EditorSession,
  options: EditorWindowOptions = {},
): Promise<void> {
  const { document } = window;
  installResizableLayout(window, document);
  const titleInput = getElement<HTMLInputElement>(document, "note-title");
  const editorHost = getElement<HTMLDivElement>(document, "editor-host");
  const preview = getElement<HTMLDivElement>(document, "preview");
  const sourcePreview = getElement<HTMLDivElement>(document, "source-preview");
  const conflictPanel = getElement<HTMLElement>(document, "conflict-panel");
  const conflictBase = getElement<HTMLElement>(document, "base-version");
  const conflictDisk = getElement<HTMLElement>(document, "disk-version");
  const conflictLocal = getElement<HTMLElement>(document, "local-version");
  const diskDiff = getElement<HTMLElement>(document, "disk-diff");
  const localDiff = getElement<HTMLElement>(document, "local-diff");
  const recoveryDialog = getElement<HTMLDialogElement>(
    document,
    "recovery-dialog",
  );
  const recoverySelect = getElement<HTMLSelectElement>(
    document,
    "recovery-select",
  );
  const recoveryPreview = getElement<HTMLElement>(document, "recovery-preview");
  const recoveryStatus = getElement<HTMLElement>(document, "recovery-status");
  const restoreButton = getElement<HTMLButtonElement>(document, "restore-copy");
  const recoveryButton = getElement<HTMLButtonElement>(
    document,
    "recovery-copies",
  );
  const recoveryCopies: EditorConflictRecoveryCopy[] = [];
  if (options.mode === "pending-card") {
    getElement<HTMLButtonElement>(document, "open-obsidian").hidden = true;
    recoveryButton.hidden = true;
    getElement<HTMLButtonElement>(document, "open-zotero").hidden = true;
  }
  const session =
    sharedSession ??
    acquireEditorSession(
      {
        vaultPath: reference.vaultPath,
        cardID: reference.cardID,
        sourceID: reference.sourceID,
        relativePath: reference.relativePath,
      },
      {
        readDisk: () => readDiskVersion(reference, bridge),
        readDraft: (cardID) => bridge.readDraft(cardID),
        writeDraft: (draft) => bridge.writeDraft(draft),
        deleteDraft: (cardID) => bridge.deleteDraft(cardID),
        save: (baseline, next, force = false) =>
          bridge.saveUserContent(baseline, next, force),
      },
    );
  const initialSession = await session.initialize();
  let baseline: UserNoteContent = initialSession.baseline;
  let currentSource = initialSession.source;
  let conflict: EditorSessionConflict | null = initialSession.conflict;
  let composing = initialSession.composing;
  let vaultUnavailable = initialSession.vaultUnavailable;
  let localContent: UserNoteContent = initialSession.content;
  let hydrating = false;
  let disposed = false;

  const recoveryMessages = bridge.recoveryMessages;
  getElement<HTMLElement>(document, "recovery-heading").textContent =
    recoveryMessages.copies;
  getElement<HTMLElement>(document, "recovery-description").textContent =
    recoveryMessages.description;
  getElement<HTMLElement>(document, "recovery-label").textContent =
    recoveryMessages.label;
  restoreButton.textContent = recoveryMessages.restore;

  const renderRecoveryPreview = () => {
    const selected = recoveryCopies[Number(recoverySelect.value)];
    recoveryPreview.textContent = selected
      ? [
          selected.draft.title ? `# ${selected.draft.title}` : "# (Untitled)",
          "",
          selected.draft.markdown,
        ].join("\n")
      : "";
    restoreButton.disabled = !selected;
  };

  recoverySelect.addEventListener("change", renderRecoveryPreview);
  getElement<HTMLButtonElement>(document, "close-recovery").addEventListener(
    "click",
    () => recoveryDialog.close(),
  );
  recoveryButton.addEventListener("click", () => {
    recoveryStatus.textContent = "";
    recoverySelect.replaceChildren();
    recoveryCopies.length = 0;
    void bridge
      .listRecoveryCopies(
        reference.cardID,
        reference.sourceID,
        reference.relativePath,
      )
      .then((copies) => {
        recoveryCopies.push(...copies);
        for (const [index, copy] of recoveryCopies.entries()) {
          const option = document.createElement("option");
          option.value = String(index);
          option.textContent = `${new Date(copy.archivedAt).toLocaleString()} · ${copy.resolution}`;
          recoverySelect.append(option);
        }
        recoveryStatus.textContent = copies.length
          ? ""
          : recoveryMessages.empty;
        renderRecoveryPreview();
        recoveryDialog.showModal();
      })
      .catch((error) => {
        recoveryStatus.textContent = `${recoveryMessages.failedPrefix}\n${String(error)}`;
        recoveryDialog.showModal();
      });
  });
  restoreButton.addEventListener("click", () => {
    const selected = recoveryCopies[Number(recoverySelect.value)];
    if (!selected || composing) return;
    if (!window.confirm(recoveryMessages.confirm)) return;
    restoreButton.disabled = true;
    recoveryStatus.textContent = "";
    void (async () => {
      await session.requestSave();
      await session.flushDraft();
      const restoreRevision = session.snapshot().revision;
      const local = currentContent();
      const latest = await readDiskVersion(reference, bridge);
      const now = new Date().toISOString();
      await bridge.archiveConflict({
        schema: 1,
        cardID: reference.cardID,
        sourceID: reference.sourceID,
        relativePath: reference.relativePath,
        baseline: session.snapshot().baseline,
        disk: latest.content,
        draft: local,
        updatedAt: now,
        resolution: "restore-copy",
        archivedAt: now,
      });
      if (session.snapshot().revision !== restoreRevision) {
        throw new Error("Editor changed while preparing the restore; retry.");
      }
      const result = await session.restore(
        latest.content,
        selected.draft,
        restoreRevision,
      );
      if (result.status === "conflict") {
        renderConflict();
        recoveryStatus.textContent = recoveryMessages.conflict;
        return;
      }
      if (result.status === "error") throw new Error(result.message);
      if (result.status === "pending") {
        recoveryStatus.textContent =
          "Waiting for Obsidian to apply the restore.";
        setStatus(document, "Waiting for Obsidian", "pending");
        return;
      }
      renderConflict();
      recoveryStatus.textContent = recoveryMessages.restored;
      setStatus(document, recoveryMessages.restored, "saved");
    })()
      .catch((error) => {
        recoveryStatus.textContent = `${recoveryMessages.failedPrefix}\n${String(error)}`;
        setStatus(document, recoveryStatus.textContent, "error");
      })
      .finally(() => {
        renderRecoveryPreview();
      });
  });

  const docTitle = getElement<HTMLElement>(document, "document-title");
  const meta = getElement<HTMLElement>(document, "paper-meta");
  docTitle.textContent = reference.paperTitle || "Untitled paper";
  meta.textContent =
    options.mode === "pending-card"
      ? [reference.paperCreator, "Obsidian card creation pending"]
          .filter(Boolean)
          .join(" | ")
      : [reference.paperCreator, reference.relativePath]
          .filter(Boolean)
          .join(" | ");

  const md = createMarkdownRenderer();
  let previewGeneration = 0;
  let renderedUserPreview: RenderedCardMarkdown | null = null;
  let lastPreviewMarkdown: string | undefined;
  let lastSourceMarkdown: string | undefined;
  let refreshKnowledgeRelations = () => {};
  const renderSourcePreview = () => {
    if (currentSource === lastSourceMarkdown) return;
    lastSourceMarkdown = currentSource;
    setSourcePreview(sourcePreview, currentSource, reference.annotationColor);
  };
  const renderUserPreview = (markdownText: string) => {
    refreshKnowledgeRelations();
    if (markdownText === lastPreviewMarkdown) return;
    lastPreviewMarkdown = markdownText;
    const generation = ++previewGeneration;
    void renderCardMarkdown(
      markdownText,
      reference,
      document,
      (_rootPath, relativePath) => bridge.readPreviewImage(relativePath),
    )
      .then((rendered) => {
        if (disposed || generation !== previewGeneration) {
          rendered.dispose();
          return;
        }
        renderedUserPreview?.dispose();
        renderedUserPreview = rendered;
        setMarkdownPreviewHTML(preview, rendered.html);
        refreshKnowledgeRelations();
      })
      .catch((error) => {
        if (generation !== previewGeneration) return;
        lastPreviewMarkdown = undefined;
        setStatus(document, `Preview failed: ${String(error)}`, "error");
      });
  };
  const editor = new EditorView({
    state: EditorState.create({
      doc: localContent.markdown,
      extensions: [
        basicSetup,
        markdown(),
        codemirrorWikiCompletion(document, reference.relativePath, () =>
          bridge.createNoteQueryClient(),
        ),
        EditorView.theme({
          "&": { height: "100%", fontSize: "14px" },
          ".cm-scroller": { overflow: "auto", fontFamily: "inherit" },
          ".cm-content": { padding: "14px", minHeight: "100%" },
          ".cm-line": { padding: "0 2px" },
        }),
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              void queueSave();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || hydrating) return;
          localContent = {
            ...localContent,
            markdown: update.state.doc.toString(),
          };
          renderUserPreview(localContent.markdown);
          if (conflict) renderConflict();
          if (composing) session.edit(currentContent(), sessionViewID);
          else scheduleSave();
        }),
      ],
    }),
    parent: editorHost,
  });

  const renderConflict = () => {
    if (!conflict) {
      conflictPanel.setAttribute("hidden", "");
      return;
    }
    conflictPanel.removeAttribute("hidden");
    const format = (value: UserNoteContent) =>
      [value.title ? `# ${value.title}` : "# (Untitled)", "", value.markdown]
        .join("\n")
        .trim();
    conflictBase.textContent = format(conflict.baseline);
    conflictDisk.textContent = format(conflict.disk);
    conflictLocal.textContent = format(localContent);
    renderLineDiff(
      document,
      diskDiff,
      format(conflict.baseline),
      format(conflict.disk),
    );
    renderLineDiff(
      document,
      localDiff,
      format(conflict.baseline),
      format(localContent),
    );
    setStatus(
      document,
      "Conflict: both versions are preserved. Choose one to continue.",
      "conflict",
    );
  };

  const hydrate = (content: UserNoteContent) => {
    hydrating = true;
    try {
      titleInput.value = content.title;
      localContent = { ...content };
      const previous = editor.state.doc.toString();
      if (previous !== content.markdown) {
        let from = 0;
        while (
          from < previous.length &&
          from < content.markdown.length &&
          previous[from] === content.markdown[from]
        )
          from++;
        let end = previous.length;
        let nextEnd = content.markdown.length;
        while (
          end > from &&
          nextEnd > from &&
          previous[end - 1] === content.markdown[nextEnd - 1]
        ) {
          end--;
          nextEnd--;
        }
        editor.dispatch({
          changes: {
            from,
            to: end,
            insert: content.markdown.slice(from, nextEnd),
          },
        });
      }
      renderUserPreview(content.markdown);
    } finally {
      hydrating = false;
    }
  };

  const currentContent = (): UserNoteContent => ({
    title: titleInput.value,
    markdown: editor.state.doc.toString(),
  });

  let sessionViewID = 0;
  const sessionView = session.attachView((snapshot) => {
    baseline = snapshot.baseline;
    currentSource = snapshot.source;
    conflict = snapshot.conflict;
    composing = snapshot.composing;
    vaultUnavailable = snapshot.vaultUnavailable;
    const otherViewComposing =
      snapshot.composing && snapshot.compositionOwner !== sessionViewID;
    setEditorInputEnabled(editor.contentDOM, titleInput, !otherViewComposing);
    const ownsComposition =
      snapshot.composing && snapshot.compositionOwner === sessionViewID;
    if (
      !ownsComposition &&
      !sameUserNoteContent(localContent, snapshot.content)
    ) {
      hydrate(snapshot.content);
    }
    if (!ownsComposition) localContent = snapshot.content;
    renderSourcePreview();
    renderUserPreview(localContent.markdown);
    if (conflict) {
      renderConflict();
      return;
    }
    renderConflict();
    if (snapshot.status === "error") {
      setStatus(document, `Save failed: ${snapshot.error}`, "error");
    } else if (snapshot.status === "offline") {
      setStatus(
        document,
        `Vault unavailable; ${snapshot.draftPersisted ? "local draft saved" : "local draft not confirmed"}: ${snapshot.error}`,
        "error",
      );
    } else {
      const labels = {
        saved: "Saved",
        dirty: snapshot.draftPersisted
          ? "Local draft saved; sync pending"
          : "Unsaved changes",
        saving: "Saving",
        pending: "Waiting for Obsidian",
        conflict: "Conflict",
        error: "Save failed",
        offline: "Vault unavailable",
      } as const;
      if (options.mode === "pending-card") {
        const pendingLabels = {
          saved:
            snapshot.revision > 0
              ? "Local draft saved; card creation pending"
              : "Card creation pending",
          dirty: snapshot.draftPersisted
            ? "Local draft saved; card creation pending"
            : "Saving local draft",
          saving: "Saving local draft",
          pending: "Local draft saved; card creation pending",
          conflict: "Local draft conflict",
          error: `Local draft save failed: ${snapshot.error}`,
          offline: `Local draft unavailable: ${snapshot.error}`,
        } as const;
        setStatus(
          document,
          pendingLabels[snapshot.status],
          snapshot.status === "saved" ? "pending" : snapshot.status,
        );
      } else {
        setStatus(document, labels[snapshot.status], snapshot.status);
      }
    }
  });
  sessionViewID = sessionView.id;

  function scheduleSave(): void {
    if (disposed || composing) return;
    session.edit(currentContent(), sessionViewID);
    if (conflict) {
      renderConflict();
    } else {
      setStatus(document, "Unsaved changes", "dirty");
    }
  }

  function queueSave(): Promise<void> {
    if (disposed) return Promise.resolve();
    return session.requestSave().catch((error) => {
      setStatus(document, `Save failed: ${String(error)}`, "error");
    });
  }

  const archiveConflict = async (
    resolution: "use-disk" | "keep-local",
    disk: UserNoteContent,
    local: UserNoteContent,
  ) => {
    if (!conflict) return;
    await bridge.archiveConflict({
      schema: 1,
      cardID: reference.cardID,
      sourceID: reference.sourceID,
      relativePath: reference.relativePath,
      baseline: conflict.baseline,
      disk,
      draft: local,
      updatedAt: new Date().toISOString(),
      resolution,
      archivedAt: new Date().toISOString(),
    });
  };

  getElement<HTMLButtonElement>(document, "use-disk").addEventListener(
    "click",
    () => {
      void (async () => {
        const expectedRevision = session.snapshot().revision;
        const local = currentContent();
        const latest = await readDiskVersion(reference, bridge);
        await archiveConflict("use-disk", latest.content, local);
        await session.useDisk(latest.content, latest.source, expectedRevision);
        setStatus(document, "Using the Obsidian version", "saved");
      })().catch((error) =>
        setStatus(
          document,
          `Could not switch versions: ${String(error)}`,
          "error",
        ),
      );
    },
  );

  getElement<HTMLButtonElement>(document, "keep-local").addEventListener(
    "click",
    () => {
      void (async () => {
        const expectedRevision = session.snapshot().revision;
        const local = currentContent();
        const latest = await readDiskVersion(reference, bridge);
        await archiveConflict("keep-local", latest.content, local);
        const result = await session.keepLocal(
          latest.content,
          local,
          expectedRevision,
        );
        if (result.status === "error") throw new Error(result.message);
        if (result.status === "conflict") {
          renderConflict();
          return;
        }
        if (result.status === "pending") return;
        setStatus(
          document,
          "Local version saved; both versions are archived",
          "saved",
        );
      })().catch((error) =>
        setStatus(
          document,
          `Could not keep the local version: ${String(error)}`,
          "error",
        ),
      );
    },
  );

  titleInput.value = localContent.title;
  titleInput.addEventListener("input", () => {
    localContent = { ...localContent, title: titleInput.value };
    if (conflict) renderConflict();
    if (!hydrating) scheduleSave();
  });
  editor.contentDOM.addEventListener("compositionstart", () => {
    if (!session.beginComposition(sessionViewID)) return;
    composing = true;
    setStatus(document, "Composing", "saving");
  });
  editor.contentDOM.addEventListener("compositionend", () => {
    void Promise.resolve().then(() => {
      if (disposed || session.snapshot().compositionOwner !== sessionViewID)
        return;
      composing = false;
      session.endComposition(currentContent(), sessionViewID);
    });
  });

  for (const container of [preview, sourcePreview]) {
    container.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      const anchor = target.closest("a[href]");
      const href = anchor?.getAttribute("href");
      if (!href || !isSafeExternalLink(href)) return;
      event.preventDefault();
      bridge.launchURL(href);
    });
  }

  const knowledgeCard = createKnowledgeNoteCard({
    owner: getElement<HTMLElement>(document, "workspace"),
    controlHost: document.querySelector<HTMLElement>(".actions") ?? undefined,
    createClient: () => bridge.createNoteQueryClient(),
    prepareSurface: bridge.prepareKnowledgeCardSurface,
    vaultPath: reference.vaultPath,
    launchURL: (url) => bridge.launchURL(url),
    root: {
      sourcePath: reference.relativePath,
      markdown: () => editor.state.doc.toString(),
      previews: [preview],
      anchor: docTitle,
    },
  });
  refreshKnowledgeRelations = knowledgeCard.refreshRelations;
  const disposeNoteLinks = bindNoteLinkNavigation({
    onNavigate: knowledgeCard.open,
    createClient: () => bridge.createNoteQueryClient(),
    previews: [preview, sourcePreview],
    editor: editor.contentDOM,
    sourcePath: reference.relativePath,
    markdown: () => editor.state.doc.toString(),
    offset: (event) =>
      editor.posAtCoords({ x: event.clientX, y: event.clientY }),
    locateLocal: (offset) => {
      editor.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
      editor.focus();
    },
    status: createLinkStatus((preview.parentElement ?? preview) as HTMLElement),
  });
  renderSourcePreview();
  renderUserPreview(localContent.markdown);
  getElement<HTMLButtonElement>(document, "save-now").addEventListener(
    "click",
    () => void queueSave(),
  );
  getElement<HTMLButtonElement>(document, "open-zotero").addEventListener(
    "click",
    () => bridge.launchURL(reference.zoteroURI),
  );
  getElement<HTMLButtonElement>(document, "open-obsidian").addEventListener(
    "click",
    () =>
      bridge.launchURL(
        `obsidian://open?path=${encodeURIComponent(reference.absolutePath)}`,
      ),
  );
  let closing = false;
  const closeEditor = () => {
    if (closing || disposed) return;
    closing = true;
    const content = currentContent();
    if (session.snapshot().compositionOwner === sessionViewID) {
      session.endComposition(content, sessionViewID);
    } else if (!sameUserNoteContent(content, session.snapshot().content)) {
      if (!session.edit(content, sessionViewID)) {
        closing = false;
        return;
      }
    }
    void session
      .flushDraft()
      .then(() => window.close())
      .catch((error) => {
        closing = false;
        setStatus(
          document,
          `Close cancelled; draft checkpoint failed: ${String(error)}`,
          "error",
        );
      });
  };
  getElement<HTMLButtonElement>(document, "close-editor").addEventListener(
    "click",
    closeEditor,
  );
  window.addEventListener(
    "keydown",
    (rawEvent) => {
      const event = rawEvent as KeyboardEvent;
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "w"
      ) {
        event.preventDefault();
        event.stopPropagation();
        closeEditor();
      }
    },
    true,
  );

  if (conflict) renderConflict();
  else if (options.mode === "pending-card") {
    setStatus(document, "Card creation pending", "pending");
  } else if (vaultUnavailable) {
    setStatus(document, "Vault unavailable; local draft recovered", "error");
  } else if (initialSession.revision > 0) {
    setStatus(document, "Recovered local draft", "dirty");
  } else {
    setStatus(document, "Saved", "saved");
  }

  const onFocus = () => void session.poll();
  window.addEventListener("focus", onFocus);
  window.addEventListener(
    "pagehide",
    () => {
      disposed = true;
      disposeNoteLinks();
      knowledgeCard.dispose();
      previewGeneration++;
      renderedUserPreview?.dispose();
      renderedUserPreview = null;
      const content = currentContent();
      if (!sameUserNoteContent(content, session.snapshot().content)) {
        session.edit(content, sessionViewID);
      }
      window.removeEventListener("focus", onFocus);
      sessionView.detach();
      editor.destroy();
    },
    { once: true },
  );
}

export function initializeEditorWindow(window: EditorWindow): void {
  const reference = window.arguments?.[0] as
    | AnnotationCardReference
    | undefined;
  const bridge = window.arguments?.[1] as MarkdownEditorBridge | undefined;
  const session = window.arguments?.[2] as EditorSession | undefined;
  const options = window.arguments?.[3] as EditorWindowOptions | undefined;
  if (!reference || !bridge) {
    const status = window.document.getElementById("status");
    if (status) status.textContent = "Editor card reference was not provided.";
    return;
  }
  void initializeMarkdownEditor(
    window,
    reference,
    bridge,
    session,
    options,
  ).catch((error) => {
    const status = window.document.getElementById("status");
    if (status) {
      status.textContent = `Editor failed to load: ${String(error)}`;
      status.setAttribute("data-state", "error");
    }
  });
}
