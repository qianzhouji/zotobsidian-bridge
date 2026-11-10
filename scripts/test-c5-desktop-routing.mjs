import assert from "node:assert/strict";
import { stdout } from "node:process";
import { routeDesktopEdge } from "../src/core/desktop-edge-routing.ts";
import { projectDesktopEdges } from "../src/core/desktop-edge-projection.ts";

function pointOnCurve(curve, t) {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * curve.from.x +
      3 * inverse ** 2 * t * curve.control1.x +
      3 * inverse * t ** 2 * curve.control2.x +
      t ** 3 * curve.to.x,
    y:
      inverse ** 3 * curve.from.y +
      3 * inverse ** 2 * t * curve.control1.y +
      3 * inverse * t ** 2 * curve.control2.y +
      t ** 3 * curve.to.y,
  };
}

function assertClearOf(curve, rect, clearance = 20) {
  for (let index = 1; index < 64; index++) {
    const point = pointOnCurve(curve, index / 64);
    assert.ok(
      point.x < rect.left - clearance ||
        point.x > rect.left + rect.width + clearance ||
        point.y < rect.top - clearance ||
        point.y > rect.top + rect.height + clearance,
      `curve intersects obstacle at ${JSON.stringify(point)}`,
    );
  }
}

const edge = {
  id: "Bayes\0Motion",
  fromPath: "Bayes.md",
  toPath: "Motion.md",
  relationGeneration: 4,
  from: {
    kind: "knowledge-card-side",
    path: "Bayes.md",
    side: "right",
    point: { x: 200, y: 180 },
    contentGeneration: 1,
    windowGeneration: 1,
  },
  to: {
    kind: "knowledge-card-side",
    path: "Motion.md",
    side: "left",
    point: { x: 700, y: 420 },
    contentGeneration: 1,
    windowGeneration: 2,
  },
  obstacles: [
    {
      path: "Third.md",
      rect: { left: 390, top: 190, width: 180, height: 180 },
    },
  ],
};
const projectedEdge = projectDesktopEdges({
  edges: [{ from: "Bayes.md", to: "Motion.md" }],
  rootPaths: new Set(),
  roots: new Map(),
  rootLinks: new Map(),
  cards: new Map([
    [
      "Bayes.md",
      {
        visible: true,
        headerRect: { left: 0, top: 156, width: 200, height: 48 },
        windowRect: { left: 0, top: 100, width: 200, height: 300 },
        contentGeneration: 1,
        windowGeneration: 1,
      },
    ],
    [
      "Motion.md",
      {
        visible: true,
        headerRect: { left: 700, top: 396, width: 200, height: 48 },
        windowRect: { left: 700, top: 340, width: 200, height: 300 },
        contentGeneration: 1,
        windowGeneration: 2,
      },
    ],
    [
      "Third.md",
      {
        visible: true,
        headerRect: { left: 390, top: 196, width: 180, height: 48 },
        windowRect: { left: 390, top: 140, width: 180, height: 240 },
        contentGeneration: 1,
        windowGeneration: 3,
      },
    ],
  ]),
  relationGeneration: 4,
})[0];
assert.deepEqual(
  projectedEdge.obstacles?.map((obstacle) => obstacle.path),
  ["Third.md"],
  "the route receives only unrelated visible knowledge windows as obstacles",
);
assert.equal(
  routeDesktopEdge(projectedEdge).routeStatus,
  "detour",
  "projected windows feed the production router",
);
const unmeasuredCards = new Map([
  [
    "Bayes.md",
    {
      visible: true,
      headerRect: { left: 0, top: 156, width: 200, height: 48 },
      windowRect: { left: 0, top: 100, width: 200, height: 300 },
      contentGeneration: 1,
      windowGeneration: 1,
    },
  ],
  [
    "Motion.md",
    {
      visible: true,
      headerRect: { left: 700, top: 396, width: 200, height: 48 },
      windowRect: { left: 700, top: 340, width: 200, height: 300 },
      contentGeneration: 1,
      windowGeneration: 2,
    },
  ],
  [
    "Unknown.md",
    {
      visible: true,
      headerRect: { left: 390, top: 196, width: 180, height: 48 },
      contentGeneration: 1,
      windowGeneration: 3,
    },
  ],
]);
const unknownObstacleCardEdge = projectDesktopEdges({
  edges: [{ from: "Bayes.md", to: "Motion.md" }],
  rootPaths: new Set(),
  roots: new Map(),
  rootLinks: new Map(),
  cards: unmeasuredCards,
  relationGeneration: 4,
});
assert.deepEqual(
  unknownObstacleCardEdge,
  [],
  "card-to-card edges fail closed while an unrelated visible window has unknown geometry",
);
const rootThroughUnknownWindow = projectDesktopEdges({
  edges: [{ from: "Paper.md", to: "Bayes.md" }],
  rootPaths: new Set(["Paper.md"]),
  roots: new Map([
    [
      "Paper.md",
      {
        visible: true,
        titleVisible: true,
        titleRect: { left: 20, top: 20, width: 200, height: 28 },
        contentGeneration: 1,
      },
    ],
  ]),
  rootLinks: new Map([
    [
      "Paper.md\0Bayes.md",
      [
        {
          occurrence: 0,
          rect: { left: 100, top: 200, width: 80, height: 20 },
          visible: true,
          contentGeneration: 1,
        },
      ],
    ],
  ]),
  cards: unmeasuredCards,
  relationGeneration: 4,
});
assert.equal(
  rootThroughUnknownWindow.length,
  1,
  "root text links do not use card-window detours or depend on unrelated window geometry",
);
const direct = routeDesktopEdge({ ...edge, obstacles: [] });
const routed = routeDesktopEdge(edge);
assert.equal(direct.routeStatus, "direct");
assert.equal(routed.routeStatus, "detour");
assert.deepEqual(routed.from, edge.from.point);
assert.deepEqual(routed.to, edge.to.point);
assert.ok(routed.control1.x > routed.from.x, "source exits right side");
assert.ok(routed.control2.x < routed.to.x, "target enters left side");
assertClearOf(routed, edge.obstacles[0].rect);

const reciprocal = routeDesktopEdge({
  ...edge,
  fromPath: edge.toPath,
  toPath: edge.fromPath,
  from: { ...edge.to, side: "right" },
  to: { ...edge.from, side: "left" },
});
assert.equal(reciprocal.routeStatus, "detour");
assert.ok(reciprocal.control1.x > reciprocal.from.x);
assert.ok(reciprocal.control2.x < reciprocal.to.x);

const impossible = routeDesktopEdge({
  ...edge,
  obstacles: [
    {
      path: "Blocker.md",
      rect: { left: -1000, top: -1000, width: 3000, height: 3000 },
    },
  ],
});
assert.equal(impossible.routeStatus, "blocked");
assert.deepEqual(impossible.blockedBy, ["Blocker.md"]);
assert.deepEqual(
  impossible.from,
  edge.from.point,
  "blocked fallback keeps side anchor",
);

const rootEdge = routeDesktopEdge({
  ...edge,
  from: {
    kind: "root-link",
    path: "Paper.md",
    occurrence: 0,
    point: { x: 10, y: 10 },
    contentGeneration: 1,
  },
});
assert.equal(rootEdge.routeStatus, "direct", "root text anchors never detour");

stdout.write(
  "C5-D.5 routing checks passed: direct preservation, side anchors, third-card detours, reciprocal direction, blocked fallback, and root-link exemption.\n",
);
