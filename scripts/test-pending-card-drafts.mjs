import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { parseHTML } from "linkedom";

const require = createRequire(import.meta.url);

const root = path.join(tmpdir(), `zob-pending-${randomUUID()}`);
await mkdir(root, { recursive: true });
let failWrite = false;
let writeCount = 0;
let writeDelayMs = 0;
let nextWriteGate = null;
globalThis.Zotero = { DataDirectory: { dir: root } };
globalThis.Zotero.Prefs = {
  get(key) {
    return key.endsWith(".vaultPath") ? path.join(root, "test-vault") : null;
  },
};
globalThis.Zotero.debug = () => {};
globalThis.Zotero.File = { getContentsFromURLAsync: async () => "" };
globalThis.addon = {
  data: {
    config: { addonRef: "zoteroobsidianbridge" },
    locale: {
      current: {
        formatMessagesSync([{ id }]) {
          return [{ value: id, attributes: null }];
        },
      },
    },
  },
};
globalThis.PathUtils = {
  join: path.join,
  parent: path.dirname,
  split: (value) => path.normalize(value).split(path.sep),
  isAbsolute: path.isAbsolute,
  normalize: path.normalize,
};
globalThis.IOUtils = {
  async exists(filePath) {
    return access(filePath).then(
      () => true,
      () => false,
    );
  },
  async makeDirectory(directory) {
    await mkdir(directory, { recursive: true });
  },
  async getChildren(directory, options = {}) {
    try {
      return (await readdir(directory)).map((name) =>
        path.join(directory, name),
      );
    } catch (error) {
      if (options.ignoreAbsent && error?.code === "ENOENT") return [];
      throw error;
    }
  },
  async writeJSON(filePath, value, options) {
    if (failWrite) throw new Error("disk full");
    writeCount++;
    if (nextWriteGate) {
      const gate = nextWriteGate;
      nextWriteGate = null;
      gate.started();
      await gate.promise;
    }
    if (writeDelayMs) await delay(writeDelayMs);
    await writeFile(options.tmpPath, JSON.stringify(value));
    await rename(options.tmpPath, filePath);
  },
  async readJSON(filePath) {
    return JSON.parse(await readFile(filePath, "utf8"));
  },
  async readUTF8(filePath) {
    return readFile(filePath, "utf8");
  },
  async writeUTF8(filePath, contents, options = {}) {
    await mkdir(path.dirname(filePath), { recursive: true });
    if (options.tmpPath) {
      await writeFile(options.tmpPath, contents);
      await rename(options.tmpPath, filePath);
    } else {
      await writeFile(filePath, contents);
    }
  },
  async remove(filePath) {
    await rm(filePath, { force: true });
  },
};

