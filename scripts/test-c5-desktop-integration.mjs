import assert from "node:assert/strict";
import { stdout } from "node:process";
import { parseHTML } from "linkedom";
import { desktopDisplaysForCurves } from "../src/adapters/desktop-displays.ts";
import { desktopRectForElement } from "../src/core/desktop-card-anchor.ts";
import { routeDesktopEdge } from "../src/core/desktop-edge-routing.ts";
import { projectDesktopEdges } from "../src/core/desktop-edge-projection.ts";

const previousCc = globalThis.Cc;
const previousCi = globalThis.Ci;
const screenForRect = (x, y) => {
  const { contentsScaleFactor, deviceRect } =
    x < 0
      ? {
          contentsScaleFactor: 1.5,
          deviceRect: { left: -2205, top: 120, width: 2205, height: 1434 },
        }
      : y >= 1152
        ? {
            contentsScaleFactor: 1,
            deviceRect: { left: 0, top: 1152, width: 1920, height: 1080 },
          }
        : {
            contentsScaleFactor: 2,
            deviceRect: { left: 0, top: 0, width: 4096, height: 2304 },
          };
  const screen = {
    contentsScaleFactor,
    GetRect(left, top, width, height) {
      Object.assign(left, { value: deviceRect.left });
      Object.assign(top, { value: deviceRect.top });
      Object.assign(width, { value: deviceRect.width });
      Object.assign(height, { value: deviceRect.height });
    },
    GetRectDisplayPix(left, top, width, height) {
      for (const [out, key] of [
        [left, "left"],
        [top, "top"],
        [width, "width"],
        [height, "height"],
      ]) {
        out.value = Math.round(deviceRect[key] / contentsScaleFactor);
      }
    },
  };
  screen.GetRect = () => {
    throw new Error("per-screen device-pixel rect must not be used");
  };
  return screen;
};
globalThis.Cc = {
  "@mozilla.org/gfx/screenmanager;1": {
    getService() {
      return {
        screenForRect(x, y) {
          return screenForRect(x, y);
        },
      };
    },
  },
};
globalThis.Ci = { nsIScreenManager: Symbol("nsIScreenManager") };

const crossDisplayCurve = {
  id: "cross-display",
  from: { x: -600, y: 300 },
  control1: { x: -300, y: 300 },
  control2: { x: 300, y: 300 },
  to: { x: 600, y: 300 },
};
const verticalDisplayCurve = {
  id: "vertical-display-origin",
  from: { x: 100, y: 800 },
  control1: { x: 100, y: 1000 },
  control2: { x: 100, y: 1200 },
  to: { x: 100, y: 1400 },
};
const displays = desktopDisplaysForCurves(
  [crossDisplayCurve, verticalDisplayCurve],
  64,
);
assert.deepEqual(
  displays.map((display) => display.id),
  [
    "screen:0,0,2048,1152",
    "screen:-1470,80,1470,956",
    "screen:0,1152,1920,1080",
  ],
);
assert.equal(
  displays[1].rect.left,
  -1470,
  "negative display origins are retained",
);
assert.deepEqual(
  displays.map(({ rect }) => rect.width),
  [2048, 1470, 1920],
  "per-display device-pixel rectangles are normalized with each display scale",
);
assert.equal(
  displays[2].rect.top,
  1152,
  "a display below the primary keeps its distinct logical desktop origin",
);
const appKitFrames = [
  { left: 0, bottom: 0, width: 2048, height: 1152 },
  { left: -1470, bottom: 116, width: 1470, height: 956 },
  { left: 0, bottom: -1080, width: 1920, height: 1080 },
];
const mainScreenTop = 1152;
assert.deepEqual(
  displays.map(({ rect }) => rect),
  appKitFrames.map(({ left, bottom, width, height }) => ({
    left,
    top: mainScreenTop - (bottom + height),
    width,
    height,
  })),
  "per-display Gecko logical rects align with NSScreen.frame after origin conversion",
);

