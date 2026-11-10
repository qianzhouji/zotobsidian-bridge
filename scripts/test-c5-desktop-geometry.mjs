import assert from "node:assert/strict";
import { stdout } from "node:process";
import {
  composeAffineTransforms,
  createViewportToDesktopTransform,
  desktopLogicalToBacking,
  DesktopGeometryService,
  frameViewportToParentTransform,
  invertAffineTransform,
  mapRectThroughAffine,
  screenBackingToDesktopLogical,
  transformPoint,
} from "../src/core/desktop-geometry.ts";
import { captureDesktopWindowGeometry } from "../src/adapters/desktop-geometry-host.ts";

const desktop = createViewportToDesktopTransform(
  { width: 1000, height: 700 },
  { left: -1440, top: 24, width: 2000, height: 1400 },
);
assert.deepEqual(desktop, {
  a: 2,
  b: 0,
  c: 0,
  d: 2,
  e: -1440,
  f: 24,
});
assert.deepEqual(
  mapRectThroughAffine({ left: 100, top: 50, width: 20, height: 10 }, desktop),
  { left: -1240, top: 124, width: 40, height: 20 },
  "logical desktop coordinates preserve negative display origins",
);

const childToParent = {
  a: 0,
  b: 2,
  c: -2,
  d: 0,
  e: 500,
  f: 100,
};
const composed = composeAffineTransforms(desktop, childToParent);
const point = { x: 25, y: 10 };
const sequential = transformPoint(
  desktop,
  transformPoint(childToParent, point),
);
assert.deepEqual(transformPoint(composed, point), sequential);
const inverse = invertAffineTransform(composed);
assert.ok(inverse);
const roundTrip = transformPoint(inverse, sequential);
assert.ok(Math.abs(roundTrip.x - point.x) < 1e-9);
assert.ok(Math.abs(roundTrip.y - point.y) < 1e-9);

const rotatedFrame = {
  offsetWidth: 100,
  offsetHeight: 50,
  clientWidth: 100,
  clientHeight: 50,
  clientLeft: 0,
  clientTop: 0,
  getBoundingClientRect: () => ({
    left: 450,
    top: 100,
    width: 100,
    height: 200,
  }),
  getBoxQuads: () => [
    {
      p1: { x: 500, y: 100 },
      p2: { x: 500, y: 300 },
      p3: { x: 400, y: 300 },
      p4: { x: 400, y: 100 },
    },
  ],
};
const rotation = frameViewportToParentTransform(rotatedFrame, {
  width: 100,
  height: 50,
});
assert.deepEqual(rotation, {
  a: 0,
  b: 2,
  c: -2,
  d: 0,
  e: 500,
  f: 100,
});

const perspectiveFrame = {
  ...rotatedFrame,
  getBoxQuads: () => [
    {
      p1: { x: 0, y: 0 },
      p2: { x: 100, y: 0 },
      p3: { x: 90, y: 50 },
      p4: { x: 0, y: 50 },
    },
  ],
};
assert.equal(
  frameViewportToParentTransform(perspectiveFrame, {
    width: 100,
    height: 50,
  }),
  undefined,
  "unsupported perspective geometry must be rejected, not approximated",
);

const geometry = new DesktopGeometryService();
const observed = geometry.observeWindow("reader-1", desktop, 100);
assert.equal(observed?.topologyGeneration, geometry.topologyGeneration);
assert.deepEqual(
  geometry.mapWindowRect("reader-1", {
    left: 0,
    top: 0,
    width: 100,
    height: 50,
  }),
  { left: -1440, top: 24, width: 200, height: 100 },
);
const nextGeneration = geometry.invalidateTopology();
assert.equal(nextGeneration, 2);
assert.equal(
  geometry.mapWindowRect("reader-1", {
    left: 0,
    top: 0,
    width: 100,
    height: 50,
  }),
  undefined,
  "topology changes invalidate all old window transforms",
);
assert.equal(
  geometry.observeWindow("reader-1", { ...desktop, a: 0 }),
  undefined,
);

const calibration = {
  displayId: "retina-display",
  topologyGeneration: 2,
  logicalRect: { left: -1440, top: 0, width: 1440, height: 900 },
  backingOrigin: { x: 0, y: 0 },
  backingScaleX: 2,
  backingScaleY: 2,
};
const backingPoint = desktopLogicalToBacking(
  { x: -720, y: 450 },
  calibration,
  2,
);
assert.deepEqual(backingPoint, { x: 1440, y: 900 });
assert.deepEqual(screenBackingToDesktopLogical(backingPoint, calibration, 2), {
  x: -720,
  y: 450,
});
const oneXCalibration = {
  ...calibration,
  displayId: "standard-display",
  logicalRect: { left: 0, top: 0, width: 1920, height: 1080 },
  backingOrigin: { x: 1920, y: 0 },
  backingScaleX: 1,
  backingScaleY: 1,
};
assert.deepEqual(
  desktopLogicalToBacking({ x: 1920, y: 1080 }, oneXCalibration, 2),
  { x: 3840, y: 1080 },
  "a calibrated 1x display is not multiplied by a global devicePixelRatio",
);
assert.equal(
  desktopLogicalToBacking({ x: -720, y: 450 }, calibration, 3),
  undefined,
  "a display calibration cannot cross topology generations",
);

const topWindow = {
  innerWidth: 1000,
  innerHeight: 700,
  mozInnerScreenX: -1200,
  mozInnerScreenY: 40,
  devicePixelRatio: 2,
};
topWindow.top = topWindow;
topWindow.parent = topWindow;
const frame = {
  offsetWidth: 420,
  offsetHeight: 320,
  clientWidth: 400,
  clientHeight: 300,
  clientLeft: 10,
  clientTop: 10,
  getBoundingClientRect: () => ({ left: 10, top: 10, width: 840, height: 640 }),
};
const childWindow = {
  innerWidth: 800,
  innerHeight: 600,
  devicePixelRatio: 1,
  parent: topWindow,
  top: topWindow,
  frameElement: frame,
};
const captured = captureDesktopWindowGeometry(childWindow);
assert.ok(captured);
assert.deepEqual(captured.viewportToDesktop, {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: -1170,
  f: 70,
});
assert.equal(captured.devicePixelRatio, 1);
assert.equal(
  captureDesktopWindowGeometry({
    ...childWindow,
    frameElement: null,
  }),
  undefined,
  "an inaccessible iframe chain is rejected rather than guessed",
);

stdout.write(
  "Desktop geometry checks passed: Gecko iframe capture, scale, rotation, composition, inverse, negative origins, explicit backing calibration, perspective rejection, and topology generations.\n",
);
