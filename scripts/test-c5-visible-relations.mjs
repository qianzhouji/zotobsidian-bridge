import assert from "node:assert/strict";
import console from "node:console";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { resolveVisibleCardRelations } from "../src/core/visible-card-relations.ts";
import { createKnowledgeNoteCard } from "../src/services/knowledge-note-card.ts";
import { KnowledgeCardGroupSurface } from "../src/services/knowledge-card-group-surface.ts";

const preferenceMarkup = await readFile(
  "addon/content/preferences.xhtml",
  "utf8",
);
const preferenceDefaults = await readFile("addon/prefs.js", "utf8");
assert.match(
  preferenceMarkup,
  /id="zotero-prefpane-__addonRef__-inlineKnowledgeCardLines"/,
);
assert.match(
  preferenceMarkup,
  /id="zotero-prefpane-__addonRef__-desktopKnowledgeCardLines"/,
);
assert.match(preferenceDefaults, /pref\("inlineKnowledgeCardLines", true\)/);
assert.match(preferenceDefaults, /pref\("desktopKnowledgeCardLines", true\)/);

const waitFor = async (predicate) => {
  for (let i = 0; i < 600; i++) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error("C5-A/B condition timed out");
};
const resolve = (source, target) => {
  const path = target.split("#")[0];
  return {
    bay: "Mathematics/Bayes.md",
    Bayes: "Mathematics/Bayes.md",
    "Mathematics/Bayes": "Mathematics/Bayes.md",
    Motion: "Physics/Motion.md",
    "Physics/Motion": "Physics/Motion.md",
    Root: "Root.md",
  }[path];
};
const rootMarkdown =
  "[[bay|Bayes]]\n\n[[Mathematics/Bayes]]\n\n[[Physics/Motion]]";
const notes = [
  { path: "Root.md", markdown: rootMarkdown },
  {
    path: "Mathematics/Bayes.md",
    markdown:
      "[[Motion]]\n\n`[[Ghost]]`\n\n%% [[Ghost]] %%\n\n![[Ghost]]\n\n\\[[Ghost]]",
  },
  { path: "Physics/Motion.md", markdown: "[[Bayes]]\n\n[[Not open]]" },
];
let inFlight = 0;
let peak = 0;
const targets = [];
const result = await resolveVisibleCardRelations(
  notes,
  async (source, target) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    targets.push(target);
    await delay(1);
    inFlight--;
    return resolve(source, target);
  },
  new globalThis.AbortController().signal,
);
assert.equal(peak, 2);
assert.equal(result.edges.length, 4);
assert.deepEqual(
  result.edges.find(
    (edge) => edge.from === "Root.md" && edge.to === "Mathematics/Bayes.md",
  ).targets,
  ["bay", "Mathematics/Bayes"],
);
assert.ok(!targets.includes("Ghost"));
assert.ok(!result.edges.some((edge) => edge.to.includes("Not open")));
const self = await resolveVisibleCardRelations(
  [{ path: "Root.md", markdown: "[[Root]] [[Other/Motion]] [[Denied]]" }],
  async (_source, target) => {
    if (target === "Denied") throw { status: "forbidden" };
    return target === "Root" ? "Root.md" : "Other/Motion.md";
  },
  new globalThis.AbortController().signal,
);
assert.equal(self.partial, true);
assert.deepEqual(self.edges, [
  { from: "Root.md", to: "Root.md", targets: ["Root"] },
]);

// An aborted snapshot must never add edges after its resolver returns.
const abort = new globalThis.AbortController();
const cancelled = resolveVisibleCardRelations(
  notes,
  async (source, target) => {
    abort.abort();
    return resolve(source, target);
  },
  abort.signal,
);
assert.equal((await cancelled).edges.length, 0);