const { window } = parseHTML(
  "<html><body><div id='clip'><a>Bayes</a></div></body></html>",
);
Object.defineProperties(window, {
  innerWidth: { value: 1000 },
  innerHeight: { value: 700 },
  mozInnerScreenX: { value: -1200 },
  mozInnerScreenY: { value: 40 },
});
window.getComputedStyle = (element) => ({
  display: element.dataset.display ?? "block",
  visibility: element.dataset.visibility ?? "visible",
  opacity: element.dataset.opacity ?? "1",
  overflowX: element.dataset.overflowX ?? "visible",
  overflowY: element.dataset.overflowY ?? "visible",
});
const clip = window.document.getElementById("clip");
clip.dataset.overflowX = "hidden";
const nativePopup = window.document.createElement("div");
nativePopup.dataset.visibility = "hidden";
const visiblePopupCard = window.document.createElement("section");
visiblePopupCard.dataset.visibility = "visible";
const visiblePopupAnchor = window.document.createElement("a");
visiblePopupCard.append(visiblePopupAnchor);
nativePopup.append(visiblePopupCard);
window.document.body.append(nativePopup);
visiblePopupAnchor.getClientRects = () => [
  { left: 0, top: 0, width: 40, height: 12 },
];
visiblePopupAnchor.getBoundingClientRect = () => ({
  left: 20,
  top: 20,
  right: 60,
  bottom: 32,
  width: 40,
  height: 12,
});
assert.deepEqual(
  desktopRectForElement(visiblePopupAnchor),
  { left: -1180, top: 60, width: 40, height: 12 },
  "visible descendants of native popup hosts remain eligible geometry anchors",
);
Object.defineProperty(window.document, "hidden", {
  configurable: true,
  value: true,
});
assert.deepEqual(
  desktopRectForElement(visiblePopupAnchor),
  { left: -1180, top: 60, width: 40, height: 12 },
  "window deactivation must not discard an otherwise visible desktop anchor",
);
Object.defineProperty(window.document, "hidden", {
  configurable: true,
  value: false,
});
visiblePopupAnchor.dataset.visibility = "hidden";
assert.equal(
  desktopRectForElement(visiblePopupAnchor),
  undefined,
  "an anchor whose own computed visibility is hidden is rejected",
);
delete visiblePopupAnchor.dataset.visibility;
const anchor = clip.querySelector("a");
anchor.getClientRects = () => [{ left: 0, top: 0, width: 60, height: 20 }];
anchor.getBoundingClientRect = () => ({
  left: 120,
  top: 80,
  right: 180,
  bottom: 100,
  width: 60,
  height: 20,
});
clip.getBoundingClientRect = () => ({
  left: 100,
  top: 50,
  right: 150,
  bottom: 120,
  width: 50,
  height: 70,
});
const clipped = desktopRectForElement(anchor);
assert.deepEqual(clipped, {
  left: -1080,
  top: 120,
  width: 30,
  height: 20,
});
clip.dataset.display = "none";
assert.equal(
  desktopRectForElement(anchor),
  undefined,
  "hidden anchors fail closed",
);
delete clip.dataset.display;
anchor.getClientRects = () => [];
assert.equal(
  desktopRectForElement(anchor),
  undefined,
  "non-rendered anchors are rejected",
);

const root = "Paper/P02N01.md";
const bayes = "Mathematics/Bayes.md";
const motion = "Physics/Motion.md";
const edges = [
  { from: root, to: bayes },
  { from: root, to: motion },
  { from: bayes, to: motion },
  { from: motion, to: bayes },
];
const rootLinks = new Map([
  [
    `${root}\0${bayes}`,
    [
      {
        occurrence: 0,
        rect: { left: 10, top: 10, width: 60, height: 20 },
        visible: true,
        contentGeneration: 5,
      },
    ],
  ],
  [
    `${root}\0${motion}`,
    [
      {
        occurrence: 0,
        rect: { left: 12, top: 60, width: 70, height: 20 },
        visible: true,
        contentGeneration: 5,
      },
    ],
  ],
]);
const projected = projectDesktopEdges({
  edges,
  rootPaths: new Set([root]),
  roots: new Map([
    [
      root,
      {
        visible: true,
        titleVisible: true,
        titleRect: { left: 0, top: 0, width: 200, height: 28 },
        contentGeneration: 5,
      },
    ],
  ]),
  rootLinks,
  cards: new Map([
    [
      bayes,
      {
        visible: true,
        headerRect: { left: 300, top: 100, width: 300, height: 48 },
        contentGeneration: 2,
        windowGeneration: 7,
      },
    ],
    [
      motion,
      {
        visible: true,
        headerRect: { left: 600, top: 300, width: 300, height: 48 },
        contentGeneration: 3,
        windowGeneration: 9,
      },
    ],
  ]),
  relationGeneration: 11,
});
assert.equal(projected.length, 3, "reciprocal links become one edge");
const rootBayes = projected.find(
  (edge) => edge.fromPath === root && edge.toPath === bayes,
);
const rootMotion = projected.find(
  (edge) => edge.fromPath === root && edge.toPath === motion,
);
assert.deepEqual(rootBayes.from.point, { x: 40, y: 20 });
assert.deepEqual(rootMotion.from.point, { x: 47, y: 70 });
assert.equal(rootBayes.from.occurrence, 0);
assert.equal(rootMotion.from.occurrence, 0);
const routed = routeDesktopEdge(rootBayes);
assert.ok(
  routed.control1.x > routed.from.x,
  "knowledge cards retain side-exit routing",
);

if (previousCc === undefined) delete globalThis.Cc;
else globalThis.Cc = previousCc;
if (previousCi === undefined) delete globalThis.Ci;
else globalThis.Ci = previousCi;

stdout.write(
  "Desktop integration checks passed: sampled multi-display curves, negative coordinates, clipped/hidden anchors, independent root link rows, reciprocal relation de-duplication, and side routing.\n",
);
