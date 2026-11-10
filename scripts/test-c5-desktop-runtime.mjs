import assert from "node:assert/strict";
import { stdout } from "node:process";
import { parseHTML } from "linkedom";
import { getDesktopEdgeOverlayRuntime } from "../src/services/desktop-edge-overlay-runtime.ts";

const previousZotero = globalThis.Zotero;
const previousCc = globalThis.Cc;
const previousCi = globalThis.Ci;
let screenQueries = 0;
let allowScreenQueries = false;
const { window: owner } = parseHTML(
  "<html><body><div id='mainPopupSet'></div></body></html>",
);
let runtimeOwner = owner;
globalThis.Zotero = { getMainWindow: () => runtimeOwner };
globalThis.Cc = {
  "@mozilla.org/gfx/screenmanager;1": {
    getService() {
      return {
        screenForRect() {
          screenQueries++;
          if (allowScreenQueries) {
            return {
              GetRectDisplayPix(left, top, width, height) {
                left.value = 0;
                top.value = 0;
                width.value = 2048;
                height.value = 1152;
              },
            };
          }
          throw new Error("screen sampling must not run behind a closed gate");
        },
      };
    },
  },
};
globalThis.Ci = { nsIScreenManager: Symbol("nsIScreenManager") };

const runtime = getDesktopEdgeOverlayRuntime();
const refreshed = [];
const removeFailingGroup = runtime.register("group-failing-refresh", () => {
  refreshed.push("first");
  throw new Error("stale group refresh");
});
const removeHealthyGroup = runtime.register("group-healthy-refresh", () => {
  refreshed.push("second");
});
Object.defineProperty(owner.document, "hidden", {
  configurable: true,
  value: true,
});
owner.document.dispatchEvent(new owner.Event("visibilitychange"));
Object.defineProperty(owner.document, "hidden", {
  configurable: true,
  value: false,
});
owner.document.dispatchEvent(new owner.Event("visibilitychange"));
assert.deepEqual(
  refreshed,
  ["first", "second"],
  "one stale group cannot prevent visible groups from refreshing",
);
removeFailingGroup();
removeHealthyGroup();
const curve = {
  id: "root-bayes",
  from: { x: -100, y: 100 },
  control1: { x: -50, y: 120 },
  control2: { x: 50, y: 160 },
  to: { x: 100, y: 180 },
};
runtime.setGroup("group-1", [curve]);
assert.equal(
  screenQueries,
  0,
  "unverified desktop overlays do no per-frame screen queries",
);
assert.equal(owner.document.querySelector("[data-xul-name='panel']"), null);
runtime.removeGroup("group-1");
await runtime.dispose();

const { window: hiddenOwner } = parseHTML(
  "<html><body><div id='mainPopupSet'></div></body></html>",
);
Object.defineProperty(hiddenOwner.document, "hidden", {
  configurable: true,
  value: true,
});
runtimeOwner = hiddenOwner;
allowScreenQueries = true;
let activeSurfaces = 0;
let shownSurfaces = 0;
let drawCalls = 0;
const fakeHost = {
  capabilities: {
    verified: true,
    transparent: true,
    nonActivating: true,
    controlledZOrder: true,
    systemMousePassthrough: true,
    tracksNativeDrag: true,
  },
  setFailureHandler() {},
  async prepare() {},
  open() {
    return {
      draw() {
        drawCalls++;
      },
      show() {
        activeSurfaces++;
        shownSurfaces++;
      },
      hide() {
        activeSurfaces = 0;
      },
      close() {
        activeSurfaces = 0;
      },
    };
  },
  async stop() {
    activeSurfaces = 0;
  },
  async dispose() {
    activeSurfaces = 0;
  },
};
const visibleRuntime = getDesktopEdgeOverlayRuntime(() => fakeHost);
visibleRuntime.register("desktop-group", () => {});
visibleRuntime.setGroup("desktop-group", [curve]);
for (let i = 0; i < 20 && shownSurfaces === 0; i++)
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
assert.ok(
  shownSurfaces > 0,
  "active desktop group draws with hidden owner doc",
);
const drawsBeforeMove = drawCalls;
visibleRuntime.setGroup("desktop-group", [
  {
    ...curve,
    to: { x: 120, y: 190 },
  },
]);
assert.equal(
  drawCalls - drawsBeforeMove,
  1,
  "one geometry update triggers only one overlay render",
);
visibleRuntime.setGroupVisible("desktop-group", false);
assert.equal(activeSurfaces, 0, "an explicitly hidden group hides its line");
visibleRuntime.setGroupVisible("desktop-group", true);
assert.ok(
  activeSurfaces > 0,
  "explicitly showing a desktop group restores its line with a hidden owner doc",
);
hiddenOwner.document.dispatchEvent(new hiddenOwner.Event("visibilitychange"));
assert.ok(
  activeSurfaces > 0,
  "owner document visibility must not hide a visible detached-card group",
);
visibleRuntime.setGroupVisible("desktop-group", false);
assert.equal(
  activeSurfaces,
  0,
  "explicit visibility deactivation still hides detached-card lines",
);
Object.defineProperty(hiddenOwner.document, "hidden", {
  configurable: true,
  value: false,
});
hiddenOwner.document.dispatchEvent(new hiddenOwner.Event("visibilitychange"));
assert.equal(
  activeSurfaces,
  0,
  "owner becoming visible must not revive an explicitly hidden card group",
);
await visibleRuntime.dispose();

if (previousZotero === undefined) delete globalThis.Zotero;
else globalThis.Zotero = previousZotero;
if (previousCc === undefined) delete globalThis.Cc;
else globalThis.Cc = previousCc;
if (previousCi === undefined) delete globalThis.Ci;
else globalThis.Ci = previousCi;

stdout.write(
  "Desktop runtime checks passed: an unverified host is gated before display sampling or surface creation, and runtime cleanup is idempotent.\n",
);
