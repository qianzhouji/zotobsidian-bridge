import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
import { readFrontmatterValue } from "../core/markdown.ts";
import {
  createMarkdownRenderer,
  renderMarkdown,
} from "../core/markdown-preview.ts";
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

const pollIntervalMs = 1600;
const draftDelayMs = 300;
const saveDelayMs = 750;

type EditorWindow = Window & {
  arguments?: unknown[];
};

interface DiskVersion {
  content: UserNoteContent;
  source: string;
}

interface ConflictState {
  baseline: UserNoteContent;
  disk: UserNoteContent;
  local: UserNoteContent;
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
  element.innerHTML = renderMarkdown(markdownText);
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
): Promise<void> {
  const { document } = window;
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
  const savedDraft = await bridge.readDraft(reference.cardID);
  let firstVersion: DiskVersion;
  let vaultUnavailable = false;
  try {
    firstVersion = await readDiskVersion(reference, bridge);
  } catch (error) {
    if (!savedDraft) throw error;
    firstVersion = { content: savedDraft.baseline, source: "" };
    vaultUnavailable = true;
  }
  let baseline: UserNoteContent = firstVersion.content;
  let currentSource = "";
  let conflict: ConflictState | null = null;
  let composing = false;
  let hydrating = false;
  let disposed = false;
  let draftTimer = 0;
  let saveTimer = 0;
  let saveTail: Promise<void> = Promise.resolve();
  let draftTail: Promise<void> = Promise.resolve();
  let pollTimer = 0;

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
    window.clearTimeout(saveTimer);
    window.clearTimeout(draftTimer);
    void (async () => {
      await saveTail;
      await draftTail;
      const latest = await readDiskVersion(reference, bridge);
      const local = currentContent();
      const now = new Date().toISOString();
      await bridge.archiveConflict({
        schema: 1,
        cardID: reference.cardID,
        sourceID: reference.sourceID,
        relativePath: reference.relativePath,
        baseline: { ...baseline },
        disk: latest.content,
        draft: local,
        updatedAt: now,
        resolution: "restore-copy",
        archivedAt: now,
      });
      const result = await bridge.saveUserContent(
        latest.content,
        selected.draft,
      );
      if (result.status === "conflict") {
        conflict = {
          baseline: latest.content,
          disk: result.current,
          local: selected.draft,
        };
        renderConflict();
        recoveryStatus.textContent = recoveryMessages.conflict;
        return;
      }
      if (result.status === "error") throw new Error(result.message);
      baseline = { ...selected.draft, title: selected.draft.title.trim() };
      conflict = null;
      hydrate(baseline);
      renderConflict();
      await clearDraft();
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

  const writeDraft = (content: UserNoteContent) => {
    const snapshot = {
      schema: 1 as const,
      cardID: reference.cardID,
      sourceID: reference.sourceID,
      relativePath: reference.relativePath,
      baseline: { ...baseline },
      draft: { ...content },
      updatedAt: new Date().toISOString(),
    };
    const operation = draftTail.then(() => bridge.writeDraft(snapshot));
    draftTail = operation.catch(() => {});
    return operation;
  };

  const clearDraft = async () => {
    await draftTail;
    await bridge.deleteDraft(reference.cardID);
  };

  const docTitle = getElement<HTMLElement>(document, "document-title");
  const meta = getElement<HTMLElement>(document, "paper-meta");
  docTitle.textContent = reference.paperTitle || "Untitled paper";
  meta.textContent = [reference.paperCreator, reference.relativePath]
    .filter(Boolean)
    .join(" | ");

  currentSource = firstVersion.source;
  let localContent = { ...baseline };
  if (savedDraft) {
    if (
      savedDraft.sourceID !== reference.sourceID ||
      savedDraft.relativePath !== reference.relativePath
    ) {
      throw new Error(
        "A recovery draft exists for a different card location; it was preserved.",
      );
    }
    if (
      !vaultUnavailable &&
      sameUserNoteContent(savedDraft.draft, firstVersion.content)
    ) {
      await clearDraft();
    } else {
      baseline = savedDraft.baseline;
      localContent = savedDraft.draft;
      if (
        !vaultUnavailable &&
        !sameUserNoteContent(firstVersion.content, savedDraft.baseline)
      ) {
        conflict = {
          baseline: savedDraft.baseline,
          disk: firstVersion.content,
          local: savedDraft.draft,
        };
      }
    }
  }

  const md = createMarkdownRenderer();
  const editor = new EditorView({
    state: EditorState.create({
      doc: localContent.markdown,
      extensions: [
        basicSetup,
        markdown(),
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
          preview.innerHTML = md.render(localContent.markdown);
          if (conflict) renderConflict();
          if (!composing) scheduleSave();
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
    titleInput.value = content.title;
    localContent = { ...content };
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: content.markdown,
      },
    });
    preview.innerHTML = md.render(content.markdown);
    hydrating = false;
  };

  const currentContent = (): UserNoteContent => ({
    title: titleInput.value,
    markdown: editor.state.doc.toString(),
  });

  function scheduleSave(): void {
    if (disposed || composing) return;
    window.clearTimeout(draftTimer);
    window.clearTimeout(saveTimer);
    draftTimer = window.setTimeout(() => {
      void writeDraft(currentContent()).catch((error) =>
        setStatus(
          document,
          `Draft could not be stored: ${String(error)}`,
          "error",
        ),
      );
    }, draftDelayMs);
    if (conflict) {
      renderConflict();
    } else {
      saveTimer = window.setTimeout(() => void queueSave(), saveDelayMs);
      setStatus(document, "Unsaved changes", "dirty");
    }
  }

  function queueSave(): Promise<void> {
    if (disposed || composing || conflict) return saveTail;
    window.clearTimeout(saveTimer);
    const snapshot = currentContent();
    saveTail = saveTail
      .then(async () => {
        if (disposed || conflict) return;
        if (sameUserNoteContent(snapshot, baseline)) {
          await clearDraft();
          setStatus(document, "Saved", "saved");
          return;
        }
        setStatus(document, "Saving", "saving");
        await writeDraft(snapshot);
        const result = await bridge.saveUserContent(baseline, snapshot);
        if (result.status === "error") throw new Error(result.message);
        if (result.status === "conflict") {
          conflict = {
            baseline,
            disk: result.current,
            local: currentContent(),
          };
          await writeDraft(currentContent());
          renderConflict();
          return;
        }
        baseline = { ...snapshot, title: snapshot.title.trim() };
        if (sameUserNoteContent(currentContent(), snapshot)) {
          await clearDraft();
          conflict = null;
          renderConflict();
          setStatus(document, "Saved", "saved");
        } else {
          await writeDraft(currentContent());
          setStatus(document, "Newer edits are waiting to save", "dirty");
          window.setTimeout(() => void queueSave(), 0);
        }
      })
      .catch((error) =>
        setStatus(document, `Save failed: ${String(error)}`, "error"),
      );
    return saveTail;
  }

  const adoptDisk = async (disk: UserNoteContent) => {
    baseline = { ...disk };
    conflict = null;
    hydrate(disk);
    renderConflict();
    await clearDraft();
    setStatus(document, "Using the Obsidian version", "saved");
  };

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
        const latest = await readDiskVersion(reference, bridge);
        const local = currentContent();
        await archiveConflict("use-disk", latest.content, local);
        await adoptDisk(latest.content);
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
        const latest = await readDiskVersion(reference, bridge);
        const local = currentContent();
        await archiveConflict("keep-local", latest.content, local);
        const result = await bridge.saveUserContent(
          latest.content,
          local,
          true,
        );
        if (result.status === "error") throw new Error(result.message);
        if (result.status === "conflict") {
          conflict = {
            baseline: latest.content,
            disk: result.current,
            local,
          };
          renderConflict();
          return;
        }
        baseline = { ...local, title: local.title.trim() };
        conflict = null;
        renderConflict();
        await clearDraft();
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
    composing = true;
    window.clearTimeout(draftTimer);
    window.clearTimeout(saveTimer);
    setStatus(document, "Composing", "saving");
  });
  editor.contentDOM.addEventListener("compositionend", () => {
    composing = false;
    scheduleSave();
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

  setDocumentText(sourcePreview, currentSource);
  preview.innerHTML = md.render(localContent.markdown);
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
  getElement<HTMLButtonElement>(document, "close-editor").addEventListener(
    "click",
    () => window.close(),
  );

  if (conflict) renderConflict();
  else if (vaultUnavailable) {
    setStatus(document, "Vault unavailable; local draft recovered", "error");
  } else {
    setStatus(
      document,
      savedDraft ? "Recovered local draft" : "Saved",
      savedDraft ? "dirty" : "saved",
    );
  }

  const pollExternalChanges = async () => {
    if (disposed || composing) return;
    try {
      const latest = await readDiskVersion(reference, bridge);
      if (latest.source !== currentSource) {
        currentSource = latest.source;
        setDocumentText(sourcePreview, currentSource);
      }
      if (sameUserNoteContent(latest.content, baseline)) {
        vaultUnavailable = false;
        if (!conflict && !sameUserNoteContent(currentContent(), baseline)) {
          void queueSave();
        }
        return;
      }
      vaultUnavailable = false;
      if (!conflict && sameUserNoteContent(currentContent(), baseline)) {
        await adoptDisk(latest.content);
      } else {
        conflict = {
          baseline,
          disk: latest.content,
          local: currentContent(),
        };
        await writeDraft(currentContent());
        renderConflict();
      }
    } catch (error) {
      setStatus(
        document,
        `Vault check failed; local draft is retained: ${String(error)}`,
        "error",
      );
    }
  };

  pollTimer = window.setInterval(
    () => void pollExternalChanges(),
    pollIntervalMs,
  );
  window.addEventListener("focus", () => void pollExternalChanges());
  window.addEventListener(
    "pagehide",
    () => {
      disposed = true;
      window.clearInterval(pollTimer);
      window.clearTimeout(draftTimer);
      window.clearTimeout(saveTimer);
      const content = currentContent();
      if (!sameUserNoteContent(content, baseline)) {
        void writeDraft(content).catch(() => {});
      }
      editor.destroy();
    },
    { once: true },
  );
  if (savedDraft && !conflict) scheduleSave();
}

export function initializeEditorWindow(window: EditorWindow): void {
  const reference = window.arguments?.[0] as
    | AnnotationCardReference
    | undefined;
  const bridge = window.arguments?.[1] as MarkdownEditorBridge | undefined;
  if (!reference || !bridge) {
    const status = window.document.getElementById("status");
    if (status) status.textContent = "Editor card reference was not provided.";
    return;
  }
  void initializeMarkdownEditor(window, reference, bridge).catch((error) => {
    const status = window.document.getElementById("status");
    if (status) {
      status.textContent = `Editor failed to load: ${String(error)}`;
      status.setAttribute("data-state", "error");
    }
  });
}
