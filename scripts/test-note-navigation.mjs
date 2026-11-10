import assert from "node:assert/strict";
import console from "node:console";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { parseHTML } from "linkedom";
import { bindNoteLinkNavigation } from "../src/services/note-link-navigation.ts";
import { createMarkdownRenderer } from "../src/core/markdown-preview.ts";
import { mount } from "./c0-overlay-probe.js";

const [editorWindowSource, markdownEditorSource, pendingEditorSource] =
  await Promise.all([
    readFile(
      new URL("../src/services/editor-window.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/services/markdown-editor.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/services/pending-markdown-editor.ts", import.meta.url),
      "utf8",
    ),
  ]);
assert.match(
  editorWindowSource,
  /prepareSurface:\s*bridge\.prepareKnowledgeCardSurface/,
  "the standalone editor must use the host-provided surface factory",
);
assert.doesNotMatch(
  editorWindowSource,
  /\bZotero\b|desktopKnowledgeCardsEnabled\(\)|createDesktopKnowledgeCardSurface/,
  "the standalone editor must not access Zotero globals or instantiate host surfaces directly",
);
assert.match(
  markdownEditorSource,
  /prepareKnowledgeCardSurface:\s*desktopKnowledgeCardsEnabled\(\)\s*\?\s*\(client, options\)\s*=>\s*createDesktopKnowledgeCardSurface\(client, options\)/s,
);
assert.match(
  pendingEditorSource,
  /prepareKnowledgeCardSurface:\s*desktopKnowledgeCardsEnabled\(\)\s*\?\s*\(client, options\)\s*=>\s*createDesktopKnowledgeCardSurface\(client, options\)/s,
);

const { document, window } = parseHTML(
  "<html><body><section id='root'><textarea></textarea><div id='preview'><a href='#' data-zob-note-link='Math/Bayes'>Bayes</a></div><span id='status'></span></section></body></html>",
);
const root = document.getElementById("root");
const editor = root.querySelector("textarea");
const preview = document.getElementById("preview");
const status = document.getElementById("status");
const markdown = "[[Math/Bayes]]\n\n# Unsaved\n";
editor.value = markdown;
const calls = [];
let resolve;
let closed = false;
let localOffset;
const dispose = bindNoteLinkNavigation({
  previews: [preview],
  editor,
  sourcePath: "Root.md",
  markdown: () => editor.value,
  offset: () => 3,
  status,
  locateLocal: (offset) => {
    localOffset = offset;
  },
  createClient: () => ({
    query(operation, input) {
      calls.push({ operation, input });
      return new Promise((done) => {
        resolve = done;
      });
    },
    close() {
      closed = true;
    },
  }),
});
const event = (type, props = {}) => {
  const value = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(value, props);
  return value;
};
editor.dispatchEvent(event("click", { button: 0, metaKey: false }));
assert.equal(calls.length, 0);
editor.dispatchEvent(event("click", { button: 0, metaKey: true }));
assert.equal(calls.length, 1);
assert.equal(calls[0].operation, "resolve-link");
assert.equal(calls[0].input.sourcePath, "Root.md");
resolve({
  status: "ok",
  result: { path: "Math/Bayes.md", anchorState: "none" },
});
await Promise.resolve();
assert.equal(status.textContent, "Math/Bayes.md");
preview.querySelector("a").setAttribute("data-zob-note-link", "#Unsaved");
preview.querySelector("a").dispatchEvent(event("click"));
assert.equal(localOffset, markdown.indexOf("# Unsaved"));
assert.equal(calls.length, 1);
preview.querySelector("a").setAttribute("data-zob-note-link", "Physics/Motion");
preview.querySelector("a").dispatchEvent(event("click"));
assert.equal(calls.length, 2);
const previous = status.textContent;
dispose();
resolve({ status: "ok", result: { path: "late.md", anchorState: "none" } });
await Promise.resolve();
assert.equal(status.textContent, previous);
assert.equal(status.isConnected, false);
assert.equal(closed, true);
assert.equal(editor.value, markdown);

const navigationStatus = document.createElement("span");
root.append(navigationStatus);
const renderer = createMarkdownRenderer();
preview.innerHTML = renderer.render("[[Math/Bayes]]");
const renderedLink = preview.querySelector("a[data-zob-note-link]");
assert.equal(
  renderedLink?.getAttribute("data-zob-note-link"),
  "Math/Bayes",
  "the editor preview must preserve the internal target on rendered wikilinks",
);
renderedLink.innerHTML = "<span>Bayes</span>";
let finishNavigation;
const navigationCalls = [];
const disposePreviewNavigation = bindNoteLinkNavigation({
  previews: [preview],
  editor,
  sourcePath: "Annotations/P02N01.md",
  markdown: () => editor.value,
  offset: () => null,
  status: navigationStatus,
  locateLocal() {},
  async onNavigate(target, sourcePath, anchor) {
    navigationCalls.push({ target, sourcePath, anchor });
    await new Promise((done) => {
      finishNavigation = done;
    });
  },
});
const previewClick = event("click");
preview.querySelector("span").dispatchEvent(previewClick);
assert.equal(previewClick.defaultPrevented, true);
assert.equal(navigationCalls.length, 1);
assert.equal(navigationCalls[0].target, "Math/Bayes");
assert.equal(navigationCalls[0].sourcePath, "Annotations/P02N01.md");
assert.equal(navigationCalls[0].anchor, renderedLink);
assert.equal(navigationStatus.textContent, "Opening linked note: Math/Bayes");
finishNavigation();
await Promise.resolve();
await Promise.resolve();
assert.equal(navigationStatus.textContent, "Opened linked note: Math/Bayes");
disposePreviewNavigation();

renderedLink.setAttribute("data-zob-note-link", "Math/Unavailable");
const failedNavigationStatus = document.createElement("span");
root.append(failedNavigationStatus);
const disposeFailedNavigation = bindNoteLinkNavigation({
  previews: [preview],
  editor,
  sourcePath: "Annotations/P02N01.md",
  markdown: () => editor.value,
  offset: () => null,
  status: failedNavigationStatus,
  locateLocal() {},
  async onNavigate() {
    throw new Error("card surface unavailable");
  },
});
preview.querySelector("span").dispatchEvent(event("click"));
await Promise.resolve();
assert.equal(failedNavigationStatus.textContent, "card surface unavailable");
disposeFailedNavigation();

// DOM-level probe checks are not native Zotero host acceptance.
window.innerWidth = 1200;
window.innerHeight = 800;
window.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
root.dataset.annotationID = "SYNTHETIC";
root.style.overflow = "hidden";
const probe = mount(root);
assert.equal(probe.panels.length, 2);
assert.equal(probe.layer.querySelectorAll("svg line").length, 2);
assert.ok(
  probe.panels.every((panel) => panel.classList.contains("label-popup")),
);
assert.equal(
  probe.panels.some((panel) =>
    panel.querySelector("textarea,input,[contenteditable]"),
  ),
  false,
);
const deletion = event("keydown", { key: "Backspace" });
probe.panels[0].dispatchEvent(deletion);
assert.equal(deletion.defaultPrevented, true);
assert.equal(probe.metrics.key, 1);
probe.dispose();
probe.dispose();
assert.equal(probe.layer.isConnected, false);
assert.equal(root.style.overflow, "hidden");
assert.equal(root.isConnected, true);
assert.equal(editor.value, markdown);
console.log(
  "C2 navigation and C0 DOM-probe checks passed. Native Reader/editor 20-interaction gate NOT exercised.",
);