try {
  const storage = await import("../src/adapters/pending-card-drafts.ts");
  const vaultPath = path.join(root, "test-vault");
  const sourceID = "user:0/annotation/ANN001";
  const makeDraft = (markdown) => ({
    schema: 1,
    vaultPath,
    sourceID,
    content: { title: "", markdown },
    updatedAt: new Date().toISOString(),
  });
  assert.equal(await storage.readPendingCardDraft(vaultPath, sourceID), null);
  const first = storage.writePendingCardDraft(makeDraft("first"));
  const second = storage.writePendingCardDraft(
    makeDraft("second **Markdown**"),
  );
  assert.equal(
    (await storage.readPendingCardDraft(vaultPath, sourceID)).content.markdown,
    "second **Markdown**",
    "reopening a pending card sees the newest in-memory edit",
  );
  await Promise.all([first, second]);
  await storage.flushPendingCardDraft(vaultPath, sourceID);
  const afterRestart = await import(
    `../src/adapters/pending-card-drafts.ts?restart=${randomUUID()}`
  );
  assert.equal(
    (
      await (
        await import(
          `../src/adapters/pending-card-drafts.ts?burst=${randomUUID()}`
        )
      ).readPendingCardDraft(vaultPath, sourceID)
    ).content.markdown,
    "second **Markdown**",
    "the draft survives a process/module restart",
  );
  assert.equal(
    await afterRestart.readPendingCardDraft(
      path.join(root, "other-vault"),
      sourceID,
    ),
    null,
    "another Vault never receives this annotation's draft",
  );

  failWrite = true;
  await assert.rejects(
    storage.writePendingCardDraft(makeDraft("unsaved after disk failure")),
    /disk full/,
  );
  await assert.rejects(
    storage.flushPendingCardDraft(vaultPath, sourceID),
    /disk full/,
    "handoff cannot claim success after a failed draft checkpoint",
  );
  failWrite = false;
  await storage.writePendingCardDraft(makeDraft("recovered"));
  await storage.flushPendingCardDraft(vaultPath, sourceID);
  await storage.deletePendingCardDraft(vaultPath, sourceID);
  assert.equal(
    await afterRestart.readPendingCardDraft(vaultPath, sourceID),
    null,
  );

  const writesBeforeBurst = writeCount;
  writeDelayMs = 15;
  const rapidWrites = Array.from({ length: 30 }, (_, index) =>
    storage.writePendingCardDraft(makeDraft(`rapid-${index}`)),
  );
  await Promise.all(rapidWrites);
  await storage.flushPendingCardDraft(vaultPath, sourceID);
  assert.equal(
    writeCount - writesBeforeBurst,
    1,
    "rapid keystroke drafts coalesce into one durable write",
  );
  assert.equal(
    (await afterRestart.readPendingCardDraft(vaultPath, sourceID)).content
      .markdown,
    "rapid-29",
  );
  writeDelayMs = 0;

  let releaseInFlightWrite;
  let signalWriteStarted;
  const inFlightWriteStarted = new Promise((resolve) => {
    signalWriteStarted = resolve;
  });
  nextWriteGate = {
    started: signalWriteStarted,
    promise: new Promise((resolve) => {
      releaseInFlightWrite = resolve;
    }),
  };
  const inFlightDraft = storage.writePendingCardDraft(
    makeDraft("older write already in flight"),
  );
  const closeFlush = storage.flushPendingCardDraft(vaultPath, sourceID);
  await inFlightWriteStarted;
  let newestDraft;
  void inFlightDraft.then(() => {
    newestDraft = storage.writePendingCardDraft(
      makeDraft("newest text typed before close"),
    );
  });
  releaseInFlightWrite();
  await closeFlush;
  assert.ok(
    newestDraft,
    "the queued edit was scheduled before close flush ended",
  );
  assert.equal(
    (await afterRestart.readPendingCardDraft(vaultPath, sourceID)).content
      .markdown,
    "newest text typed before close",
    "the close flush does not resolve before the latest queued version is durable",
  );
  await newestDraft;
  await inFlightDraft;

  await storage.writePendingCardDraft(makeDraft("**Typed before ACK**"));
  await storage.flushPendingCardDraft(vaultPath, sourceID);

  const bundle = await build({
    entryPoints: ["src/services/pending-reader-card-popup.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const uiPath = path.join(root, "pending-ui.cjs");
  await writeFile(uiPath, bundle.outputFiles[0].contents);
  const ui = require(uiPath);
  const pendingEditorBundle = await build({
    entryPoints: ["src/services/pending-markdown-editor.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const pendingEditorPath = path.join(root, "pending-editor.cjs");
  await writeFile(
    pendingEditorPath,
    pendingEditorBundle.outputFiles[0].contents,
  );
  const pendingEditor = require(pendingEditorPath);
  const { readFrontmatterValue } = await import("../src/core/markdown.ts");
  const { readSourceMarkdown, readUserNoteContent } =
    await import("../src/core/note-content.ts");
  const previewMarkdown = pendingEditor.buildPendingEditorCardMarkdown(
    {
      cardID: "00000000-0000-4000-8000-000000000010",
      sourceID,
      vaultPath,
      relativePath: "__bridge_pending__/ANN001.md",
      absolutePath: path.join(vaultPath, "__bridge_pending__/ANN001.md"),
      paperTitle: "Pending editor fixture",
      paperCreator: "Test Author",
      zoteroURI: "zotero://open-pdf/library/items/ATT001?page=2",
      annotationColor: "#ffd400",
    },
    { title: "Working title", markdown: "Draft before ACK" },
    "Source quote",
    "Source comment",
    "2",
  );
  assert.equal(
    readFrontmatterValue(previewMarkdown, "bridge_card_id"),
    "00000000-0000-4000-8000-000000000010",
  );
  assert.deepEqual(readUserNoteContent(previewMarkdown), {
    title: "Working title",
    markdown: "Draft before ACK",
  });
  assert.match(readSourceMarkdown(previewMarkdown), /Source quote/);
  assert.match(readSourceMarkdown(previewMarkdown), /Source comment/);
  assert.match(readSourceMarkdown(previewMarkdown), /Page 2/);
  const { document } = parseHTML("<html><head></head><body></body></html>");
  const annotation = {
    key: "ANN001",
    libraryID: 1,
    annotationText: "Source quote",
    annotationComment: "Source comment",
    annotationPosition: JSON.stringify({ pageIndex: 1 }),
    annotationPageLabel: "2",
    annotationColor: "#ffd400",
    parentItem: {
      key: "ATT001",
      parentItemID: null,
      isAttachment: () => true,
      getField: (name) => (name === "title" ? "Pending editor fixture" : ""),
    },
  };
  let openedReference;
  let onEditorUnload;
  const originalJoin = globalThis.PathUtils.join;
  globalThis.PathUtils.join = (...parts) => {
    assert.equal(
      parts.slice(1).some((part) => /[\\/]/.test(part)),
      false,
      "Gecko PathUtils.join requires each appended path component separately",
    );
    return path.join(...parts);
  };
  globalThis.Zotero.Libraries = {
    get: () => ({ libraryType: "user", libraryTypeID: 0 }),
  };
  globalThis.Zotero.getMainWindow = () => ({
    openDialog: (...args) => {
      openedReference = args[3];
      return {
        location: { href: args[0] },
        document: { readyState: "complete" },
        focus() {},
        addEventListener(type, listener) {
          if (type === "unload") onEditorUnload = listener;
        },
        removeEventListener(type, listener) {
          if (type === "unload" && onEditorUnload === listener)
            onEditorUnload = undefined;
        },
        close() {},
      };
    },
  });
  let pendingController;
  let notifyClosed;
  const closed = new Promise((resolve) => {
    notifyClosed = resolve;
  });
  try {
    pendingController = await pendingEditor.openPendingMarkdownEditor(
      annotation,
      sourceID,
      (error) => {
        assert.equal(error, undefined);
        notifyClosed();
      },
    );
  } finally {
    globalThis.PathUtils.join = originalJoin;
  }
  assert.equal(
    openedReference.absolutePath,
    path.join(vaultPath, "__bridge_pending__", "ANN001.md"),
    "the expanded pending editor builds its synthetic path from safe components",
  );
  assert.equal(
    (await pendingController.session.initialize()).status,
    "saved",
    "the retained expanded session initializes while the pending window is opening",
  );
  assert.doesNotMatch(
    pendingController.session.snapshot().source,
    /paper_title|## My notes|data-payload/,
    "the read-only source panel excludes user notes and internal metadata",
  );
  const pendingView = pendingController.session.attachView(() => {});
  const edited = {
    title: "Latest title",
    markdown: "Draft edited after expand",
  };
  pendingController.session.edit(edited, pendingView.id);
  await pendingController.session.flushDraft();
  await pendingController.session.poll();
  assert.equal(
    pendingController.session.snapshot().conflict,
    null,
    "a local checkpoint is not an external card modification",
  );
  await pendingController.session.requestSave();
  await pendingController.session.poll();
  await pendingController.session.poll();
  assert.deepEqual(
    pendingController.session.snapshot().content,
    edited,
    "polling must read the latest draft, not restore the opening snapshot",
  );
  pendingController.session.edit(
    { ...edited, markdown: "Draft edited" },
    pendingView.id,
  );
  await pendingController.session.requestSave();
  await pendingController.session.poll();
  assert.equal(
    pendingController.session.snapshot().content.markdown,
    "Draft edited",
    "deleted text must not reappear after polling",
  );
  pendingController.session.edit(
    { ...edited, markdown: "Latest edit before close" },
    pendingView.id,
  );
  pendingView.detach();
  onEditorUnload?.();
  await closed;
  const reopenedController = await pendingEditor.openPendingMarkdownEditor(
    annotation,
    sourceID,
    () => {},
  );
  assert.notEqual(
    reopenedController,
    pendingController,
    "reopening cannot reuse the disposed window controller",
  );
  assert.equal(
    (await reopenedController.session.initialize()).content.markdown,
    "Latest edit before close",
    "closing checkpoints the latest edit before notifying the inline popup",
  );
  let retries = 0;
  let expandedOpenCalls = 0;
  let onExpandedClose;
  const firstCard = await ui.mountPendingReaderCardPopup(
    document,
    annotation,
    sourceID,
    () => retries++,
    async (_annotation, _sourceID, onClose) => {
      expandedOpenCalls++;
      onExpandedClose = onClose;
      return {
        window: {},
        session: {},
        async flush() {},
        close() {},
      };
    },
  );
  document.body.append(firstCard.element);
  assert.match(firstCard.element.textContent, /status-creating/);
  const editor = firstCard.element.querySelector("textarea");
  const expandButton = firstCard.element.querySelector(
    '[data-action="expand"]',
  );
  assert.equal(
    expandButton.parentElement,
    firstCard.element.querySelector('[data-action="retry"]').parentElement,
    "retry and expand actions are grouped together at the card edge",
  );
  expandButton.click();
  await delay(150);
  assert.equal(
    expandedOpenCalls,
    1,
    `expand opens a separate editor window (${firstCard.element.querySelector(".zob-reader-card-status").textContent})`,
  );
  assert.equal(
    editor.readOnly,
    true,
    "the inline field is locked while expanded",
  );
  assert.ok(!firstCard.element.classList.contains("zob-reader-card-expanded"));
  onExpandedClose();
  await delay(0);
  assert.equal(editor.readOnly, false, "the inline field resumes after close");
  editor.value = "**Typed before ACK**";
  editor.dispatchEvent(new document.defaultView.Event("input"));
  assert.match(
    firstCard.element.querySelector(".zob-reader-card-status").textContent,
    /status-creating-saving/,
    "the UI must not claim that an in-flight local draft is already saved",
  );
  assert.equal(await firstCard.prepareForModeChange(), "checkpointed");
  assert.match(
    firstCard.element.querySelector(".zob-reader-card-status").textContent,
    /status-creating-draft/,
  );
  assert.equal(
    (await storage.readPendingCardDraft(vaultPath, sourceID)).content.markdown,
    "**Typed before ACK**",
  );
  firstCard.element
    .querySelectorAll(".zob-reader-card-modes button")[1]
    .click();
  await delay(0);
  assert.match(
    firstCard.element.querySelector(".zob-reader-card-preview").innerHTML,
    /Typed before ACK/,
  );
  failWrite = true;
  editor.dispatchEvent(new document.defaultView.Event("input"));
  await assert.rejects(firstCard.prepareForModeChange(), /disk full/);
  assert.equal(
    firstCard.element.querySelector(".zob-reader-card-status").dataset.state,
    "error",
  );
  failWrite = false;
  firstCard.element
    .querySelector('.zob-reader-card-header [data-action="retry"]')
    .click();
  for (let attempt = 0; attempt < 100 && retries === 0; attempt++) {
    await delay(10);
  }
  assert.equal(await firstCard.prepareForModeChange(), "checkpointed");
  assert.equal(retries, 1, "retry checkpoints the local draft first");
  firstCard.dispose();
  firstCard.element.remove();
  const reopened = await ui.mountPendingReaderCardPopup(
    document,
    annotation,
    sourceID,
    () => {},
  );
  assert.equal(
    reopened.element.querySelector("textarea").value,
    "**Typed before ACK**",
  );
  reopened.element.querySelector("textarea").value =
    "Draft survives closing the pending Reader popup";
  reopened.element
    .querySelector("textarea")
    .dispatchEvent(new document.defaultView.Event("input"));
  assert.equal(
    reopened.element.querySelector("textarea").value,
    "Draft survives closing the pending Reader popup",
  );
  assert.match(
    reopened.element.querySelector(".zob-reader-card-status").textContent,
    /status-creating-saving|status-creating-draft/,
  );
  reopened.dispose();
  let closedPopupDraft = null;
  for (
    let attempt = 0;
    attempt < 100 &&
    closedPopupDraft?.content.markdown !==
      "Draft survives closing the pending Reader popup";
    attempt++
  ) {
    closedPopupDraft = await afterRestart.readPendingCardDraft(
      vaultPath,
      sourceID,
    );
    if (!closedPopupDraft) await delay(10);
  }
  assert.equal(
    closedPopupDraft?.content.markdown,
    "Draft survives closing the pending Reader popup",
    "disposing the pending popup flushes its latest edit to Zotero storage",
  );
  await storage.writePendingCardDraft(makeDraft("**Typed before ACK**"));
  await storage.flushPendingCardDraft(vaultPath, sourceID);

  const cardID = randomUUID();
  const relativePath = "Papers/Fixture/Annotations/P01N01.md";
  const absolutePath = path.join(vaultPath, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const { createMarkdownWithHiddenMetadata } =
    await import("../src/core/markdown.ts");
  await writeFile(
    absolutePath,
    createMarkdownWithHiddenMetadata(
      { paper_title: "Fixture" },
      { bridge_card_id: cardID, bridge_source_id: sourceID },
      "## My notes\n\n<!-- zotero-obsidian-bridge:source:start -->\nQuote\n<!-- zotero-obsidian-bridge:source:end -->\n",
    ),
  );
  globalThis.Zotero.File = {
    pathToFile() {
      return { isSymlink: () => false };
    },
  };
  const reference = {
    cardID,
    sourceID,
    vaultPath,
    relativePath,
    absolutePath,
  };
  const handoffBundle = await build({
    entryPoints: ["src/services/pending-card-handoff.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const handoffPath = path.join(root, "pending-handoff.cjs");
  await writeFile(handoffPath, handoffBundle.outputFiles[0].contents);
  const handoff = require(handoffPath);
  globalThis.Zotero.Prefs.get = (key) => {
    if (key.endsWith(".vaultPath")) return vaultPath;
    if (key.endsWith(".companionQueuePath")) return path.join(root, "queue");
    return null;
  };
  const staged = await handoff.stagePendingCardDraft(reference);
  assert.equal(staged.content.markdown, "**Typed before ACK**");
  const standardDraft = JSON.parse(
    await readFile(
      path.join(
        root,
        "storage/zotero-obsidian-bridge/editor-drafts",
        `${cardID}.json`,
      ),
      "utf8",
    ),
  );
  assert.equal(standardDraft.draft.markdown, staged.content.markdown);
  assert.deepEqual(standardDraft.baseline, { title: "", markdown: "" });
  assert.equal(
    (await storage.readPendingCardDraft(vaultPath, sourceID)).content.markdown,
    staged.content.markdown,
    "pending backup is retained until the full editor has mounted",
  );
  await storage.writePendingCardDraft(makeDraft("another Reader's newer edit"));
  assert.equal(
    await handoff.clearPendingCardDraft(reference, staged),
    false,
    "an older handoff cannot delete a newer edit from another Reader",
  );
  assert.equal(
    (await storage.readPendingCardDraft(vaultPath, sourceID)).content.markdown,
    "another Reader's newer edit",
  );
  await assert.rejects(
    handoff.stagePendingCardDraft(reference),
    /different recovery draft/,
    "different concurrent edits are preserved rather than silently merged",
  );
  await storage.writePendingCardDraft(makeDraft("**Typed before ACK**"));
  const restaged = await handoff.stagePendingCardDraft(reference);
  assert.equal(await handoff.clearPendingCardDraft(reference, restaged), true);
  assert.equal(
    await afterRestart.readPendingCardDraft(vaultPath, sourceID),
    null,
  );

  await storage.writePendingCardDraft(
    makeDraft("Recovered after the pending popup closed"),
  );
  await storage.flushPendingCardDraft(vaultPath, sourceID);
  await handoff.applyPendingCardDraft(reference);
  assert.equal(
    readUserNoteContent(await readFile(absolutePath, "utf8")).markdown,
    "Recovered after the pending popup closed",
    "background handoff applies the local draft after the card becomes available",
  );
  assert.equal(
    await afterRestart.readPendingCardDraft(vaultPath, sourceID),
    null,
    "the local checkpoint is deleted only after the card content is verified",
  );

  await storage.writePendingCardDraft(
    makeDraft("Preserve on a concurrent card edit"),
  );
  await storage.flushPendingCardDraft(vaultPath, sourceID);
  const { replaceUserNoteContent } =
    await import("../src/core/note-content.ts");
  const cardWithConcurrentEdit = replaceUserNoteContent(
    await readFile(absolutePath, "utf8"),
    { title: "", markdown: "An edit already made in Obsidian" },
  );
  await writeFile(absolutePath, cardWithConcurrentEdit);
  await assert.rejects(
    handoff.applyPendingCardDraft(reference),
    /different user notes/,
    "background recovery must not overwrite a concurrent Obsidian edit",
  );
  assert.equal(
    (await storage.readPendingCardDraft(vaultPath, sourceID)).content.markdown,
    "Preserve on a concurrent card edit",
  );
  process.stdout.write("Pending-card draft persistence checks passed.\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
