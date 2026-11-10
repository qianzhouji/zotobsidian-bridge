import assert from "node:assert/strict";
import console from "node:console";
import { Buffer } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { renderKnowledgeMarkdown } from "../src/services/knowledge-note-renderer.ts";
import { createKnowledgeNoteCard } from "../src/services/knowledge-note-card.ts";
import {
  knowledgeNoteTitle,
  knowledgeNoteSource,
  renderKnowledgeNote,
} from "../src/core/knowledge-note.ts";
import { replaceTextareaRange } from "../src/services/textarea-wiki-completion.ts";
import {
  wikiCompletionContext,
  wikiCompletionText,
} from "../src/core/wiki-completion.ts";

const { document, window } = parseHTML(
  '<html lang="en"><head></head><body><section id="root"><textarea></textarea></section></body></html>',
);
window.innerWidth = 1200;
window.innerHeight = 800;
const made = [],
  revoked = [];
window.URL = {
  createObjectURL() {
    const url = `blob:synthetic-${made.length}`;
    made.push(url);
    return url;
  },
  revokeObjectURL(url) {
    revoked.push(url);
  },
};
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=";
const resource = {
  path: "Math/p.png",
  mimeType: "image/png",
  base64: png,
  byteLength: Buffer.from(png, "base64").length,
  revision: "r1",
  readAt: Date.now(),
};
const calls = [];
const client = {
  query: async (operation, input) => {
    calls.push({ operation, input });
    return { status: "ok", result: resource };
  },
};
const markdown =
  "# Math\n\n- [x] Read only\n- [ ] Pending\n\n$x^2$\n\n![local](p.png)\n\n![[p.png]]\n\n![remote](https://invalid.example/p.png)\n\n![svg](unsafe.svg)\n\n<script>alert(1)</script>\n\n[evil](javascript:alert(1))";
const cache = new Map();
const rendered = await renderKnowledgeMarkdown(
  markdown,
  "Math/Knowledge.md",
  document,
  client,
  new globalThis.AbortController().signal,
  cache,
);
assert.equal(calls.length, 2);
assert.ok(
  calls.every(
    (call) =>
      call.operation === "read-note-resource" &&
      call.input.sourcePath === "Math/Knowledge.md",
  ),
);
assert.equal((rendered.html.match(/<img /g) ?? []).length, 2);
assert.match(rendered.html, /disabled="disabled"/);
assert.match(rendered.html, /class="katex"/);
assert.doesNotMatch(rendered.html, /<script|<iframe|src="https:|src="data:/);
rendered.dispose();
assert.equal(revoked.length, 2);
await renderKnowledgeMarkdown(
  markdown,
  "Math/Knowledge.md",
  document,
  {
    query() {
      throw new Error("Offline cache must not query");
    },
  },
  new globalThis.AbortController().signal,
  cache,
  true,
).then((r) => r.dispose());
const abort = new globalThis.AbortController();
abort.abort();
await assert.rejects(
  renderKnowledgeMarkdown(
    markdown,
    "Math/Knowledge.md",
    document,
    client,
    abort.signal,
  ),
  /cancelled/,
);
const payload = Buffer.from(
  JSON.stringify({ bridge_card_id: "test", bridge_schema: 1 }),
).toString("base64");
const hidden = `---\ntitle: Synthetic\n---\n<span data-zotero-obsidian-bridge="metadata" data-payload="${payload}"></span>\n# Body\n\nWhole body`;
assert.equal(
  knowledgeNoteSource(hidden).split("\n").length,
  hidden.split("\n").length,
);
assert.doesNotMatch(
  renderKnowledgeNote(hidden),
  /data-payload|bridge_card_id|title: Synthetic/,
);
assert.match(renderKnowledgeNote(hidden), /Whole body/);
assert.equal(
  knowledgeNoteTitle("---\ntitle: Human title\n---\n# Heading", "n.md"),
  "Human title",
);
assert.equal(knowledgeNoteTitle("# **Heading**\n\nText", "n.md"), "Heading");

const text = "before [[Note|my alias]] after";
const c = wikiCompletionContext(text, 13);
assert.equal(c.alias, "my alias");
assert.equal(
  wikiCompletionText("Math/Note.md", undefined, c.alias),
  "[[Math/Note|my alias]]",
);
const editor = document.querySelector("textarea");
editor.value = "before [[Ma]] after";
editor.setSelectionRange = (start, end) => {
  editor.selectionStart = start;
  editor.selectionEnd = end;
};
document.execCommand = (command, _, text) => {
  assert.equal(command, "insertText");
  editor.value =
    editor.value.slice(0, editor.selectionStart) +
    text +
    editor.value.slice(editor.selectionEnd);
  return true;
};
let inputs = 0;
editor.addEventListener("input", () => inputs++);
assert.equal(replaceTextareaRange(editor, 7, 13, "[[Math/Note]]"), true);
assert.equal(editor.value, "before [[Math/Note]] after");
assert.equal(inputs, 1);
document.execCommand = () => false;
const before = editor.value;
assert.equal(replaceTextareaRange(editor, 7, 20, "no"), false);
assert.equal(editor.value, before);