const { document, window } = parseHTML(
  '<html lang="en"><head></head><body><div id="native-popup" style="visibility:hidden"><main id="owner" style="visibility:visible"><header id="root-title">Root</header><section id="preview"><a data-zob-note-link="bay">Bayes alias</a><a data-zob-note-link="Mathematics/Bayes">Bayes canonical</a><a data-zob-note-link="Physics/Motion">Motion</a></section><div id="actions"></div></main></div></body></html>',
);
window.innerWidth = 1600;
window.innerHeight = 1000;
window.AbortController = globalThis.AbortController;
window.URL = { createObjectURL: () => "blob:test", revokeObjectURL() {} };
const previousZotero = globalThis.Zotero;
const preferences = new Map([
  ["extensions.zotero.zoteroobsidianbridge.inlineKnowledgeCardLines", true],
  ["extensions.zotero.zoteroobsidianbridge.desktopKnowledgeCardLines", true],
]);
const preferenceObservers = new Map();
let preferenceObserverSequence = 0;
globalThis.Zotero = {
  Prefs: {
    get(name, fallback) {
      return preferences.has(name) ? preferences.get(name) : fallback;
    },
    registerObserver(name, callback, notifyNow) {
      const id = Symbol(`preference-${++preferenceObserverSequence}`);
      preferenceObservers.set(id, { name, callback });
      if (notifyNow) callback();
      return id;
    },
    unregisterObserver(id) {
      preferenceObservers.delete(id);
    },
  },
};
const setPreference = (name, value) => {
  preferences.set(name, value);
  for (const observer of preferenceObservers.values())
    if (observer.name === name) observer.callback();
};
// Reader hides the native popup shell but explicitly restores visibility on
// the Bridge child. CSS visibility can be overridden by descendants.
window.getComputedStyle = (node) => {
  let visibility = "visible";
  for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.style.visibility) {
      visibility = ancestor.style.visibility;
      break;
    }
  }
  return {
    visibility,
    display: node.style.display || "block",
    overflow: node.style.overflow || "visible",
    overflowX: node.style.overflowX || "visible",
    overflowY: node.style.overflowY || "visible",
  };
};
let markdown = rootMarkdown;
let scope = "epoch-1";
let delayed = false;
let reads = 0;
const calls = [];
const group = createKnowledgeNoteCard({
  owner: document.getElementById("owner"),
  controlHost: document.getElementById("actions"),
  vaultPath: "/test-vault",
  root: {
    sourcePath: "Root.md",
    markdown: () => markdown,
    previews: [document.getElementById("preview")],
    anchor: document.getElementById("root-title"),
  },
  createClient() {
    return {
      scope: async () => scope,
      async query(operation, input) {
        calls.push({ operation, input });
        if (delayed && operation === "resolve-link") await delay(160);
        if (operation === "resolve-link") {
          const path = resolve(input.sourcePath, input.linkpath);
          return path
            ? {
                status: "ok",
                result: {
                  path,
                  revision: "r1",
                  fragment: "",
                  anchorState: "none",
                },
              }
            : { status: "not-found" };
        }
        assert.equal(
          operation,
          "read-note",
          "relation discovery must never issue writes or resource reads",
        );
        reads++;
        return {
          status: "ok",
          result: {
            path: input.path,
            markdown: notes.find((note) => note.path === input.path).markdown,
            revision: "r1",
            readAt: Date.now(),
            metadata: { valid: true, headings: [], blocks: [] },
          },
        };
      },
      close() {},
      cancel() {},
    };
  },
  launchURL() {
    throw new Error("Unexpected launch");
  },
});
const owner = document.getElementById("owner");
const cards = () => [...document.querySelectorAll(".zob-knowledge-card")];
const rootBayesAlias = document.querySelector('a[data-zob-note-link="bay"]');
const rootBayesCanonical = document.querySelector(
  'a[data-zob-note-link="Mathematics/Bayes"]',
);
const rootMotion = document.querySelector(
  'a[data-zob-note-link="Physics/Motion"]',
);
const testRect = (left, top, width = 40, height = 20) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});
rootBayesAlias.getBoundingClientRect = () => testRect(100, 200);
rootBayesCanonical.getBoundingClientRect = () => testRect(210, 300);
rootMotion.getBoundingClientRect = () => testRect(100, 400);
const edgeTitles = () =>
  [...document.querySelectorAll(".zob-knowledge-edge title")].map(
    (node) => node.textContent,
  );
await group.open("Mathematics/Bayes", "Root.md", rootBayesCanonical);
await waitFor(() => owner.dataset.relationsState === "ready");
await waitFor(() => edgeTitles().length === 1);
assert.equal(edgeTitles().length, 1);
setPreference(
  "extensions.zotero.zoteroobsidianbridge.inlineKnowledgeCardLines",
  false,
);
await waitFor(() => edgeTitles().length === 0);
setPreference(
  "extensions.zotero.zoteroobsidianbridge.desktopKnowledgeCardLines",
  false,
);
await delay(20);
assert.equal(
  edgeTitles().length,
  0,
  "changing the desktop-line setting does not turn Reader lines back on",
);
setPreference(
  "extensions.zotero.zoteroobsidianbridge.inlineKnowledgeCardLines",
  true,
);
await waitFor(() => edgeTitles().length === 1);
assert.equal(cards().length, 1, "automatic discovery must not open Motion");
assert.equal(reads, 1);
const rootBayesEdge = () =>
  [...document.querySelectorAll(".zob-knowledge-edge")].find((node) =>
    node.textContent.includes("Root.md → Mathematics/Bayes.md"),
  );
