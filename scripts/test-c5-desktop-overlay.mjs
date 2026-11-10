import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stdout } from "node:process";
import { DesktopEdgeOverlayManager } from "../src/adapters/desktop-edge-overlay.ts";

const noteUI = await readFile("src/services/note-ui.ts", "utf8");
const nativeHelper = await readFile(
  "native/macos/desktop-overlay-helper.swift",
  "utf8",
);
assert.match(
  noteUI,
  /\.zob-knowledge-edge\{[^}]*stroke:#78add2;stroke-width:1\.5;stroke-opacity:\.72;stroke-dasharray:6 5/s,
  "embedded relationship lines use the shared light-blue color, width, opacity, and dash pattern",
);
assert.match(
  nativeHelper,
  /setStrokeColor\(NSColor\(calibratedRed: 0x78 \/ 255, green: 0xad \/ 255, blue: 0xd2 \/ 255, alpha: 0\.72\)\.cgColor\)/,
  "desktop lines match the embedded SVG color and opacity",
);
assert.match(nativeHelper, /context\.setLineWidth\(1\.5\)/);
assert.match(nativeHelper, /context\.setLineCap\(\.round\)/);
assert.match(nativeHelper, /setLineDash\(phase: 0, lengths: \[6, 5\]\)/);
assert.match(
  nativeHelper,
  /setFillColor\(NSColor\(calibratedRed: 0x78 \/ 255, green: 0xad \/ 255, blue: 0xd2 \/ 255, alpha: 0\.72\)\.cgColor\)/,
  "desktop arrowheads use the same tint and opacity",
);

const screenA = {
  id: "left",
  rect: { left: -1200, top: 0, width: 1200, height: 800 },
};
const screenB = {
  id: "main",
  rect: { left: 0, top: 0, width: 1440, height: 900 },
};
const curve = {
  id: "root-bayes",
  from: { x: -200, y: 120 },
  control1: { x: -80, y: 160 },
  control2: { x: 80, y: 200 },
  to: { x: 240, y: 240 },
};

function makeHost(capabilities) {
  const opened = [];
  const closed = [];
  const hidden = [];
  const draws = [];
  const host = {
    capabilities,
    open(display) {
      opened.push(display.id);
      return {
        draw(nextDisplay, curves) {
          draws.push({ display: nextDisplay.id, curves: [...curves] });
        },
        show() {},
        hide() {
          hidden.push(display.id);
        },
        close() {
          closed.push(display.id);
        },
      };
    },
  };
  return { host, opened, closed, hidden, draws };
}

const unsupported = makeHost({
  verified: false,
  transparent: true,
  nonActivating: true,
  controlledZOrder: true,
  systemMousePassthrough: false,
  tracksNativeDrag: true,
});
const blocked = new DesktopEdgeOverlayManager(unsupported.host);
assert.equal(
  blocked.setGroup("group-1", [curve], [screenA, screenB]),
  "blocked",
);
assert.deepEqual(unsupported.opened, [], "unsafe overlays are never created");

const verified = makeHost({
  verified: true,
  transparent: true,
  nonActivating: true,
  controlledZOrder: true,
  systemMousePassthrough: true,
  tracksNativeDrag: true,
});
const manager = new DesktopEdgeOverlayManager(verified.host);
assert.equal(
  manager.setGroup("group-1", [curve], [screenA, screenB]),
  "visible",
);
assert.deepEqual(
  verified.opened,
  ["left", "main"],
  "a cross-screen edge uses one surface per display",
);
assert.equal(verified.draws.length, 2);
assert.ok(
  verified.draws.every((entry) => entry.curves[0].groupId === "group-1"),
);
assert.deepEqual(
  verified.draws.map((entry) => [
    entry.display,
    entry.curves[0].startArrow,
    entry.curves[0].endArrow,
  ]),
  [
    ["left", true, false],
    ["main", false, true],
  ],
  "each cross-display endpoint arrow is assigned to exactly one display",
);

assert.equal(
  manager.setGroup("group-2", [curve], [screenA, screenB]),
  "visible",
);
assert.deepEqual(
  verified.opened,
  ["left", "main"],
  "other groups share each display surface rather than opening duplicates",
);
assert.equal(manager.setGroupVisible("group-1", false), "visible");
assert.ok(
  verified.draws
    .slice(-2)
    .every((entry) => entry.curves.every((item) => item.groupId === "group-2")),
  "a background group contributes no visible edges",
);
assert.equal(manager.setGroupVisible("group-1", true), "visible");
assert.equal(manager.removeGroup("group-1"), "visible");
assert.deepEqual(
  verified.closed,
  [],
  "one group's removal preserves other groups",
);
assert.equal(manager.removeGroup("group-2"), "empty");
assert.deepEqual(verified.closed, ["left", "main"]);

