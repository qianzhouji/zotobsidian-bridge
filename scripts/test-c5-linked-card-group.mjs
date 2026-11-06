import assert from "node:assert/strict";
import console from "node:console";
import { setTimeout as delay } from "node:timers/promises";
import { parseHTML } from "linkedom";
import {
  LinkedCardGraph,
  LINKED_CARD_GROUP_LIMIT,
  LINKED_CARD_WINDOW_LIMIT,
  clampCardRect,
  initialCardRect,
  moveCardRect,
  resizeCardRect,
} from "../src/core/linked-card-group.ts";
import { createKnowledgeNoteCard } from "../src/services/knowledge-note-card.ts";

const graph = new LinkedCardGraph(4);
assert.deepEqual(graph.link("A", "A"), {
  nodeAdded: true,
  edgeAdded: true,
  atLimit: false,
});
assert.equal(graph.link("A", "B").nodeAdded, true);
assert.equal(graph.link("B", "A").edgeAdded, true);
assert.equal(graph.link("A", "C").nodeAdded, true);
assert.equal(graph.link("B", "C").nodeAdded, false);
assert.equal(graph.nodeCount, 3);
assert.equal(graph.edgeCount, 5);
assert.equal(graph.link("C", "D").nodeAdded, true);
assert.equal(graph.link("D", "E").atLimit, true);
graph.remove("C");
assert.equal(graph.has("C"), false);
assert.ok(
  graph.relations().every((edge) => edge.from !== "C" && edge.to !== "C"),
);

const viewport = { width: 1000, height: 700 };
const initial = initialCardRect(
  { left: 400, right: 420, top: 200, bottom: 220 },
  viewport,
);
assert.equal(initial.width, 360);
assert.equal(initial.height, 300);
assert.ok(initial.x >= 8 && initial.y >= 8);
let rect = { x: 10, y: 10, width: 360, height: 300 };
for (let index = 0; index < 20; index++) {
  rect = resizeCardRect(rect, -600, -500, viewport);
  assert.equal(rect.width, 260);
  assert.equal(rect.height, 180);
  rect = resizeCardRect(rect, 45, 35, viewport);
  assert.equal(rect.width, 305);
  assert.equal(rect.height, 215);
  rect = resizeCardRect(rect, -45, -35, viewport);
}
rect = moveCardRect(rect, -5000, -5000, viewport);
assert.equal(rect.x, 8);
assert.equal(rect.y, 8);
assert.deepEqual(
  clampCardRect(
    { x: 0, y: 0, width: 900, height: 900 },
    { width: 300, height: 200 },
  ),
  { x: 8, y: 8, width: 284, height: 184 },
);

const { document, window } = parseHTML(
  '<html lang="en"><head></head><body><div id="actions-a"></div><main id="owner-a"></main><div id="actions-b"></div><main id="owner-b"></main><div id="actions-c"></div><main id="owner-c"></main></body></html>',
);
window.innerWidth = 1600;
window.innerHeight = 1000;
window.AbortController = globalThis.AbortController;
window.URL = {
  createObjectURL: () => "blob:c5-test",
  revokeObjectURL() {},
};
const notes = new Map([
  ["A.md", "# Note A\n\n[[B]]\n\n[[C]]\n\n[[A]]"],
  ["B.md", "# Note B\n\n[[A]]\n\n[[D]]\n\n[[E]]"],
  ["C.md", "# Note C\n\n[[D]]"],
  ["D.md", "# Note D\n\nLeaf note."],
  ["E.md", "# Note E\n\nOnly reachable through B."],
]);
const calls = [];
function createClient() {
  return {
    async scope() {
      return "test-epoch";
    },
    async query(operation, input) {
      calls.push({ operation, input });
      if (operation === "resolve-link") {
        const path = input.linkpath.replace(/\.md$/i, "") + ".md";
        return {
          status: "ok",
          result: {
            path,
            revision: "r1",
            fragment: "",
            anchorState: "none",
          },
        };
      }
      if (operation === "read-note")
        return {
          status: "ok",
          result: {
            path: input.path,
            markdown: notes.get(input.path) ?? `# ${input.path}\n\nLeaf note.`,
            revision: "r1",
            readAt: Date.now(),
            indexGeneration: 1,
            metadata: { valid: true, revision: "r1", headings: [], blocks: [] },
          },
        };
      throw new Error(`Unexpected operation ${operation}`);
    },
    cancel() {},
    close() {},
  };
}
const waitFor = async (predicate) => {
  for (let index = 0; index < 250; index++) {
    if (predicate()) return;
    await delay(4);
  }
  throw new Error("C5 DOM condition timed out");
};
const makeGroup = (suffix) =>
  createKnowledgeNoteCard({
    owner: document.getElementById(`owner-${suffix}`),
    controlHost: document.getElementById(`actions-${suffix}`),
    createClient,
    vaultPath: "/test-vault",
    launchURL() {
      throw new Error("Unexpected external navigation");
    },
  });