await waitFor(() => rootBayesEdge()?.getAttribute("d"));
assert.ok(
  rootBayesEdge().getAttribute("d").startsWith("M 230 310"),
  "the root relation must originate from the exact Bridge wikilink that was opened, not the first alias or title",
);
const bayes = cards()[0];
const motion = bayes.querySelector('[data-zob-note-link="Motion"]');
motion.click();
await waitFor(
  () =>
    cards().length === 2 &&
    owner.dataset.relationsState === "ready" &&
    edgeTitles().length === 3,
);
assert.equal(reads, 2);
const rootMotionEdge = () =>
  [...document.querySelectorAll(".zob-knowledge-edge")].find((node) =>
    node.textContent.includes("Root.md → Physics/Motion.md"),
  );
assert.ok(
  rootMotionEdge().getAttribute("d").startsWith("M 120 410"),
  "automatically discovered Motion must use its own visible Bridge link row, even inside the hidden native popup shell",
);
await group.open(
  "Physics/Motion",
  "Root.md",
  document.querySelector('a[data-zob-note-link="Physics/Motion"]'),
);
await waitFor(() => owner.dataset.relationsState === "ready");
assert.equal(
  cards().length,
  2,
  "a second navigation path must reuse the same canonical card",
);
assert.equal(
  reads,
  2,
  "adding a relationship must not reread or reopen the target",
);
assert.ok(
  edgeTitles().some((title) => title.includes("Root.md → Physics/Motion.md")),
  "root Motion edge must appear without clicking its root link",
);
assert.ok(
  edgeTitles().some(
    (title) =>
      title.includes("Mathematics/Bayes.md → Physics/Motion.md") &&
      title.includes("Physics/Motion.md → Mathematics/Bayes.md"),
  ),
  "reciprocal relations share one visual connector",
);

// Link-anchor preferences survive preview DOM replacement by resolving the
// target and occurrence again, rather than retaining a detached HTMLElement.
markdown = `${rootMarkdown}\n\nUpdated preview snapshot`;
const preview = document.getElementById("preview");
const rerenderedBayesAlias = document.createElement("a");
rerenderedBayesAlias.setAttribute("data-zob-note-link", "bay");
rerenderedBayesAlias.textContent = "Bayes alias";
rerenderedBayesAlias.getBoundingClientRect = () => testRect(310, 410);
const rerenderedBayesCanonical = document.createElement("a");
rerenderedBayesCanonical.setAttribute(
  "data-zob-note-link",
  "Mathematics/Bayes",
);
rerenderedBayesCanonical.textContent = "Bayes canonical";
rerenderedBayesCanonical.getBoundingClientRect = () => testRect(420, 510);
const rerenderedMotion = document.createElement("a");
rerenderedMotion.setAttribute("data-zob-note-link", "Physics/Motion");
rerenderedMotion.textContent = "Motion";
rerenderedMotion.getBoundingClientRect = () => testRect(310, 610);
preview.replaceChildren(
  rerenderedBayesAlias,
  rerenderedBayesCanonical,
  rerenderedMotion,
);
group.refreshRelations();
await waitFor(() => owner.dataset.relationsState === "ready");
await waitFor(() =>
  rootBayesEdge()?.getAttribute("d")?.startsWith("M 440 520"),
);
assert.ok(
  rootBayesEdge().getAttribute("d").startsWith("M 440 520"),
  "the exact Bridge row must be rediscovered after its preview DOM is rerendered",
);

// Clicking a different alias updates the edge anchor to that exact row.
await group.open("bay", "Root.md", rerenderedBayesAlias);
await waitFor(() =>
  rootBayesEdge()?.getAttribute("d")?.startsWith("M 330 420"),
);
assert.ok(
  rootBayesEdge().getAttribute("d").startsWith("M 330 420"),
  "opening another alias for the same note must move the edge to the clicked row",
);

