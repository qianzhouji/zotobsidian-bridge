import assert from "node:assert/strict";
import { stdout } from "node:process";

const previousIOUtils = globalThis.IOUtils;
const previousPathUtils = globalThis.PathUtils;
const writes = [];

globalThis.PathUtils = {
  profileDir: "/isolated/profile",
  join: (...parts) => parts.join("/"),
  parent: (path) => path.slice(0, path.lastIndexOf("/")),
};
globalThis.IOUtils = {
  async makeDirectory(path, options) {
    writes.push({ kind: "directory", path, options });
  },
  async writeJSON(path, value, options) {
    writes.push({ kind: "json", path, value, options });
  },
};

const {
  recordDesktopEdgeDiagnostics,
  recordDesktopEdgeIpcEvent,
  recordDesktopEdgeRenderedAck,
} = await import("../src/adapters/desktop-edge-diagnostics.ts");
recordDesktopEdgeDiagnostics("projection", {
  projectedCount: 1,
  curves: [{ from: { x: 10, y: 20 }, to: { x: 30, y: 40 } }],
});
recordDesktopEdgeDiagnostics("helper", {
  state: "acknowledged",
  curveCount: 1,
});
recordDesktopEdgeDiagnostics("ipc", {
  event: "ack",
  status: "rendered",
  curveCount: 1,
});
recordDesktopEdgeIpcEvent({ event: "sync-flush-start", curveCount: 1 });
recordDesktopEdgeIpcEvent({ event: "ack", status: "rendered", curveCount: 1 });
for (let generation = 1; generation <= 60; generation++) {
  recordDesktopEdgeIpcEvent({ event: "frame", generation });
  recordDesktopEdgeRenderedAck({
    zoteroPID: 1234,
    generation,
    roundTripMs: generation / 10,
    status: "rendered",
    activeWindows: 1,
    visibleWindows: 1,
    curveCount: 1,
  });
}
await new Promise((resolve) => globalThis.setTimeout(resolve, 600));

const write = writes.find(
  (entry) =>
    entry.kind === "json" &&
    entry.path.endsWith("desktop-edge-diagnostics.json"),
);
assert.ok(write, "diagnostic snapshot is persisted");
assert.equal(
  write.path,
  "/isolated/profile/zotero-obsidian-bridge/desktop-edge-diagnostics.json",
);
assert.equal(write.value.projection.projectedCount, 1);
assert.equal(write.value.helper.curveCount, 1);
assert.equal(write.value.ipc.status, "rendered");
assert.equal(write.options.mode, "overwrite");
assert.equal(write.options.flush, true);
assert.equal(JSON.stringify(write.value).includes("markdown"), false);
assert.equal(
  writes.filter(
    (entry) =>
      entry.kind === "json" &&
      entry.path.endsWith("desktop-edge-diagnostics.json"),
  ).length,
  1,
  "diagnostic snapshots coalesce during animation frames",
);
const ackWrite = writes.find(
  (entry) =>
    entry.kind === "json" &&
    entry.path.endsWith("desktop-edge-rendered-ack.json"),
);
assert.ok(ackWrite, "the rendered ACK has a dedicated durable record");
assert.equal(ackWrite.value.status, "rendered");
assert.equal(ackWrite.value.curveCount, 1);
assert.equal(ackWrite.value.generation, 60);
assert.equal(ackWrite.value.ackCount, 60);
assert.equal(ackWrite.value.roundTripMs, 6);
assert.equal(
  writes.filter(
    (entry) =>
      entry.kind === "json" &&
      entry.path.endsWith("desktop-edge-rendered-ack.json"),
  ).length,
  1,
  "per-frame ACKs coalesce into one latest-frame record",
);
const ipcWrite = writes
  .filter(
    (entry) =>
      entry.kind === "json" && entry.path.includes("desktop-edge-ipc-"),
  )
  .at(-1);
assert.ok(ipcWrite, "the per-context IPC trace is persisted independently");
assert.equal(ipcWrite.value.events.length, 40, "the IPC trace remains bounded");
assert.deepEqual(
  ipcWrite.value.events.slice(-2).map((event) => event.generation),
  [59, 60],
);
assert.equal(
  writes.filter(
    (entry) =>
      entry.kind === "json" && entry.path.includes("desktop-edge-ipc-"),
  ).length,
  1,
  "per-frame IPC events coalesce into one bounded trace write",
);

if (previousIOUtils === undefined) delete globalThis.IOUtils;
else globalThis.IOUtils = previousIOUtils;
if (previousPathUtils === undefined) delete globalThis.PathUtils;
else globalThis.PathUtils = previousPathUtils;

stdout.write("Desktop edge diagnostic persistence checks passed.\n");
