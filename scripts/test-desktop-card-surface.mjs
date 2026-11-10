import assert from "node:assert/strict";
import { Blob, Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { exit, stdout } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { build } from "esbuild";
import { getDesktopWindowRegistration } from "../src/services/desktop-window-registry.ts";
import {
  initializeDesktopKnowledgeCardWindow,
  desktopKnowledgeCardWindowURL,
  prepareDesktopKnowledgeCardWindowChrome,
} from "../src/services/desktop-knowledge-card-window.ts";
import { setMarkdownPreviewResources } from "../src/core/markdown-preview-resources.ts";

const desktopWindowCss = await readFile(
  "addon/content/desktop-knowledge-card.css",
  "utf8",
);
const desktopWindowMarkup = await readFile(
  "addon/content/desktop-knowledge-card.xhtml",
  "utf8",
);
const macDesktopWindowMarkup = await readFile(
  "addon/content/desktop-knowledge-card-macos.xhtml",
  "utf8",
);
const editorEntry = await readFile("src/editor.ts", "utf8");
const desktopSurfaceImplementation = await readFile(
  "src/services/desktop-knowledge-card-surface.ts",
  "utf8",
);
assert.match(
  desktopWindowCss,
  /@namespace\s+html\s+url\("http:\/\/www\.w3\.org\/1999\/xhtml"\)/,
  "desktop XHTML layout selectors must target the XHTML namespace",
);
assert.match(
  desktopWindowCss,
  /html\|html,\s*html\|body\s*\{[^}]*height:\s*100%/s,
  "the desktop card document and body must establish a full-height containing block",
);
assert.match(
  desktopWindowMarkup,
  /id="desktop-card-window"[^>]*data-ready="false"[^>]*data-mounted="false"/,
  "the child window must start unready and unmounted",
);
assert.match(
  desktopWindowMarkup,
  /<\?xml-stylesheet\s+href="chrome:\/\/zoteroobsidianbridge\/content\/katex\.min\.css"\s+type="text\/css"\s*\?>/s,
  "desktop card windows must load KaTeX layout styles before rendering math",
);
assert.match(
  desktopWindowMarkup,
  /<window\s+xmlns="http:\/\/www\.mozilla\.org\/keymaster\/gatekeeper\/there\.is\.only\.xul"[^>]*id="zob-desktop-knowledge-card"/s,
  "desktop cards must be native XUL windows",
);
assert.match(
  macDesktopWindowMarkup,
  /<window\s+xmlns="http:\/\/www\.mozilla\.org\/keymaster\/gatekeeper\/there\.is\.only\.xul"[^>]*chromemargin="0,-1,-1,-1"[^>]*tabsintitlebar="true"/s,
  "macOS titlebar attributes must exist in the XUL document before window creation",
);
assert.doesNotMatch(
  macDesktopWindowMarkup,
  /data-native-titlebar-overlay/,
  "the macOS surface must not add a synthetic titlebar spacer",
);
assert.equal(
  desktopKnowledgeCardWindowURL("bridge", "MacIntel"),
  "chrome://bridge/content/desktop-knowledge-card-macos.xhtml",
);
assert.equal(
  desktopKnowledgeCardWindowURL("bridge", "Win32"),
  "chrome://bridge/content/desktop-knowledge-card.xhtml",
);
assert.ok(
  editorEntry.indexOf("prepareDesktopKnowledgeCardWindowChrome(editorWindow)") <
    editorEntry.indexOf('editorWindow.addEventListener(\n  "load"'),
  "macOS titlebar attributes must be set before the window load event",
);
assert.doesNotMatch(
  desktopWindowMarkup,
  /(?:active|inactive)titlebarcolor=/,
  "removed Gecko titlebar color attributes must not be relied on",
);
assert.doesNotMatch(
  desktopWindowCss,
  /inset-block-start:\s*28px/,
  "desktop cards must not reserve a blank band below the native titlebar",
);
assert.doesNotMatch(
  desktopSurfaceImplementation,
  /onFocusWithinGroup/,
  "desktop relation lines must not disappear when focus leaves the card group",
);
assert.match(
  desktopWindowCss,
  /#desktop-card-window\[data-mounted="true"\]\s+#window-state\s*\{\s*display:\s*none/s,
  "the diagnostic state must remain visible until card content is mounted",
);

const bundle = await build({
  entryPoints: ["src/services/desktop-knowledge-card-surface.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  write: false,
});
let desktopSurfaceModule;
try {
  desktopSurfaceModule = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
  );
} catch (error) {
  stdout.write(`${error?.name}: ${error?.message}\n`);
  exit(1);
}
const { DesktopKnowledgeCardSurface } = desktopSurfaceModule;

function makeChildWindow() {
  const { window } = parseHTML(
    '<html><head></head><body><main id="desktop-card-window" data-ready="true" data-mounted="false"><div id="card-host"></div><div id="window-state">Window ready; waiting for card content...</div></main></body></html>',
  );
  window.closed = false;
  window.focus = () => {};
  window.createdImageURLs = [];
  window.revokedImageURLs = [];
  Object.defineProperty(window, "URL", {
    configurable: true,
    value: {
      createObjectURL(blob) {
        assert.ok(blob instanceof Blob);
        const url = `blob:desktop-${window.createdImageURLs.length + 1}`;
        window.createdImageURLs.push(url);
        return url;
      },
      revokeObjectURL(url) {
        window.revokedImageURLs.push(url);
      },
    },
  });
  window.close = () => {
    window.closed = true;
    window.dispatchEvent(new window.Event("unload"));
  };
  const doc = window.document;
  doc.adoptNode = (node) => {
    const updateOwnerDocument = (current) => {
      current.ownerDocument = doc;
      for (const child of current.childNodes) updateOwnerDocument(child);
    };
    node.remove();
    updateOwnerDocument(node);
    return node;
  };
  return window;
}

const { window: rootWindow } = parseHTML(
  '<html lang="en"><head></head><body><main id="owner"></main></body></html>',
);
const previousZotero = globalThis.Zotero;
globalThis.Zotero = {
  getMainWindow: () => rootWindow,
  Prefs: { get: (_name, fallback) => fallback },
};

const pendingWindows = [];
const openedWindows = [];
rootWindow.openDialog = (...args) => {
  const result = pendingWindows.shift();
  if (result instanceof Error) throw result;
  if (result && !result.location) result.location = { href: args[0] };
  openedWindows.push({ args, window: result });
  return result;
};

let surface;
const closedKeys = [];
const linkedTargets = [];
let commandCount = 0;
const owner = rootWindow.document.getElementById("owner");
surface = new DesktopKnowledgeCardSurface(
  {
    owner,
    controlHost: owner,
    collapseLabel: "Collapse",
    limitLabel: "Limit reached",
    onCollapse() {},
    onWindowClosed: (key) => {
      closedKeys.push(key);
      surface.removePanel(key);
    },
    onCardLink: (...args) => linkedTargets.push(args),
  },
  { vaultId: "vault-c", pairingEpoch: "epoch-1" },
);

const panel = rootWindow.document.createElement("section");
panel.className = "zob-knowledge-card";
panel.dataset.cardId = "card-one";
const header = rootWindow.document.createElement("header");
header.className = "zob-knowledge-header";
const statusDetails = rootWindow.document.createElement("div");
statusDetails.className = "zob-knowledge-status-details";
const statusToggle = rootWindow.document.createElement("button");
statusToggle.dataset.zobCardAction = "toggle-status";
statusToggle.setAttribute("aria-expanded", "true");
statusToggle.addEventListener("click", () => {
  statusDetails.hidden = !statusDetails.hidden;
  statusToggle.setAttribute("aria-expanded", String(!statusDetails.hidden));
});
header.append(statusToggle);
const body = rootWindow.document.createElement("div");
body.className = "zob-knowledge-body";
const command = rootWindow.document.createElement("button");
command.dataset.zobCardAction = "refresh";
command.addEventListener("click", () => commandCount++);
const link = rootWindow.document.createElement("a");
link.href = "obsidian://open?path=Physics/Motion";
link.dataset.zobNoteLink = "Physics/Motion";
link.textContent = "Motion";
body.append(command, link);
const image = rootWindow.document.createElement("img");
image.setAttribute("src", "blob:owner-image-1");
image.setAttribute("alt", "Synthetic image resource");
body.append(image);
setMarkdownPreviewResources(
  body,
  new Map([
    [
      "blob:owner-image-1",
      new Blob(["synthetic-image-bytes"], { type: "image/png" }),
    ],
  ]),
);
panel.append(header, statusDetails, body);
const resizeHandle = rootWindow.document.createElement("button");
resizeHandle.className = "zob-knowledge-resize";
panel.append(resizeHandle);
pendingWindows.push(makeChildWindow());
assert.equal(
  surface.addPanel("card-one", panel, header, resizeHandle, {
    left: 100,
    right: 120,
    top: 100,
    bottom: 120,
  }),
  true,
);
assert.equal(surface.bindPath("Mathematics/Bayes.md", "card-one"), true);
await surface.whenMounted("card-one");
await delay(20);
assert.ok(surface.performanceSnapshot.frames > 0);
assert.ok(surface.performanceSnapshot.scheduledRequests > 0);
assert.ok(
  surface.performanceSnapshot.coalescedRequests <=
    surface.performanceSnapshot.scheduledRequests,
);
assert.equal(
  surface.performanceSnapshot.maxCards,
  1,
  "geometry metrics expose workload counts without note content",
);
const firstWindow = openedWindows[0].window;
const firstMirror = firstWindow.document
  .getElementById("card-host")
  .querySelector(".zob-knowledge-card");
assert.notEqual(firstMirror, panel);
assert.equal(panel.ownerDocument, rootWindow.document);
assert.equal(firstMirror.ownerDocument, firstWindow.document);
assert.equal(
  firstWindow.document.getElementById("card-host").contains(firstMirror),
  true,
);
assert.equal(
  firstWindow.document
    .getElementById("desktop-card-window")
    .getAttribute("data-mounted"),
  "true",
  "the native window must acknowledge mounting its card DOM before hiding diagnostics",
);
assert.equal(firstMirror.querySelector(".zob-knowledge-resize").hidden, true);
assert.equal(firstMirror.getAttribute("contenteditable"), "false");
const mirrorStatusDetails = firstMirror.querySelector(
  ".zob-knowledge-status-details",
);
assert.equal(mirrorStatusDetails.hidden, false);
firstMirror
  .querySelector('[data-zob-card-action="toggle-status"]')
  .dispatchEvent(
    new firstWindow.Event("click", { bubbles: true, cancelable: true }),
  );
await delay(0);
assert.equal(statusDetails.hidden, true);
assert.equal(mirrorStatusDetails.hidden, true);
firstMirror
  .querySelector('[data-zob-card-action="toggle-status"]')
  .dispatchEvent(
    new firstWindow.Event("click", { bubbles: true, cancelable: true }),
  );
await delay(0);
assert.equal(statusDetails.hidden, false);
assert.equal(mirrorStatusDetails.hidden, false);
assert.equal(
  firstMirror.querySelector("img").getAttribute("src"),
  "blob:desktop-1",
);
assert.equal(firstWindow.createdImageURLs.length, 1);
assert.equal(
  owner.querySelector(
    '[aria-label="Arrange or recover linked knowledge-card windows"]',
  ),
  null,
  "the root card does not expose a window-arrangement control",
);
setMarkdownPreviewResources(
  body,
  new Map([
    [
      "blob:owner-image-2",
      new Blob(["replacement-image-bytes"], { type: "image/png" }),
    ],
  ]),
);
image.setAttribute("src", "blob:owner-image-2");
await delay(0);
assert.equal(
  firstMirror.querySelector("img").getAttribute("src"),
  "blob:desktop-2",
);
assert.deepEqual(firstWindow.revokedImageURLs, ["blob:desktop-1"]);
assert.equal(
  firstMirror.querySelector(".zob-knowledge-header").style.cursor,
  "default",
);
firstMirror
  .querySelector('[data-zob-card-action="refresh"]')
  .dispatchEvent(
    new firstWindow.Event("click", { bubbles: true, cancelable: true }),
  );
assert.equal(commandCount, 1);
firstMirror
  .querySelector("a[data-zob-note-link]")
  .dispatchEvent(
    new firstWindow.Event("click", { bubbles: true, cancelable: true }),
  );
assert.deepEqual(linkedTargets, [
  ["card-one", "Physics/Motion", "Mathematics/Bayes.md", 0],
]);
const update = rootWindow.document.createElement("span");
update.textContent = "Loaded note contents";
body.append(update);
await delay(0);
assert.match(firstMirror.textContent, /Loaded note contents/);
const registration = getDesktopWindowRegistration(rootWindow);
assert.equal(
  registration.registry.countOwner(
    registration.profileInstanceId,
    registration.ownerWindowId,
  ),
  1,
);

firstWindow.close();
assert.deepEqual(closedKeys, ["card-one"]);
assert.deepEqual(
  firstWindow.revokedImageURLs,
  ["blob:desktop-1", "blob:desktop-2"],
  "replacement and close revoke child-window-owned image URLs",
);
assert.equal(surface.cardCount, 0);
assert.equal(
  registration.registry.countOwner(
    registration.profileInstanceId,
    registration.ownerWindowId,
  ),
  0,
  "native window close releases the lease and removes the card from its root graph",
);

const secondPanel = rootWindow.document.createElement("section");
const secondHeader = rootWindow.document.createElement("header");
const secondResizeHandle = rootWindow.document.createElement("button");
secondPanel.append(secondHeader, secondResizeHandle);
pendingWindows.push(makeChildWindow());
assert.equal(
  surface.addPanel("card-two", secondPanel, secondHeader, secondResizeHandle, {
    left: 100,
    right: 120,
    top: 100,
    bottom: 120,
  }),
  true,
);
assert.equal(surface.bindPath("Physics/Motion.md", "card-two"), true);
await surface.whenMounted("card-two");
const secondWindow = openedWindows[1].window;
const closeShortcut = new secondWindow.Event("keydown", {
  bubbles: true,
  cancelable: true,
});
Object.defineProperties(closeShortcut, {
  key: { value: "w" },
  metaKey: { value: true },
  ctrlKey: { value: false },
  altKey: { value: false },
  shiftKey: { value: false },
});
secondWindow.dispatchEvent(closeShortcut);
assert.equal(closeShortcut.defaultPrevented, true);
assert.equal(secondWindow.closed, true);
assert.deepEqual(closedKeys, ["card-one", "card-two"]);
assert.equal(surface.cardCount, 0);

const delayedWindow = makeChildWindow();
delayedWindow.location = { href: "about:blank" };
delayedWindow.arguments = [{ path: "Physics/Delayed.md" }];
delayedWindow.document
  .getElementById("desktop-card-window")
  .setAttribute("data-ready", "false");
const addFinalListener = delayedWindow.addEventListener.bind(delayedWindow);
delayedWindow.addEventListener = (...args) => {
  if (delayedWindow.location.href !== "about:blank") addFinalListener(...args);
};
const delayedPanel = panel.cloneNode(true);
pendingWindows.push(delayedWindow);
assert.equal(
  surface.addPanel(
    "card-delayed",
    delayedPanel,
    delayedPanel.querySelector("header"),
    delayedPanel.querySelector(".zob-knowledge-resize"),
    { left: 100, right: 120, top: 100, bottom: 120 },
  ),
  true,
);
assert.equal(surface.bindPath("Physics/Delayed.md", "card-delayed"), true);
delayedWindow.location.href = openedWindows.at(-1).args[0];
initializeDesktopKnowledgeCardWindow(delayedWindow, "MacIntel");
assert.equal(
  delayedWindow.document.documentElement.getAttribute("chromemargin"),
  "0,-1,-1,-1",
  "macOS desktop card windows draw the existing content background into the titlebar",
);
assert.equal(
  delayedWindow.document.documentElement.getAttribute("tabsintitlebar"),
  "true",
  "macOS native controls must use Gecko's titlebar drawing mode",
);
assert.equal(
  delayedWindow.document
    .getElementById("desktop-card-window")
    .hasAttribute("data-native-titlebar-overlay"),
  false,
);
await surface.whenMounted("card-delayed");
assert.equal(delayedPanel.dataset.desktopWindowFallback, undefined);
assert.equal(
  delayedWindow.document
    .getElementById("desktop-card-window")
    .getAttribute("data-mounted"),
  "true",
  "the production surface mounts even when the ready event was lost during navigation",
);
assert.match(
  delayedWindow.document.getElementById("card-host").textContent,
  /Loaded note contents/,
);
delayedWindow.close();
assert.deepEqual(closedKeys, ["card-one", "card-two", "card-delayed"]);
assert.equal(surface.cardCount, 0);

const windowsWindow = makeChildWindow();
windowsWindow.arguments = [{ path: "Physics/Windows.md" }];
assert.equal(
  prepareDesktopKnowledgeCardWindowChrome(windowsWindow, "Win32"),
  false,
);
initializeDesktopKnowledgeCardWindow(windowsWindow, "Win32");
assert.equal(
  windowsWindow.document.documentElement.hasAttribute("chromemargin"),
  false,
  "macOS titlebar drawing must not affect Windows windows",
);
assert.equal(
  windowsWindow.document
    .getElementById("desktop-card-window")
    .hasAttribute("data-native-titlebar-overlay"),
  false,
);

const fallbackPanel = rootWindow.document.createElement("section");
const fallbackHeader = rootWindow.document.createElement("header");
const fallbackResizeHandle = rootWindow.document.createElement("button");
fallbackPanel.append(fallbackHeader, fallbackResizeHandle);
pendingWindows.push(new Error("simulated native window failure"));
assert.equal(
  surface.addPanel(
    "card-fallback",
    fallbackPanel,
    fallbackHeader,
    fallbackResizeHandle,
    { left: 100, right: 120, top: 100, bottom: 120 },
  ),
  true,
);
assert.equal(surface.bindPath("Cycles/A.md", "card-fallback"), true);
await surface.whenMounted("card-fallback");
assert.equal(fallbackPanel.isConnected, true);
assert.equal(fallbackPanel.ownerDocument, rootWindow.document);
assert.equal(fallbackPanel.dataset.desktopWindowFallback, "true");
surface.removePanel("card-fallback");
assert.equal(surface.cardCount, 0);
assert.equal(
  registration.registry.countOwner(
    registration.profileInstanceId,
    registration.ownerWindowId,
  ),
  0,
  "inline fallback removal releases the same shared registration",
);

surface.dispose();
if (previousZotero === undefined) delete globalThis.Zotero;
else globalThis.Zotero = previousZotero;
stdout.write(
  "Production desktop card surface checks passed: isolated DOM mirror, dynamic content sync, delegated actions/links, shared lease, Cmd+W cleanup and inline failure fallback.",
);
