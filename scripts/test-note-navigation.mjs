import assert from "node:assert/strict";
import console from "node:console";
import { parseHTML } from "linkedom";
import { bindNoteLinkNavigation } from "../src/services/note-link-navigation.ts";
import { mount } from "./c0-overlay-probe.js";

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