// Removing a draft link removes its semantic edge, not the already-open card.
markdown = "[[bay]]";
group.refreshRelations();
await waitFor(
  () => owner.dataset.relationsState === "ready" && edgeTitles().length === 2,
);
assert.ok(
  !edgeTitles().some((title) => title.includes("Root.md → Physics/Motion.md")),
);
assert.equal(cards().length, 2);
markdown = rootMarkdown;
group.refreshRelations();
await waitFor(
  () => owner.dataset.relationsState === "ready" && edgeTitles().length === 3,
);

// A newer draft wins even when older resolution requests finish late.
delayed = true;
markdown = "[[Motion]]";
group.refreshRelations();
await delay(140);
markdown = "[[Bayes]]";
group.refreshRelations();
await waitFor(() => owner.dataset.relationsState === "ready");
assert.ok(
  !edgeTitles().some((title) => title.includes("Root.md → Physics/Motion.md")),
);
assert.equal(cards().length, 2);

// A permission epoch change while discovering edges discards the result.
markdown = "[[bay]]\n[[Motion]]";
group.refreshRelations();
await delay(140);
scope = "epoch-2";
await waitFor(() => owner.dataset.relationsState === "unavailable");
assert.equal(edgeTitles().length, 0);
group.dispose();
await delay(200);
assert.equal(document.querySelectorAll(".zob-knowledge-layer").length, 0);
assert.equal(
  preferenceObservers.size,
  0,
  "disposing Reader cards unregisters their line-setting observer",
);

// Desktop-window cards listen only to their own line-visibility preference.
setPreference(
  "extensions.zotero.zoteroobsidianbridge.desktopKnowledgeCardLines",
  true,
);
const desktopOwner = document.createElement("main");
const desktopRootTitle = document.createElement("header");
desktopRootTitle.textContent = "Desktop root";
const desktopPreview = document.createElement("section");
const desktopBayesLink = document.createElement("a");
desktopBayesLink.setAttribute("data-zob-note-link", "Bayes");
desktopBayesLink.textContent = "Bayes";
desktopPreview.append(desktopBayesLink);
desktopOwner.append(desktopRootTitle, desktopPreview);
document.body.append(desktopOwner);
desktopRootTitle.getBoundingClientRect = () => testRect(20, 20);
desktopBayesLink.getBoundingClientRect = () => testRect(120, 80);
const desktopGroup = createKnowledgeNoteCard({
  owner: desktopOwner,
  createClient() {
    return {
      scope: async () => "desktop-epoch",
      async query(operation, input) {
        if (operation === "resolve-link")
          return {
            status: "ok",
            result: {
              path: "Bayes.md",
              revision: "desktop-r1",
              fragment: "",
              anchorState: "none",
            },
          };
        if (operation === "read-note")
          return {
            status: "ok",
            result: {
              path: input.path,
              markdown: "# Bayes",
              revision: "desktop-r1",
              readAt: Date.now(),
              metadata: { valid: true, headings: [], blocks: [] },
            },
          };
        throw new Error(`Unexpected desktop query: ${operation}`);
      },
      close() {},
      cancel() {},
    };
  },
  prepareSurface: async (_client, surfaceOptions) =>
    new KnowledgeCardGroupSurface(surfaceOptions),
  vaultPath: "/test-vault",
  launchURL() {},
  root: {
    sourcePath: "DesktopRoot.md",
    markdown: () => "[[Bayes]]",
    previews: [desktopPreview],
    anchor: desktopRootTitle,
  },
});
await desktopGroup.open("Bayes", "DesktopRoot.md", desktopBayesLink);
await waitFor(() => desktopOwner.dataset.relationsState === "ready");
const desktopEdgeTitles = () =>
  [...desktopOwner.querySelectorAll(".zob-knowledge-edge title")].map(
    (node) => node.textContent,
  );
await waitFor(() => desktopEdgeTitles().length === 1);
assert.equal(desktopEdgeTitles().length, 1);
setPreference(
  "extensions.zotero.zoteroobsidianbridge.inlineKnowledgeCardLines",
  false,
);
await delay(20);
assert.equal(
  desktopEdgeTitles().length,
  1,
  "changing the Reader-line setting does not hide desktop-card lines",
);
setPreference(
  "extensions.zotero.zoteroobsidianbridge.desktopKnowledgeCardLines",
  false,
);
await waitFor(() => desktopEdgeTitles().length === 0);
setPreference(
  "extensions.zotero.zoteroobsidianbridge.desktopKnowledgeCardLines",
  true,
);
await waitFor(() => desktopEdgeTitles().length === 1);
desktopGroup.dispose();
await delay(50);
assert.equal(preferenceObservers.size, 0);
if (previousZotero === undefined) delete globalThis.Zotero;
else globalThis.Zotero = previousZotero;