const first = makeGroup("a");
const second = makeGroup("b");
const third = makeGroup("c");
await first.open("A", "Root.md");
await waitFor(() =>
  document.querySelector('.zob-knowledge-card[data-state="ready"]'),
);
const cardFor = (path) =>
  [...document.querySelectorAll(".zob-knowledge-card")].find(
    (panel) => panel.querySelector(".zob-knowledge-title")?.title === path,
  );
const clickLink = async (from, target) => {
  const card = cardFor(from);
  assert.ok(card, `missing card ${from}`);
  const anchor = card.querySelector(`[data-zob-note-link="${target}"]`);
  assert.ok(anchor, `missing ${from} -> ${target}`);
  anchor.dispatchEvent(
    new window.Event("click", { bubbles: true, cancelable: true }),
  );
  await waitFor(() =>
    cardFor(target.endsWith(".md") ? target : `${target}.md`),
  );
  await waitFor(
    () =>
      cardFor(target.endsWith(".md") ? target : `${target}.md`).dataset
        .state === "ready",
  );
};

const firstRoot = cardFor("A.md");
await clickLink("A.md", "B");
await clickLink("B.md", "A");
await clickLink("A.md", "A");
await clickLink("A.md", "C");
await clickLink("C.md", "D");
await clickLink("B.md", "D");
await clickLink("B.md", "E");
assert.equal(
  document.querySelectorAll(".zob-knowledge-card").length,
  5,
  "cycles and diamond targets must deduplicate by canonical path",
);
await waitFor(
  () =>
    document
      .querySelectorAll(".zob-knowledge-layer")[0]
      .querySelectorAll(".zob-knowledge-edge").length === 7,
);
assert.equal(document.querySelectorAll(".zob-knowledge-layer").length, 1);
const layerA = document.querySelector(".zob-knowledge-layer");
assert.equal(layerA.parentElement.id, "owner-a");
assert.equal(layerA.style.pointerEvents, "none");
assert.equal(layerA.querySelector("svg").style.pointerEvents, "none");
assert.equal(
  layerA.firstElementChild.localName,
  "svg",
  "edges render beneath cards and controls",
);
assert.equal(
  firstRoot.querySelector(".zob-knowledge-body").textContent.includes("Note A"),
  true,
);

const cardB = cardFor("B.md");
cardB.querySelector('[aria-label="Close knowledge card"]').click();
assert.equal(cardFor("B.md"), undefined);
assert.equal(
  cardFor("E.md"),
  undefined,
  "a node reachable only through the closed intermediate must be pruned",
);
assert.ok(
  cardFor("D.md"),
  "a diamond descendant stays open while another parent still reaches it",
);
await waitFor(
  () => layerA.querySelectorAll(".zob-knowledge-edge").length === 4,
);
await clickLink("A.md", "B");
assert.equal(
  document.querySelectorAll(".zob-knowledge-card").length,
  4,
  "closed intermediate cards must be reopenable",
);

const panelA = cardFor("A.md");
const headerRect = (panel) => {
  const header = panel.querySelector(".zob-knowledge-header");
  header.getBoundingClientRect = () => {
    const left = Number.parseFloat(panel.style.left) || 0;
    const top = Number.parseFloat(panel.style.top) || 0;
    const width = Number.parseFloat(panel.style.width) || 0;
    const height = 40;
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON() {},
    };
  };
};
for (const panel of document.querySelectorAll(".zob-knowledge-card"))
  headerRect(panel);
const edgeAB = () =>
  [...layerA.querySelectorAll(".zob-knowledge-edge")].find((edge) =>
    edge.querySelector("title")?.textContent.includes("A.md → B.md"),
  );
