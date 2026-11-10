import assert from "node:assert/strict";
import { stdout } from "node:process";
import { projectDesktopEdges } from "../src/core/desktop-edge-projection.ts";

const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
});
const edges = [
  { from: "Paper/P02N01.md", to: "Mathematics/Bayes.md" },
  { from: "Paper/P02N01.md", to: "Physics/Motion.md" },
  { from: "Mathematics/Bayes.md", to: "Physics/Motion.md" },
  { from: "Physics/Motion.md", to: "Mathematics/Bayes.md" },
];
const rootPath = "Paper/P02N01.md";
const bayesPath = "Mathematics/Bayes.md";
const motionPath = "Physics/Motion.md";
const bayesKey = `${rootPath}\0${bayesPath}`;
const motionKey = `${rootPath}\0${motionPath}`;
const projected = projectDesktopEdges({
  edges,
  rootPaths: new Set([rootPath]),
  roots: new Map([
    [
      rootPath,
      {
        visible: true,
        titleVisible: true,
        titleRect: rect(300, 80, 80, 24),
        contentGeneration: 7,
      },
    ],
  ]),
  rootLinks: new Map([
    [
      bayesKey,
      [
        {
          occurrence: 0,
          rect: rect(20, 100, 40, 20),
          visible: true,
          contentGeneration: 7,
        },
        {
          occurrence: 1,
          rect: rect(20, 620, 60, 20),
          visible: true,
          contentGeneration: 7,
        },
      ],
    ],
    [
      motionKey,
      [
        {
          occurrence: 0,
          rect: rect(24, 700, 70, 20),
          visible: true,
          contentGeneration: 7,
        },
      ],
    ],
  ]),
  preferredRootOccurrences: new Map([[bayesKey, 1]]),
  cards: new Map([
    [
      bayesPath,
      {
        visible: true,
        headerRect: rect(800, 150, 300, 48),
        contentGeneration: 3,
        windowGeneration: 9,
      },
    ],
    [
      motionPath,
      {
        visible: true,
        headerRect: rect(1200, 500, 300, 48),
        contentGeneration: 4,
        windowGeneration: 11,
      },
    ],
  ]),
  relationGeneration: 22,
});
assert.equal(projected.length, 3, "reciprocal note links draw a single edge");
const rootBayes = projected.find(
  (edge) => edge.id === [rootPath, bayesPath].sort().join("\0"),
);
assert.ok(rootBayes);
assert.equal(rootBayes.from.kind, "root-link");
assert.equal(rootBayes.from.occurrence, 1);
assert.deepEqual(rootBayes.from.point, { x: 50, y: 630 });
assert.equal(rootBayes.to.kind, "knowledge-card-side");
assert.equal(rootBayes.to.side, "left");
assert.equal(rootBayes.relationGeneration, 22);

const rootMotion = projected.find(
  (edge) => edge.id === [rootPath, motionPath].sort().join("\0"),
);
assert.ok(rootMotion);
assert.equal(rootMotion.from.kind, "root-link");
assert.equal(rootMotion.from.occurrence, 0);
assert.deepEqual(rootMotion.from.point, { x: 59, y: 710 });

const hiddenPreferred = projectDesktopEdges({
  edges: [edges[0]],
  rootPaths: new Set([rootPath]),
  roots: new Map([
    [
      rootPath,
      {
        visible: true,
        titleVisible: true,
        titleRect: rect(300, 80, 80, 24),
        contentGeneration: 7,
      },
    ],
  ]),
  rootLinks: new Map([
    [
      bayesKey,
      [
        {
          occurrence: 0,
          rect: rect(20, 100, 40, 20),
          visible: true,
          contentGeneration: 7,
        },
        {
          occurrence: 1,
          rect: rect(20, 620, 60, 20),
          visible: false,
          contentGeneration: 7,
        },
      ],
    ],
  ]),
  preferredRootOccurrences: new Map([[bayesKey, 1]]),
  cards: new Map([
    [
      bayesPath,
      {
        visible: true,
        headerRect: rect(800, 150, 300, 48),
        contentGeneration: 3,
        windowGeneration: 9,
      },
    ],
  ]),
  relationGeneration: 23,
});
assert.equal(hiddenPreferred[0].from.kind, "root-title");
assert.deepEqual(hiddenPreferred[0].from.point, { x: 340, y: 92 });

const invisibleRoot = projectDesktopEdges({
  edges: [edges[0]],
  rootPaths: new Set([rootPath]),
  roots: new Map([
    [
      rootPath,
      {
        visible: false,
        titleVisible: true,
        titleRect: rect(300, 80, 80, 24),
        contentGeneration: 7,
      },
    ],
  ]),
  rootLinks: new Map(),
  cards: new Map([
    [
      bayesPath,
      {
        visible: true,
        headerRect: rect(800, 150, 300, 48),
        contentGeneration: 3,
        windowGeneration: 9,
      },
    ],
  ]),
  relationGeneration: 24,
});
assert.deepEqual(
  invisibleRoot,
  [],
  "hidden root sources never use stale anchors",
);

const staleRootAnchor = projectDesktopEdges({
  edges: [edges[0]],
  rootPaths: new Set([rootPath]),
  roots: new Map([
    [
      rootPath,
      {
        visible: true,
        titleVisible: true,
        titleRect: rect(300, 80, 80, 24),
        contentGeneration: 8,
      },
    ],
  ]),
  rootLinks: new Map([
    [
      bayesKey,
      [
        {
          occurrence: 0,
          rect: rect(20, 100, 40, 20),
          visible: true,
          contentGeneration: 7,
        },
      ],
    ],
  ]),
  preferredRootOccurrences: new Map([[bayesKey, 0]]),
  cards: new Map([
    [
      bayesPath,
      {
        visible: true,
        headerRect: rect(800, 150, 300, 48),
        contentGeneration: 3,
        windowGeneration: 9,
      },
    ],
  ]),
  relationGeneration: 25,
});
assert.equal(
  staleRootAnchor[0].from.kind,
  "root-title",
  "old rendered link rectangles must not survive a content generation change",
);

const alignedCards = projectDesktopEdges({
  edges: [{ from: bayesPath, to: motionPath }],
  rootPaths: new Set(),
  roots: new Map(),
  rootLinks: new Map(),
  cards: new Map([
    [
      bayesPath,
      {
        visible: true,
        headerRect: rect(800, 100, 300, 48),
        contentGeneration: 3,
        windowGeneration: 9,
      },
    ],
    [
      motionPath,
      {
        visible: true,
        headerRect: rect(800, 300, 300, 48),
        contentGeneration: 4,
        windowGeneration: 11,
      },
    ],
  ]),
  relationGeneration: 26,
});
assert.equal(alignedCards[0].from.side, "right");
assert.equal(alignedCards[0].to.side, "left");

stdout.write(
  "Desktop edge projection checks passed: independent root occurrences, hidden-anchor fallback, card-side endpoints, reciprocal dedupe, and source generations.\n",
);