// Independent per-edge anchors must not move when another root link is added.
const surface = new KnowledgeCardGroupSurface({
  owner,
  collapseLabel: "Collapse",
  limitLabel: "Limit",
  onCollapse() {},
});
const rect = (left, top, width = 30, height = 20) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});
const header = document.getElementById("root-title");
header.getBoundingClientRect = () => rect(10, 10);
const bayAnchor = document.querySelector('a[data-zob-note-link="bay"]');
const motionAnchor = document.querySelector(
  'a[data-zob-note-link="Physics/Motion"]',
);
bayAnchor.getBoundingClientRect = () => rect(100, 200);
motionAnchor.getBoundingClientRect = () => rect(100, 400);
surface.setRootAnchor("Root.md", header);
const cardHeaders = new Map();
const cardPanels = new Map();
for (const [path, left] of [
  ["Bayes.md", 500],
  ["Motion.md", 900],
]) {
  const panel = document.createElement("section");
  const title = document.createElement("header");
  const resize = document.createElement("button");
  title.getBoundingClientRect = () => rect(left, 100, 100, 30);
  cardHeaders.set(path, title);
  cardPanels.set(path, panel);
  panel.append(title, resize);
  surface.addPanel(path, panel, title, resize, rect(left, 100));
  surface.bindPath(path, path);
}
const edge = (to) =>
  [...document.querySelectorAll(".zob-knowledge-edge")].find(
    (node) => node.textContent === `Root.md → ${to}`,
  );
const relationEdge = (from, to) =>
  [...document.querySelectorAll(".zob-knowledge-edge")].find((node) =>
    node.textContent.includes(`${from} → ${to}`),
  );
surface.setEdgeAnchors("Root.md", "Bayes.md", [bayAnchor]);
surface.setEdges([{ from: "Root.md", to: "Bayes.md" }]);
await waitFor(() => edge("Bayes.md"));
const bayPath = edge("Bayes.md").getAttribute("d");
surface.setEdgeAnchors("Root.md", "Motion.md", [motionAnchor]);
surface.setEdges([
  { from: "Root.md", to: "Bayes.md" },
  { from: "Root.md", to: "Motion.md" },
]);
await waitFor(() => edge("Motion.md"));
assert.equal(edge("Bayes.md").getAttribute("d"), bayPath);
assert.notEqual(edge("Motion.md").getAttribute("d"), bayPath);
bayAnchor.hidden = true;
surface.setEdges([
  { from: "Root.md", to: "Bayes.md" },
  { from: "Root.md", to: "Motion.md" },
]);
await waitFor(() => edge("Bayes.md").getAttribute("d") !== bayPath);
assert.ok(
  edge("Bayes.md").getAttribute("d").startsWith("M 25 20"),
  "hidden links must fall back to their own root header",
);
assert.ok(
  edge("Bayes.md").getAttribute("d").endsWith("500 115"),
  "a Bridge-to-card relation must terminate at the card's facing side",
);

const hiddenAnchorPath = edge("Bayes.md").getAttribute("d");
bayAnchor.hidden = false;
surface.setEdges([{ from: "Bayes.md", to: "Root.md" }]);
await waitFor(() => {
  const node = relationEdge("Bayes.md", "Root.md");
  return Boolean(node && node.getAttribute("d") !== hiddenAnchorPath);
});
assert.ok(
  relationEdge("Bayes.md", "Root.md").getAttribute("d").startsWith("M 115 210"),
  "reverse-discovered relations must still start at the matching Bridge wikilink",
);
assert.ok(
  relationEdge("Bayes.md", "Root.md").getAttribute("d").endsWith("500 115"),
  "reverse-discovered relations must still terminate at the popup card's facing side",
);
assert.ok(
  relationEdge("Bayes.md", "Root.md").getAttribute("marker-start") &&
    relationEdge("Bayes.md", "Root.md").getAttribute("marker-end"),
  "Bridge-to-card relations must keep arrows visible at both endpoints",
);