await waitFor(() => edgeAB()?.getAttribute("d"));
const pathBeforeResize = edgeAB().getAttribute("d");
const resize = panelA.querySelector(".zob-knowledge-resize");
const pointer = (type, target, x, y) => {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    pointerId: { value: 7 },
    clientX: { value: x },
    clientY: { value: y },
  });
  target.dispatchEvent(event);
};
for (let index = 0; index < 20; index++) {
  pointer("pointerdown", resize, 100, 100);
  pointer("pointermove", resize, -500, -500);
  pointer("pointerup", resize, -500, -500);
  assert.equal(panelA.style.width, "260px");
  assert.equal(panelA.style.height, "180px");
  pointer("pointerdown", resize, 100, 100);
  pointer("pointermove", resize, 145, 135);
  pointer("pointerup", resize, 145, 135);
  assert.equal(panelA.style.width, "305px");
  assert.equal(panelA.style.height, "215px");
}
await waitFor(() => edgeAB().getAttribute("d") !== pathBeforeResize);
const originalLeft = Number.parseFloat(panelA.style.left);
const pathBeforeDrag = edgeAB().getAttribute("d");
pointer("pointerdown", panelA.querySelector(".zob-knowledge-header"), 100, 100);
pointer("pointermove", panelA.querySelector(".zob-knowledge-header"), 125, 130);
pointer(
  "pointercancel",
  panelA.querySelector(".zob-knowledge-header"),
  125,
  130,
);
assert.ok(Number.parseFloat(panelA.style.left) >= originalLeft);
await waitFor(() => edgeAB().getAttribute("d") !== pathBeforeDrag);

await second.open("N1", "OtherRoot.md");
await waitFor(() => cardFor("N1.md"));
await waitFor(() => cardFor("N1.md").dataset.state === "ready");
assert.equal(
  document.querySelectorAll(".zob-knowledge-layer").length,
  2,
  "each editor owns an isolated overlay",
);
const layerB = document.querySelectorAll(".zob-knowledge-layer")[1];
await waitFor(
  () => layerB.querySelectorAll(".zob-knowledge-edge").length === 1,
);
const collapse = document.querySelector(
  '#actions-b [aria-label="Collapse linked knowledge cards"]',
);
assert.ok(collapse && !collapse.hidden);
collapse.click();
assert.equal(cardFor("N1.md"), undefined);
assert.ok(
  cardFor("A.md"),
  "collapsing one group must preserve the other editor group",
);
assert.equal(document.getElementById("owner-b").style.overflow, "");

for (let index = 1; index <= LINKED_CARD_GROUP_LIMIT; index++) {
  await second.open(`N${index}`, "OtherRoot.md");
  await waitFor(() => cardFor(`N${index}.md`)?.dataset.state === "ready");
}
await second.open("N9", "OtherRoot.md");
assert.equal(
  document.querySelectorAll(".zob-knowledge-card").length,
  4 + LINKED_CARD_GROUP_LIMIT,
);
assert.ok(
  document.querySelector(".zob-card-group-message"),
  "group limit should be explained without a stray card",
);
await second.open("N1", "OtherRoot.md");
assert.equal(
  document.querySelectorAll(".zob-knowledge-card").length,
  4 + LINKED_CARD_GROUP_LIMIT,
  "existing cards remain focusable at the cap",
);

for (let index = 1; index <= 4; index++) {
  await first.open(`E${index}`, "Root.md");
  await waitFor(() => cardFor(`E${index}.md`)?.dataset.state === "ready");
}
assert.equal(
  document.querySelectorAll(".zob-knowledge-card").length,
  LINKED_CARD_WINDOW_LIMIT,
);
await third.open("M1", "ThirdRoot.md");
assert.equal(
  document.querySelectorAll(".zob-knowledge-card").length,
  LINKED_CARD_WINDOW_LIMIT,
);
assert.ok(
  document.querySelectorAll(".zob-card-group-message").length >= 2,
  "window cap should be surfaced",
);
await first.open("A", "Root.md");
assert.equal(
  document.querySelectorAll(".zob-knowledge-card").length,
  LINKED_CARD_WINDOW_LIMIT,
  "focusing an open path still works at window cap",
);

first.dispose();
second.dispose();
third.dispose();
assert.equal(document.querySelectorAll(".zob-knowledge-layer").length, 0);
assert.equal(document.querySelectorAll(".zob-knowledge-card").length, 0);
assert.ok(calls.some((call) => call.input?.linkpath === "D"));
assert.equal(LINKED_CARD_GROUP_LIMIT, 8);
assert.equal(LINKED_CARD_WINDOW_LIMIT, 16);
console.log(
  "C5 linked-card group checks passed: cycles, self-links, diamond dedupe, reopen, isolated groups, drag/resize minimum reversal, edge updates and collapse.",
);