// Stateful UI races/permission/cache checks. This does not claim native IME or undo acceptance.
const root = document.getElementById("root");
root.style.overflow = "hidden";
const note = {
  path: "Math/Note.md",
  markdown: "# Heading\n\nSaved body $x^2$.\n\n[[Physics/Motion]]",
  revision: "rev1",
  readAt: Date.now(),
  indexGeneration: 1,
  metadata: { valid: true, revision: "rev1", headings: [], blocks: [] },
};
let mode = "ok",
  epoch = "epoch1",
  held;
const service = {
  calls: [],
  async scope() {
    if (mode === "forbidden" || mode === "offline") throw { status: mode };
    return epoch;
  },
  async query(operation, input) {
    this.calls.push({ operation, input });
    if (mode === "held") {
      mode = "ok";
      await new Promise((resolve) => (held = resolve));
    }
    if (mode === "missing") return { status: "not-found" };
    if (operation === "resolve-link")
      return {
        status: "ok",
        result: {
          path: input.linkpath.replace(/\.md$/, "") + ".md",
          revision: "rev1",
          anchorState: "none",
        },
      };
    return { status: "ok", result: { ...note, path: input.path } };
  },
  cancel() {},
  close() {},
};
const sleep = (ms) => delay(ms);
async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error("UI condition timed out");
}
const card = createKnowledgeNoteCard({
  owner: root,
  createClient: () => service,
  vaultPath: "/isolated/vault",
  launchURL() {
    throw new Error("No implicit navigation");
  },
});
await card.open("Math/Note", "Root.md");
await waitFor(() => document.querySelector('[data-state="ready"]'));
const firstCard = document.querySelector(".zob-knowledge-card");
assert.match(
  firstCard.querySelector(".zob-knowledge-body").textContent,
  /Saved body/,
);
assert.equal(
  firstCard.querySelector(".zob-knowledge-title").textContent,
  "Heading",
);
assert.equal(firstCard.querySelector("textarea"), null);
assert.ok(firstCard.querySelector(".zob-knowledge-body .katex"));
assert.match(
  document.getElementById("zob-note-ui-style").textContent,
  /\.zob-knowledge-body \.katex \.katex-mathml\{[^}]*clip-path:inset\(50%\)[^}]*position:absolute/s,
  "knowledge cards must visually hide KaTeX's duplicate MathML while keeping it available to assistive technology",
);
firstCard
  .querySelector('.zob-knowledge-body [data-zob-note-link="Physics/Motion"]')
  .dispatchEvent(
    new window.Event("click", { bubbles: true, cancelable: true }),
  );
await waitFor(() =>
  service.calls.some(
    (call) =>
      call.operation === "resolve-link" &&
      call.input.linkpath === "Physics/Motion" &&
      call.input.sourcePath === "Math/Note.md",
  ),
);
await waitFor(
  () =>
    document.querySelectorAll('.zob-knowledge-card[data-state="ready"]')
      .length === 2,
);
mode = "held";
epoch = "epoch2";
firstCard.querySelector('button[aria-label="Refresh"]').click();
await waitFor(() => held);
assert.match(
  firstCard.querySelector(".zob-knowledge-body").textContent,
  /Saved body/,
);
held();
await waitFor(() => firstCard.dataset.state === "ready");
mode = "offline";
firstCard.querySelector('button[aria-label="Refresh"]').click();
await waitFor(() => firstCard.dataset.state === "cached");
assert.equal(
  firstCard.querySelector('button[aria-label="Open in Obsidian"]').disabled,
  true,
);
mode = "forbidden";
firstCard.querySelector('button[aria-label="Refresh"]').click();
await waitFor(() => firstCard.dataset.state === "forbidden");
assert.equal(firstCard.querySelector(".zob-knowledge-body").textContent, "");
mode = "ok";
firstCard.querySelector('button[aria-label="Refresh"]').click();
await waitFor(() => firstCard.dataset.state === "ready");
mode = "missing";
firstCard.querySelector('button[aria-label="Refresh"]').click();
await waitFor(() => firstCard.dataset.state === "not-found");
mode = "held";
void card.open("Math/Late", "Root.md");
await waitFor(() => held);
card.dispose();
held();
await sleep(30);
assert.equal(document.querySelector(".zob-knowledge-card"), null);
assert.equal(root.style.overflow, "hidden");
assert.equal(editor.value, before);
console.log(
  "C3/C4 DOM checks passed: range replacement, aliases, full note/title, safe images/tasks/math, nested-link context, abort, offline cache, revocation, epoch invalidation, missing note and late-close cleanup.",
);