bayAnchor.style.visibility = "hidden";
surface.setEdges([{ from: "Root.md", to: "Bayes.md" }]);
await waitFor(() => edge("Bayes.md")?.getAttribute("d")?.startsWith("M 25 20"));
assert.ok(
  edge("Bayes.md").getAttribute("d").startsWith("M 25 20"),
  "a genuinely visibility-hidden link must still fall back to the root header",
);
bayAnchor.style.visibility = "visible";
preview.style.display = "none";
surface.setEdges([{ from: "Root.md", to: "Bayes.md" }]);
await delay(30);
assert.ok(
  edge("Bayes.md").getAttribute("d").startsWith("M 25 20"),
  "display:none on an ancestor cannot be overridden by a visible descendant",
);
preview.style.display = "";
surface.setEdges([{ from: "Root.md", to: "Bayes.md" }]);
await waitFor(() =>
  edge("Bayes.md")?.getAttribute("d")?.startsWith("M 115 210"),
);

motionAnchor.getBoundingClientRect = () => rect(1200, 400);
surface.setEdgeAnchors("Root.md", "Motion.md", [motionAnchor]);
surface.setEdges([{ from: "Root.md", to: "Motion.md" }]);
await waitFor(() => edge("Motion.md")?.getAttribute("d")?.endsWith("1000 115"));
assert.ok(
  edge("Motion.md").getAttribute("d").startsWith("M 1215 410"),
  "a Bridge link to the right of a popup must retain its own exact source position",
);

surface.setEdges([
  { from: "Bayes.md", to: "Motion.md" },
  { from: "Motion.md", to: "Bayes.md" },
]);
const popupToPopupEdge = () =>
  [...document.querySelectorAll(".zob-knowledge-edge")].find((node) =>
    node.textContent.includes("Bayes.md → Motion.md"),
  );
await waitFor(() => popupToPopupEdge()?.getAttribute("d"));
assert.equal(
  popupToPopupEdge().getAttribute("d"),
  "M 600 115 C 696 115, 804 115, 900 115",
  "links between popup cards must connect to facing left/right side edges",
);
assert.ok(
  popupToPopupEdge().getAttribute("marker-start")?.endsWith("-start)") &&
    popupToPopupEdge().getAttribute("marker-end")?.endsWith("-end)"),
  "linked popup cards must show arrowheads at both ends",
);
const bayesHeader = cardHeaders.get("Bayes.md");
const motionHeader = cardHeaders.get("Motion.md");
cardPanels.get("Bayes.md").getBoundingClientRect = () =>
  rect(500, 100, 400, 200);
cardPanels.get("Motion.md").getBoundingClientRect = () =>
  rect(700, 400, 400, 200);
bayesHeader.getBoundingClientRect = () => rect(500, 100, 400, 30);
motionHeader.getBoundingClientRect = () => rect(700, 400, 400, 30);
surface.setEdges([{ from: "Bayes.md", to: "Motion.md" }]);
await waitFor(() => popupToPopupEdge()?.getAttribute("d")?.includes("1148"));
assert.equal(
  popupToPopupEdge().getAttribute("d"),
  "M 900 115 C 1148 115, 1148 415, 1100 415",
  "vertically separated, horizontally overlapping cards must route around their outside sides",
);
cardPanels.get("Bayes.md").getBoundingClientRect = () => rect(0, 0, 0, 0);
cardPanels.get("Motion.md").getBoundingClientRect = () => rect(0, 0, 0, 0);
bayesHeader.getBoundingClientRect = () => rect(900, 100, 100, 30);
motionHeader.getBoundingClientRect = () => rect(500, 100, 100, 30);
const rightToLeftPath = popupToPopupEdge().getAttribute("d");
surface.setEdges([{ from: "Bayes.md", to: "Motion.md" }]);
await waitFor(() => popupToPopupEdge().getAttribute("d") !== rightToLeftPath);
assert.equal(
  popupToPopupEdge().getAttribute("d"),
  "M 900 115 C 804 115, 696 115, 600 115",
  "popup-to-popup edges must choose facing side edges in either layout direction",
);
bayesHeader.getBoundingClientRect = () => rect(900, 100, 100, 30);
motionHeader.getBoundingClientRect = () => rect(910, 100, 100, 30);
const alignedPath = popupToPopupEdge().getAttribute("d");
surface.setEdges([{ from: "Bayes.md", to: "Motion.md" }]);
await waitFor(() => popupToPopupEdge().getAttribute("d") !== alignedPath);
assert.equal(
  popupToPopupEdge().getAttribute("d"),
  "M 1000 115 C 964 115, 946 115, 910 115",
  "near-aligned popup cards must use deterministic opposite side edges",
);
surface.dispose();
console.log(
  "C5-A/B checks passed: per-edge anchors, automatic visible graph, aliases, reciprocal dedupe, draft changes, no implicit opens/writes, bounded queries, cancellation and scope invalidation.",
);