assert.equal(
  manager.setGroup("group-1", [curve], [screenA, screenB]),
  "visible",
);
verified.host.capabilities.systemMousePassthrough = false;
assert.equal(
  manager.removeGroup("group-1"),
  "blocked",
  "capabilities are rechecked on later lifecycle calls",
);
assert.deepEqual(verified.closed.slice(-2), ["left", "main"]);

const validationHost = makeHost({
  verified: true,
  transparent: true,
  nonActivating: true,
  controlledZOrder: true,
  systemMousePassthrough: true,
  tracksNativeDrag: true,
});
const validationManager = new DesktopEdgeOverlayManager(validationHost.host);
assert.equal(
  validationManager.setGroup(
    "huge-coordinate",
    [{ ...curve, to: { x: 10_000_001, y: 10 } }],
    [screenB],
  ),
  "invalid-geometry",
);
assert.equal(validationHost.opened.length, 0);
assert.equal(
  validationManager.setGroup(
    "oversized-display",
    [curve],
    [{ id: "large", rect: { left: 0, top: 0, width: 40_000, height: 900 } }],
  ),
  "invalid-geometry",
);
assert.equal(
  validationManager.setGroup("x".repeat(513), [curve], [screenB]),
  "invalid-geometry",
);
assert.equal(
  validationManager.setGroup(
    "invalid-route-status",
    [{ ...curve, routeStatus: "untrusted" }],
    [screenB],
  ),
  "invalid-geometry",
  "route status metadata is constrained to the supported enum",
);
assert.equal(
  validationManager.setGroup(
    "oversized-blocker-list",
    [
      {
        ...curve,
        blockedBy: Array.from({ length: 17 }, (_, index) => `card-${index}`),
      },
    ],
    [screenB],
  ),
  "invalid-geometry",
  "blocker metadata has a fixed upper bound",
);
validationManager.dispose();

const groupLimit = makeHost({
  verified: true,
  transparent: true,
  nonActivating: true,
  controlledZOrder: true,
  systemMousePassthrough: true,
  tracksNativeDrag: true,
});
const groupLimitManager = new DesktopEdgeOverlayManager(groupLimit.host);
for (let index = 0; index < 32; index++)
  assert.equal(
    groupLimitManager.setGroup(`group-${index}`, [curve], [screenB]),
    "visible",
  );
assert.equal(
  groupLimitManager.setGroup("group-over-limit", [curve], [screenB]),
  "invalid-geometry",
  "overlay groups are bounded per Zotero process",
);
groupLimitManager.dispose();

const curveLimit = makeHost({
  verified: true,
  transparent: true,
  nonActivating: true,
  controlledZOrder: true,
  systemMousePassthrough: true,
  tracksNativeDrag: true,
});
const curveLimitManager = new DesktopEdgeOverlayManager(curveLimit.host);
const curveBatch = Array.from({ length: 256 }, (_, index) => ({
  ...curve,
  id: `edge-${index}`,
}));
assert.equal(
  curveLimitManager.setGroup("batch-a", curveBatch, [screenB]),
  "visible",
);
assert.equal(
  curveLimitManager.setGroup("batch-b", curveBatch, [screenB]),
  "visible",
);
assert.equal(
  curveLimitManager.setGroup("batch-c", [curve], [screenB]),
  "invalid-geometry",
  "aggregate curve count is bounded across groups",
);
curveLimitManager.dispose();

const failing = makeHost({
  verified: true,
  transparent: true,
  nonActivating: true,
  controlledZOrder: true,
  systemMousePassthrough: true,
  tracksNativeDrag: true,
});
failing.host.open = (display) => ({
  draw() {
    if (display.id === "main") throw new Error("synthetic draw failure");
  },
  show() {},
  hide() {
    failing.hidden.push(display.id);
  },
  close() {
    failing.closed.push(display.id);
  },
});
const faultManager = new DesktopEdgeOverlayManager(failing.host);
assert.equal(
  faultManager.setGroup("group-1", [curve], [screenA, screenB]),
  "host-failure",
);
assert.ok(failing.hidden.length > 0, "failure hides every created surface");
assert.ok(failing.closed.length > 0, "failure closes every created surface");

stdout.write(
  "Desktop overlay checks passed: capability gate, per-display sharing, explicit group visibility, endpoint arrows, bounded geometry validation, runtime capability loss, and fail-closed cleanup.\n",
);
