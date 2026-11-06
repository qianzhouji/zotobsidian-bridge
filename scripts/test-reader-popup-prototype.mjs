import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import {
  clampPopupSize,
  getPopupSizeConstraints,
} from "../src/core/reader-popup-size.ts";
import {
  createReaderCardMarkdownTextarea,
  markReaderEditorAsTextEntry,
} from "../src/services/reader-card-editor.ts";
import {
  attachExistingReaderPopupPrototypes,
  attachReaderPopupPrototype,
  detachReaderPopupPrototypes,
  prepareReaderPopupModeChange,
  refreshReaderPopupPrototypes,
  readerPopupDocument,
} from "../src/adapters/reader-popup-prototype.ts";
import { CompanionPendingError } from "../src/adapters/companion-queue.ts";
import { installReaderMathStyles } from "../src/services/reader-math-styles.ts";

for (const markup of [
  "<html><head></head><body></body></html>",
  "<html></html>",
]) {
  const { document } = parseHTML(markup);
  let reads = 0;
  const read = async (url) => {
    reads++;
    assert.equal(url, "chrome://zoteroobsidianbridge/content/katex.min.css");
    return "@font-face{src:url(fonts/test.woff2)}.katex{display:inline}body{counter-reset:katexEqnNo mmlEqnNo}";
  };
  await Promise.all([
    installReaderMathStyles(document, read),
    installReaderMathStyles(document, read),
  ]);
  await installReaderMathStyles(document, read);
  const styles = document.querySelectorAll("#zob-reader-card-katex-styles");
  assert.equal(
    reads,
    1,
    "concurrent and repeated mounts read once per document",
  );
  assert.equal(styles.length, 1);
  assert.match(
    styles[0].textContent,
    /url\(chrome:\/\/zoteroobsidianbridge\/content\/fonts\/test\.woff2\)/,
  );
  assert.doesNotMatch(styles[0].textContent, /body\{counter-reset/);
}
const mathRetryDocument = parseHTML(
  "<html><head></head><body></body></html>",
).document;
await assert.rejects(
  installReaderMathStyles(mathRetryDocument, async () => {
    throw new Error("unavailable");
  }),
);
await installReaderMathStyles(
  mathRetryDocument,
  async () => ".katex{display:inline}",
);
assert.ok(
  mathRetryDocument.getElementById("zob-reader-card-katex-styles"),
  "failed loads can be retried",
);

const popupStylesSource = await readFile(
  new URL("../src/services/reader-card-popup.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  popupStylesSource,
  /\bqueueMicrotask\s*\(/,
  "Reader popup initialization uses a microtask API available in Zotero Gecko",
);
assert.match(
  popupStylesSource,
  /Promise\.resolve\(\)\.then\(\(\) =>\s*\{\s*if \(!disposed\) knowledgeCard\.refreshRelations\(\)/,
);
const preferencesMarkup = await readFile(
  new URL("../addon/content/preferences.xhtml", import.meta.url),
  "utf8",
);
const preferenceDefaults = await readFile(
  new URL("../addon/prefs.js", import.meta.url),
  "utf8",
);
const preferencesSource = await readFile(
  new URL("../src/services/preferences.ts", import.meta.url),
  "utf8",
);
assert.match(preferencesMarkup, /id="zotero-prefpane-__addonRef__-readerMode"/);
assert.match(
  preferencesMarkup,
  /id="zotero-prefpane-__addonRef__-readerModeStatus"/,
);
assert.match(preferenceDefaults, /pref\("readerMode", "native"\)/);
assert.match(preferencesSource, /prepareReaderPopupModeChange\(\)/);
assert.match(
  preferencesSource,
  /writerMode[\s\S]*?readerMode[\s\S]*?addEventListener\("change"/,
  "Reader presentation mode is wired separately from the Markdown writer mode",
);
assert.match(
  popupStylesSource,
  /installReaderCardStyles\(doc: Document\)[\s\S]*?installReaderMathStyles\(doc\)/,
  "both Reader popup variants install the bundled math stylesheet",
);
assert.match(
  popupStylesSource,
  /\.zob-reader-card-preview \.katex \.katex-mathml\s*\{[^}]*clip-path:\s*inset\(50%\)/,
  "Reader preview hides KaTeX's duplicate visual MathML while preserving its DOM for assistive technology",
);
assert.match(
  popupStylesSource,
  /\.annotation-popup\.zob-reader-card-host::before[\s\S]*?display:\s*none\s*!important/,
);
assert.match(
  popupStylesSource,
  /\.annotation-popup\.zob-reader-card-host\s*>\s*:not\(\.zob-reader-card\)\s*\{\s*display:\s*none\s*!important;/,
  "Bridge mode completely hides the native popup contents instead of only the comment input",
);
assert.match(
  popupStylesSource,
  /\.annotation-popup\.zob-reader-card-host\s*\{[^}]*visibility:\s*hidden\s*!important/,
  "the native popup host, including any encapsulated native content, is hidden in Bridge mode",
);
assert.match(
  popupStylesSource,
  /\.annotation-popup\.zob-reader-card-host\s*>\s*\.zob-reader-card\s*\{[^}]*visibility:\s*visible\s*!important/,
  "the Bridge card remains visible while the native popup host is hidden",
);
const resizeStop = popupStylesSource.match(
  /const stop = \(\) => \{([\s\S]*?)\n {4}\};/,
);
assert.ok(resizeStop, "the resize pointer lifecycle has a stop handler");
assert.doesNotMatch(
  resizeStop[1],
  /removeProperty\("(?:min|max)-(?:width|height)"\)/,
  "viewport-derived size limits stay applied after dragging ends, preventing CSS minimums from expanding the card past the edge",
);
assert.match(
  popupStylesSource,
  /addEventListener\("resize", onViewportResize\)/,
  "resizing the Reader window reapplies bounds and clamps the existing card",
);
assert.match(
  popupStylesSource,
  /\.zob-reader-card-resize[^{]*\{[^}]*cursor:\s*nwse-resize/,
  "the inline Bridge card exposes a resize handle",
);
assert.doesNotMatch(
  popupStylesSource,
  /zob-reader-card-expanded/,
  "expanding a pending card no longer stretches the Reader inline popup",
);
assert.match(
  popupStylesSource,
  /\.zob-reader-card-actions\s*\{[^}]*gap:\s*2px/,
  "retry and expand controls sit next to one another in their shared action group",
);
const smallViewportConstraints = getPopupSizeConstraints(280, 180, 8, 10);
assert.deepEqual(smallViewportConstraints, {
  minWidth: 256,
  maxWidth: 256,
  minHeight: 156,
  maxHeight: 156,
});
assert.deepEqual(
  clampPopupSize({ width: 100, height: 100 }, smallViewportConstraints),
  { width: 256, height: 156 },
  "minimum-size clamping stays inside a narrow Reader viewport",
);
assert.deepEqual(
  clampPopupSize(
    { width: 2000, height: 2000 },
    getPopupSizeConstraints(1200, 900, 120, 80),
  ),
  { width: 1068, height: 808 },
  "maximum-size clamping stays inside the available viewport area",
);
assert.match(popupStylesSource, /--zob-accent:\s*#78bfe9/);
assert.doesNotMatch(popupStylesSource, /#(?:176c62|0d5149|76c5b6)/i);
const editorCSS = await readFile(
  new URL("../addon/content/editor.css", import.meta.url),
  "utf8",
);
const editorMarkup = await readFile(
  new URL("../addon/content/editor.xhtml", import.meta.url),
  "utf8",
);
assert.match(editorCSS, /--accent:\s*#82c2ea/);
assert.match(editorCSS, /--source-height, 112px/);
assert.match(
  editorCSS,
  /grid-template-columns:\s*minmax\(0, var\(--editor-track, 1fr\)\) 8px minmax\(0, 1fr\)/,
);
assert.match(editorMarkup, /id="source-splitter"[\s\S]*?role="separator"/);
assert.match(
  editorMarkup,
  /<html:main id="workspace" class="workspace">/,
  "expanded editor markup exposes the workspace ID required by its initializer",
);
assert.match(editorMarkup, /id="workspace-splitter"[\s\S]*?role="separator"/);
for (const stylePath of [
  "../addon/content/companion-pending.css",
  "../addon/content/batch-progress.css",
]) {
  const style = await readFile(new URL(stylePath, import.meta.url), "utf8");
  assert.doesNotMatch(style, /#(?:176c62|76c5b6)/i);
}

const documentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);
try {
  Reflect.deleteProperty(globalThis, "document");
  const { document: editorDocument } = parseHTML("<html><body></body></html>");
  const textarea = createReaderCardMarkdownTextarea(
    editorDocument,
    "**Markdown source**",
  );
  assert.equal(textarea.ownerDocument, editorDocument);
  assert.equal(textarea.value, "**Markdown source**");
  assert.equal(textarea.className, "zob-reader-card-textarea");

  const readerHost = editorDocument.createElement("div");
  const editorHost = editorDocument.createElement("div");
  editorHost.className = "zob-reader-card-editor";
  editorHost.append(textarea);
  readerHost.append(editorHost);
  editorDocument.body.append(readerHost);
  let deletedAnnotations = 0;
  const zoteroKeydown = (event) => {
    if (!["Delete", "Backspace"].includes(event.key)) return;
    if (event.target.closest("input, .label-popup")) return;
    deletedAnnotations++;
  };
  editorDocument.defaultView.addEventListener("keydown", zoteroKeydown, true);
  const removeTextEntryMarker = markReaderEditorAsTextEntry(editorHost);
  const createKeyEvent = (key) => {
    const event = new editorDocument.defaultView.Event("keydown", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "key", { value: key });
    return event;
  };
  for (const key of ["Backspace", "Delete"]) {
    const event = createKeyEvent(key);
    textarea.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(
    deletedAnnotations,
    0,
    "Zotero's earlier window-capture handler must recognize the editor as text entry",
  );
  const characterKey = createKeyEvent("a");
  textarea.dispatchEvent(characterKey);
  const outsideEditor = editorDocument.createElement("textarea");
  readerHost.append(outsideEditor);
  const outsideDelete = createKeyEvent("Backspace");
  outsideEditor.dispatchEvent(outsideDelete);
  assert.equal(
    deletedAnnotations,
    1,
    "delete keys outside the Bridge card retain normal Reader behavior",
  );
  removeTextEntryMarker();
  assert.equal(editorHost.classList.contains("label-popup"), false);
  editorDocument.defaultView.removeEventListener(
    "keydown",
    zoteroKeydown,
    true,
  );
} finally {
  if (documentDescriptor) {
    Object.defineProperty(globalThis, "document", documentDescriptor);
  }
}

const observers = [];
class TestMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    observers.push(this);
  }
  observe(_target, options) {
    this.options = options;
  }
  disconnect() {
    this.disconnected = true;
  }
  trigger(records = []) {
    if (!this.disconnected) this.callback(records);
  }
}

globalThis.MutationObserver = TestMutationObserver;
const preference = { value: "native" };
const annotations = [
  {
    id: 101,
    key: "ANN001",
    libraryID: 1,
    annotationPosition: JSON.stringify({ pageIndex: 1 }),
  },
  {
    id: 102,
    key: "ANN002",
    libraryID: 1,
    annotationPosition: JSON.stringify({ pageIndex: 4 }),
  },
];
globalThis.Zotero = {
  Prefs: {
    get: (_key, global) => {
      assert.equal(global, true, "reader mode uses the full preference key");
      return preference.value;
    },
  },
  Items: {
    getAsync: async () => ({
      isAttachment: () => true,
      getAnnotations: () => annotations,
    }),
  },
  Libraries: {
    get: () => ({ libraryType: "user", libraryTypeID: 0 }),
  },
  debug() {},
};

let disposeCount = 0;
const popupDependencies = {
  async resolveAnnotation(_reader, editorID) {
    return (
      annotations.find((item) =>
        [
          String(item.id),
          item.key,
          `${item.libraryID}/${item.key}`,
          `${item.libraryID}_${item.key}`,
        ].includes(editorID),
      ) ?? null
    );
  },
  async ensureCard(_reader, editorID) {
    const annotation = annotations.find((item) => item.key === editorID);
    if (!annotation) throw new Error("test card not found");
    return {
      cardID: `card-${annotation.key}`,
      sourceID: `user:0/annotation/${annotation.key}`,
      vaultPath: "/test-vault",
      relativePath: `Papers/Test/Annotations/${annotation.key}.md`,
      absolutePath: `/test-vault/Papers/Test/Annotations/${annotation.key}.md`,
      paperTitle: "Reader popup fixture",
      paperCreator: "Test Author",
      zoteroURI: `zotero://open-pdf/user/0/${annotation.key}`,
    };
  },
  async getExistingCardReference() {
    return null;
  },
  async mountCard(doc, annotation, reference) {
    const shell = doc.createElement("section");
    shell.className = "zob-reader-popup-prototype";
    shell.textContent = `${reference.sourceID} PDF page ${JSON.parse(annotation.annotationPosition).pageIndex + 1}`;
    let disposed = false;
    return {
      element: shell,
      dispose() {
        disposed = true;
        disposeCount++;
      },
      async prepareForModeChange() {
        return "checkpointed";
      },
      cancelModeChange() {},
      get disposed() {
        return disposed;
      },
    };
  },
};
const defaultMountCard = popupDependencies.mountCard;

const { document: eventDocument } = parseHTML("<html><body></body></html>");
const { document: readerDocument } = parseHTML("<html><body></body></html>");
assert.equal(
  readerPopupDocument(
    { _iframeWindow: { document: readerDocument } },
    eventDocument,
  ),
  readerDocument,
  "the active Reader iframe owns the saved annotation popup",
);
assert.equal(
  readerPopupDocument({}, eventDocument),
  eventDocument,
  "the toolbar event document is a fallback when no Reader iframe exists",
);

// Bridge covers the native popup before asynchronous annotation lookup begins.
{
  preference.value = "bridge";
  const { document } = parseHTML(`<html><body>
    <div class="annotation-popup">
      <div class="comment"><div id="ANN001" contenteditable="true">Native</div></div>
    </div>
  </body></html>`);
  const popup = document.querySelector(".annotation-popup");
  let finishLookup;
  const lookup = new Promise((resolve) => {
    finishLookup = resolve;
  });
  attachReaderPopupPrototype({ itemID: 88 }, document, TestMutationObserver, {
    ...popupDependencies,
    async resolveAnnotation(_reader, editorID) {
      await lookup;
      return popupDependencies.resolveAnnotation(null, editorID);
    },
  });
  const loading = popup.querySelector(".zob-reader-card-loading");
  assert.ok(loading, "Bridge loading shell is mounted synchronously");
  assert.equal(popup.classList.contains("zob-reader-card-host"), true);
  assert.match(
    loading.textContent,
    /Resolving the saved Zotero highlight|正在定位已保存的 Zotero 高亮/,
  );
  assert.equal(popup.querySelector(".comment [id]").textContent, "Native");
  finishLookup();
  await delay(0);
  await delay(0);
  assert.ok(
    popup.querySelector(
      ".zob-reader-popup-prototype:not(.zob-reader-card-loading)",
    ),
    "the loading shell is replaced after asynchronous card resolution",
  );
  await detachReaderPopupPrototypes();
  preference.value = "native";
}

const { document: restoredReaderDocument } = parseHTML(`<html><body>
  <div class="annotation-popup">
    <header>Page 3</header>
    <div class="comment"><div id="ANN001" contenteditable="true">Restored comment</div></div>
  </div>
</body></html>`);
preference.value = "bridge";
attachExistingReaderPopupPrototypes(
  [
    {
      _iframeWindow: { document: restoredReaderDocument },
      _initPromise: Promise.resolve(),
      itemID: 88,
    },
  ],
  popupDependencies,
);
await delay(0);
assert.match(
  restoredReaderDocument.querySelector(".zob-reader-popup-prototype")
    .textContent,
  /user:0\/annotation\/ANN001/,
  "startup attaches to a Reader restored before event listeners register",
);
assert.equal(
  restoredReaderDocument
    .querySelector(".annotation-popup")
    .classList.contains("zob-reader-card-host"),
  true,
  "the restored Reader popup is replaced by the Bridge host",
);

const { document: fastReaderDocument } = parseHTML(`<html><body>
  <div class="annotation-popup">
    <header>Page 2</header>
    <div class="comment"><div id="ANN001" contenteditable="true">Native comment</div></div>
  </div>
</body></html>`);
let fastPathEnsureCalled = false;
attachReaderPopupPrototype(
  { itemID: 88 },
  fastReaderDocument,
  TestMutationObserver,
  {
    ...popupDependencies,
    async getExistingCardReference() {
      return {
        cardID: "card-ANN001",
        sourceID: "user:0/annotation/ANN001",
        vaultPath: "/test-vault",
        relativePath: "Papers/Test/Annotations/ANN001.md",
        absolutePath: "/test-vault/Papers/Test/Annotations/ANN001.md",
        paperTitle: "Reader popup fixture",
        paperCreator: "Test Author",
        zoteroURI: "zotero://open-pdf/user/0/ANN001",
      };
    },
    async ensureCard() {
      fastPathEnsureCalled = true;
      throw new Error("existing-card popup must not wait for a companion ACK");
    },
  },
);
await delay(0);
assert.ok(
  fastReaderDocument.querySelector(".zob-reader-popup-prototype"),
  "an existing card mounts in the Reader without waiting for a companion write ACK",
);
assert.equal(fastPathEnsureCalled, false);
await detachReaderPopupPrototypes();

const { document: lateReaderDocument } = parseHTML(`<html><body>
  <div class="annotation-popup">
    <header>Page 3</header>
    <div class="comment"><div id="ANN002" contenteditable="true">Late reader comment</div></div>
  </div>
</body></html>`);
const lateReader = {
  _iframeWindow: { document: lateReaderDocument },
  _initPromise: Promise.resolve(),
  itemID: 89,
};
attachExistingReaderPopupPrototypes([lateReader], popupDependencies);
await delay(0);
assert.equal(
  lateReaderDocument
    .querySelector(".annotation-popup")
    .classList.contains("zob-reader-card-host"),
  true,
  "a Reader that appears after the initial startup scan is attached on the next reconciliation",
);
attachExistingReaderPopupPrototypes([], popupDependencies);
assert.equal(
  lateReaderDocument.querySelector(".zob-reader-popup-prototype"),
  null,
  "closed Reader documents release their observer and restore the native popup DOM",
);
await detachReaderPopupPrototypes();
preference.value = "native";

const { document } = parseHTML(`<html><body>
  <div class="annotation-popup">
    <header>Page 2</header>
    <div class="comment"><div id="ANN001" contenteditable="true">Native comment</div></div>
    <button class="tags">Tags</button>
  </div>
</body></html>`);
const popup = document.querySelector(".annotation-popup");
const comment = popup.querySelector(".comment");
const reader = { itemID: 88 };
attachReaderPopupPrototype(
  reader,
  document,
  TestMutationObserver,
  popupDependencies,
);
const observer = observers.at(-1);

assert.equal(
  popup.classList.contains("zob-reader-card-host"),
  false,
  "native mode leaves the native popup intact",
);
preference.value = "bridge";
observer.trigger();
await delay(0);
assert.equal(popup.classList.contains("zob-reader-card-host"), true);
assert.equal(
  comment.hidden,
  false,
  "the native comment DOM is preserved for restoration",
);
assert.equal(comment.hasAttribute("aria-hidden"), false);
assert.equal(popup.querySelectorAll(".zob-reader-popup-prototype").length, 1);
assert.equal(
  observer.options.attributes,
  true,
  "identity and visibility changes are observed",
);
assert.ok(observer.options.attributeFilter.includes("id"));
let shell = popup.querySelector(".zob-reader-popup-prototype");
assert.match(shell.textContent, /user:0\/annotation\/ANN001/);
assert.match(shell.textContent, /PDF page 2/);
assert.equal(popup.querySelector("header").textContent, "Page 2");
assert.equal(popup.querySelector(".tags").textContent, "Tags");

observer.trigger();
await delay(0);
assert.equal(popup.querySelectorAll(".zob-reader-popup-prototype").length, 1);

popup.querySelector(".comment [id]").id = "ANN002";
observer.trigger();
await delay(0);
shell = popup.querySelector(".zob-reader-popup-prototype");
assert.match(shell.textContent, /user:0\/annotation\/ANN002/);
assert.match(shell.textContent, /PDF page 5/);
assert.equal(popup.querySelectorAll(".zob-reader-popup-prototype").length, 1);

popup.querySelector(".comment [id]").id = "UNKNOWN";
observer.trigger();
await delay(0);
assert.ok(popup.querySelector(".zob-reader-card-loading"));
assert.equal(
  popup.classList.contains("zob-reader-card-host"),
  true,
  "Bridge stays visible while an identified annotation is being resolved",
);
assert.equal(comment.hasAttribute("aria-hidden"), false);

popup.querySelector(".comment [id]").id = "ANN001";
popupDependencies.mountCard = async () => {
  throw new Error("simulated card session failure");
};
observer.trigger();
await delay(0);
assert.equal(
  popup.classList.contains("zob-reader-card-host"),
  true,
  "a transient mount failure keeps the native popup covered during retry",
);
assert.ok(popup.querySelector(".zob-reader-card-loading"));
popupDependencies.mountCard = defaultMountCard;
popup.querySelector(".zob-reader-card-loading-retry").dispatchEvent(
  new document.defaultView.Event("click", {
    bubbles: true,
    cancelable: true,
  }),
);
await delay(0);
assert.equal(popup.classList.contains("zob-reader-card-host"), true);
const mountedBeforeNativeSwitch = disposeCount;
preference.value = "native";
refreshReaderPopupPrototypes();
assert.equal(
  popup.classList.contains("zob-reader-card-host"),
  false,
  "switching to native restores the popup",
);
assert.equal(comment.hasAttribute("aria-hidden"), false);
assert.equal(popup.querySelector(".zob-reader-popup-prototype"), null);
assert.equal(disposeCount, mountedBeforeNativeSwitch + 1);

preference.value = "bridge";
refreshReaderPopupPrototypes();
await delay(0);
assert.equal(popup.classList.contains("zob-reader-card-host"), true);
for (let index = 0; index < 100; index++) {
  preference.value = "native";
  observer.trigger();
  assert.equal(popup.classList.contains("zob-reader-card-host"), false);
  assert.equal(popup.querySelectorAll(".zob-reader-popup-prototype").length, 0);
  preference.value = "bridge";
  observer.trigger();
  await delay(0);
  assert.equal(popup.classList.contains("zob-reader-card-host"), true);
  assert.equal(popup.querySelectorAll(".zob-reader-popup-prototype").length, 1);
}
for (let index = 0; index < 50; index++) {
  const key = index % 2 === 0 ? "ANN002" : "ANN001";
  popup.querySelector(".comment [id]").id = key;
  observer.trigger();
  await delay(0);
  shell = popup.querySelector(".zob-reader-popup-prototype");
  assert.match(shell.textContent, new RegExp(`annotation/${key}`));
  assert.equal(popup.querySelectorAll(".zob-reader-popup-prototype").length, 1);
}

const { document: reopenedDocument } = parseHTML(`<html><body>
  <div class="annotation-popup">
    <header>Page 2</header>
    <div class="comment"><div id="ANN001" contenteditable="true">Native comment</div></div>
  </div>
</body></html>`);
const reopenedPopup = reopenedDocument.querySelector(".annotation-popup");
const reopenedComment = reopenedPopup.querySelector(".comment");
attachReaderPopupPrototype(
  reader,
  reopenedDocument,
  TestMutationObserver,
  popupDependencies,
);
const reopenedObserver = observers.at(-1);
await delay(0);
assert.equal(
  observer.disconnected,
  true,
  "reopening a reader disconnects the old document observer",
);
assert.equal(
  popup.classList.contains("zob-reader-card-host"),
  false,
  "reopening restores the old document's native popup",
);
assert.equal(popup.querySelector(".zob-reader-popup-prototype"), null);
assert.equal(
  reopenedPopup.classList.contains("zob-reader-card-host"),
  true,
  "the new reader document is reconciled immediately",
);
assert.equal(
  reopenedPopup.querySelectorAll(".zob-reader-popup-prototype").length,
  1,
);

await detachReaderPopupPrototypes();
assert.equal(reopenedObserver.disconnected, true);
assert.equal(
  popup.classList.contains("zob-reader-card-host"),
  false,
  "shutdown restores the native popup",
);
assert.equal(comment.hasAttribute("aria-hidden"), false);
assert.equal(popup.querySelector(".zob-reader-popup-prototype"), null);
assert.equal(
  reopenedPopup.classList.contains("zob-reader-card-host"),
  false,
  "shutdown restores the reopened native popup",
);
assert.equal(reopenedComment.hasAttribute("aria-hidden"), false);
assert.equal(reopenedPopup.querySelector(".zob-reader-popup-prototype"), null);

const { document: delayedIdentityDocument } = parseHTML(`<html><body>
  <div class="annotation-popup">
    <header>Page 5</header>
    <div class="comment"><div contenteditable="true">Loading</div></div>
  </div>
</body></html>`);
const delayedPopup = delayedIdentityDocument.querySelector(".annotation-popup");
const delayedReader = { itemID: 88 };
preference.value = "bridge";
attachReaderPopupPrototype(
  delayedReader,
  delayedIdentityDocument,
  TestMutationObserver,
  popupDependencies,
);
await delay(0);
assert.ok(
  delayedPopup.querySelector(".zob-reader-card-loading"),
  "a popup without an identity shows a temporary Bridge shell while Zotero finishes rendering it",
);
delayedPopup.querySelector(".comment [contenteditable]").id = "ANN002";
delayedIdentityDocument.dispatchEvent(
  new delayedIdentityDocument.defaultView.Event("click", { bubbles: true }),
);
await delay(0);
assert.match(
  delayedPopup.querySelector(".zob-reader-popup-prototype").textContent,
  /annotation\/ANN002/,
  "a click reconciles a reused popup even if the identity attribute mutation was missed",
);
await detachReaderPopupPrototypes();

const { document: retryDocument } = parseHTML(`<html><body>
  <div class="annotation-popup">
    <header>Page 2</header>
    <div class="comment"><div id="ANN001" contenteditable="true">Native</div></div>
  </div>
</body></html>`);
const retryPopup = retryDocument.querySelector(".annotation-popup");
let mountAttempts = 0;
const retryDependencies = {
  ...popupDependencies,
  async mountCard(...args) {
    mountAttempts++;
    if (mountAttempts === 1)
      throw new Error("temporary session startup failure");
    return defaultMountCard(...args);
  },
};
attachReaderPopupPrototype(
  { itemID: 88 },
  retryDocument,
  TestMutationObserver,
  retryDependencies,
);
await delay(0);
assert.equal(mountAttempts, 1, "the first mount failure is recorded once");
const retryObserver = observers.at(-1);
const loadingMessage = retryPopup.querySelector(
  ".zob-reader-card-loading-message",
);
assert.match(
  loadingMessage.textContent,
  /temporary session startup failure/,
  "the actual mount error is visible instead of a generic spinner message",
);
assert.equal(
  retryPopup.querySelector(".zob-reader-card-loading-retry").hidden,
  false,
  "a failed popup exposes a manual retry action",
);
retryObserver.trigger([{ target: loadingMessage }]);
await delay(10);
assert.equal(
  mountAttempts,
  1,
  "Bridge-owned status mutations do not cancel or restart the backoff retry",
);
await delay(100);
assert.ok(mountAttempts >= 2, "a transient editor startup failure is retried");
assert.equal(
  retryPopup.querySelectorAll(".zob-reader-popup-prototype").length,
  1,
);
await detachReaderPopupPrototypes();
preference.value = "native";

preference.value = "bridge";
const { document: pendingDocument } = parseHTML(`<html><body>
  <div class="annotation-popup">
    <header>Page 2</header>
    <div class="comment"><div id="ANN001" contenteditable="true">Native</div></div>
  </div>
</body></html>`);
const pendingPopup = pendingDocument.querySelector(".annotation-popup");
let pendingEnsureCalls = 0;
let resolvePendingRequest;
let markPendingWaitStarted;
const pendingWaitStarted = new Promise((resolve) => {
  markPendingWaitStarted = resolve;
});
const pendingOutcome = new Promise((resolve) => {
  resolvePendingRequest = resolve;
});
attachReaderPopupPrototype(
  { itemID: 88 },
  pendingDocument,
  TestMutationObserver,
  {
    ...popupDependencies,
    async getExistingCardReference() {
      return null;
    },
    async ensureCard(...args) {
      pendingEnsureCalls++;
      if (pendingEnsureCalls === 1) {
        throw new CompanionPendingError("00000000-0000-4000-8000-000000000001");
      }
      return popupDependencies.ensureCard(...args);
    },
    async waitForCardRequest() {
      markPendingWaitStarted();
      return pendingOutcome;
    },
  },
);
await pendingWaitStarted;
pendingDocument.dispatchEvent(
  new pendingDocument.defaultView.Event("click", { bubbles: true }),
);
await delay(0);
assert.equal(
  pendingEnsureCalls,
  1,
  "a pending durable write is observed rather than resubmitted on popup reconciliation",
);
resolvePendingRequest({ status: "applied", revision: "test-revision" });
await delay(0);
await delay(0);
assert.equal(pendingEnsureCalls, 2);
assert.ok(pendingPopup.querySelector(".zob-reader-popup-prototype"));
await detachReaderPopupPrototypes();
preference.value = "native";

// A new saved annotation gets an editable Bridge shell before card creation ACK.
{
  preference.value = "bridge";
  const { document: optimisticDocument } = parseHTML(`<html><body>
    <div class="annotation-popup">
      <div class="comment"><div id="ANN001" contenteditable="true">Native</div></div>
    </div>
  </body></html>`);
  const optimisticPopup = optimisticDocument.querySelector(".annotation-popup");
  let finishCreate;
  let ensureCalls = 0;
  let savedDraft = "";
  let handedOff = "";
  const createCard = new Promise((resolve) => {
    finishCreate = resolve;
  });
  const optimisticDependencies = {
    ...popupDependencies,
    async ensureCard(...args) {
      ensureCalls++;
      await createCard;
      return popupDependencies.ensureCard(...args);
    },
    async mountPendingCard(doc) {
      const shell = doc.createElement("section");
      shell.className = "zob-reader-popup-prototype";
      const editor = doc.createElement("textarea");
      editor.value = savedDraft;
      editor.addEventListener("input", () => {
        savedDraft = editor.value;
      });
      shell.append(editor);
      return {
        element: shell,
        async complete(reference) {
          handedOff = savedDraft;
          const full = doc.createElement("section");
          full.className = "zob-reader-popup-prototype";
          full.textContent = `${reference.sourceID}: ${handedOff}`;
          return {
            element: full,
            dispose() {},
            async prepareForModeChange() {
              return "clean";
            },
            cancelModeChange() {},
          };
        },
        setError() {},
        dispose() {},
        async prepareForModeChange() {
          return "checkpointed";
        },
        cancelModeChange() {},
      };
    },
  };
  attachReaderPopupPrototype(
    { itemID: 88 },
    optimisticDocument,
    TestMutationObserver,
    optimisticDependencies,
  );
  await delay(0);
  assert.equal(ensureCalls, 1);
  assert.equal(
    optimisticPopup.classList.contains("zob-reader-card-host"),
    true,
  );
  const pendingEditor = optimisticPopup.querySelector(
    ".zob-reader-popup-prototype textarea",
  );
  assert.ok(pendingEditor, "Bridge is editable before companion ACK");
  pendingEditor.value = "Typed while Obsidian was still creating the card";
  pendingEditor.dispatchEvent(
    new optimisticDocument.defaultView.Event("input"),
  );
  assert.equal(savedDraft, pendingEditor.value);
  finishCreate();
  await delay(0);
  await delay(0);
  assert.match(
    optimisticPopup.textContent,
    /Typed while Obsidian was still creating/,
  );
  assert.equal(handedOff, savedDraft);
  assert.equal(
    optimisticPopup.querySelectorAll(".zob-reader-popup-prototype").length,
    1,
  );
  await detachReaderPopupPrototypes();
  preference.value = "native";
}

// A late companion ACK upgrades the same optimistic shell without resubmitting.
{
  preference.value = "bridge";
  const { document: lateAckDocument } = parseHTML(`<html><body>
    <div class="annotation-popup">
      <div class="comment"><div id="ANN001" contenteditable="true">Native</div></div>
    </div>
  </body></html>`);
  const popup = lateAckDocument.querySelector(".annotation-popup");
  let resolveAck;
  const ack = new Promise((resolve) => {
    resolveAck = resolve;
  });
  let ensureCalls = 0;
  let handoffs = 0;
  const reader = { itemID: 88 };
  attachReaderPopupPrototype(reader, lateAckDocument, TestMutationObserver, {
    ...popupDependencies,
    async ensureCard(...args) {
      ensureCalls++;
      if (ensureCalls === 1) {
        throw new CompanionPendingError("00000000-0000-4000-8000-000000000002");
      }
      return popupDependencies.ensureCard(...args);
    },
    async waitForCardRequest() {
      return ack;
    },
    async mountPendingCard(doc) {
      const shell = doc.createElement("section");
      shell.className = "zob-reader-popup-prototype";
      shell.textContent = "Editing before ACK";
      return {
        element: shell,
        async complete(reference) {
          handoffs++;
          return popupDependencies.mountCard(doc, annotations[0], reference);
        },
        setError() {},
        dispose() {},
        async prepareForModeChange() {
          return "pending";
        },
        cancelModeChange() {},
      };
    },
  });
  await delay(0);
  assert.equal(popup.classList.contains("zob-reader-card-host"), true);
  assert.match(popup.textContent, /Editing before ACK/);
  refreshReaderPopupPrototypes();
  await delay(0);
  assert.equal(ensureCalls, 1, "a pending request is never submitted twice");
  resolveAck({ status: "applied", revision: "late-ack" });
  await delay(0);
  await delay(0);
  assert.equal(ensureCalls, 2);
  assert.equal(handoffs, 1);
  assert.equal(popup.querySelectorAll(".zob-reader-popup-prototype").length, 1);
  await detachReaderPopupPrototypes();
  preference.value = "native";
}

// A single mode transition checkpoints every open Reader and rolls all editors back on failure.
{
  preference.value = "bridge";
  const createReaderDocument = (annotationID, nativeText) =>
    parseHTML(`<html><body>
      <div class="annotation-popup" data-native-color="yellow">
        <header>Page 2</header>
        <div class="comment"><div id="${annotationID}" contenteditable="true">${nativeText}</div></div>
        <button class="tags">Native tags</button>
      </div>
    </body></html>`).document;
  const firstDocument = createReaderDocument("ANN001", "Native comment one");
  const secondDocument = createReaderDocument("ANN002", "Native comment two");
  const firstPopup = firstDocument.querySelector(".annotation-popup");
  const secondPopup = secondDocument.querySelector(".annotation-popup");
  const originalNative = [firstPopup, secondPopup].map((popup) => ({
    comment: popup.querySelector(".comment").textContent,
    color: popup.getAttribute("data-native-color"),
    tags: popup.querySelector(".tags").textContent,
  }));
  const preparedSources = [];
  let cancelledPreparations = 0;
  let failSource = "";
  const modeDependencies = {
    ...popupDependencies,
    async mountCard(doc, annotation, reference) {
      const shell = doc.createElement("section");
      shell.className = "zob-reader-popup-prototype";
      shell.textContent = reference.sourceID;
      return {
        element: shell,
        dispose() {},
        async prepareForModeChange() {
          preparedSources.push(reference.sourceID);
          if (reference.sourceID === failSource) {
            throw new Error("simulated checkpoint failure");
          }
          return reference.sourceID.endsWith("ANN001")
            ? "checkpointed"
            : "pending";
        },
        cancelModeChange() {
          cancelledPreparations++;
        },
      };
    },
  };
  const firstReader = {
    _iframeWindow: { document: firstDocument },
    _initPromise: Promise.resolve(),
    itemID: 88,
  };
  const secondReader = {
    _iframeWindow: { document: secondDocument },
    _initPromise: Promise.resolve(),
    itemID: 89,
  };
  attachExistingReaderPopupPrototypes(
    [firstReader, secondReader],
    modeDependencies,
  );
  await delay(0);
  assert.equal(firstPopup.classList.contains("zob-reader-card-host"), true);
  assert.equal(secondPopup.classList.contains("zob-reader-card-host"), true);

  const preparation = await prepareReaderPopupModeChange();
  assert.equal(preparation.status, "pending");
  assert.equal(preparedSources.length, 2);
  preference.value = "native";
  preparation.commit();
  assert.equal(firstPopup.classList.contains("zob-reader-card-host"), false);
  assert.equal(secondPopup.classList.contains("zob-reader-card-host"), false);
  assert.deepEqual(
    [firstPopup, secondPopup].map((popup) => ({
      comment: popup.querySelector(".comment").textContent,
      color: popup.getAttribute("data-native-color"),
      tags: popup.querySelector(".tags").textContent,
    })),
    originalNative,
    "switching modes preserves native comment text, color, and tags in every Reader",
  );

  preference.value = "bridge";
  refreshReaderPopupPrototypes();
  await delay(0);
  failSource = "user:0/annotation/ANN002";
  const cancelledBeforeFailure = cancelledPreparations;
  await assert.rejects(
    prepareReaderPopupModeChange(),
    /simulated checkpoint failure/,
  );
  assert.equal(
    preference.value,
    "bridge",
    "a failed checkpoint cannot commit the mode change",
  );
  assert.equal(firstPopup.classList.contains("zob-reader-card-host"), true);
  assert.equal(secondPopup.classList.contains("zob-reader-card-host"), true);
  assert.ok(cancelledPreparations > cancelledBeforeFailure);
  failSource = "";
  await detachReaderPopupPrototypes();
  preference.value = "native";
}

process.stdout.write(
  "Reader popup checks passed: host key routing, mode preference wiring, multi-Reader checkpoint/rollback, native preservation, retry/click reconciliation, repeated mode cycles, fail-open, and shutdown restore.\n",
);
