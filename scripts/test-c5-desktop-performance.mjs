import assert from "node:assert/strict";
import { stdout } from "node:process";
import { DesktopEdgePerformanceMetrics } from "../src/core/desktop-edge-performance.ts";

const metrics = new DesktopEdgePerformanceMetrics();
for (let index = 0; index < 100; index++) {
  metrics.request(index > 0);
  metrics.frame(
    index / 10,
    2 + (index % 5),
    index % 9,
    index % 18,
    index * 16.7,
  );
}
const snapshot = metrics.snapshot();
assert.equal(snapshot.scheduledRequests, 100);
assert.equal(snapshot.coalescedRequests, 99);
assert.equal(snapshot.frames, 100);
assert.ok(snapshot.p95FrameIntervalMs > 16 && snapshot.p95FrameIntervalMs < 17);
assert.ok(snapshot.maxFrameIntervalMs > 16 && snapshot.maxFrameIntervalMs < 17);
assert.equal(snapshot.maxCards, 8);
assert.equal(snapshot.maxEdges, 17);
assert.ok(snapshot.p95DeliveryMs > 0 && snapshot.p95DeliveryMs <= 16);
assert.ok(snapshot.p95PaintMs >= 5);

metrics.frame(Number.NaN, 1, 1, 1, 100);
metrics.frame(1, -1, 1, 1, 100);
assert.equal(metrics.snapshot().frames, 100, "invalid samples are ignored");

for (let index = 0; index < 300; index++)
  metrics.frame(1, 1, 1, 1, 1700 + index * 16.7);
assert.equal(metrics.snapshot().frames, 400);
assert.equal(metrics.snapshot().p95PaintMs, 1, "sample memory remains bounded");
assert.ok(metrics.snapshot().p95FrameIntervalMs > 16);

stdout.write(
  "C5-D.7 metrics checks passed: geometry-frame cadence, request coalescing, bounded p95 samples, workload maxima, and invalid sample rejection.\n",
);
