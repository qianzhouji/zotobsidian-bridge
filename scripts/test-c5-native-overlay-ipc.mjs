import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { setImmediate } from "node:timers";
import { DesktopOverlayProcessClient } from "../src/adapters/desktop-overlay-process.ts";
import { NativeDesktopEdgeOverlayHost } from "../src/adapters/native-desktop-edge-overlay.ts";

const nativeHelperSource = await readFile(
  "native/macos/desktop-overlay-helper.swift",
  "utf8",
);
assert.match(
  nativeHelperSource,
  /setNeedsDisplay\(clipped\)/,
  "moving edges invalidate only their old and new curve bounds",
);
assert.match(
  nativeHelperSource,
  /curveBounds\(curve\)\.intersects\(dirtyRect\)/,
  "draw skips curves outside the invalidated region",
);
assert.doesNotMatch(
  nativeHelperSource,
  /needsDisplay\s*=\s*true/,
  "drag frames do not invalidate the full desktop surface",
);
assert.match(
  nativeHelperSource,
  /NSWorkspace\.didActivateApplicationNotification/,
  "the helper observes macOS foreground application changes",
);
assert.match(
  nativeHelperSource,
  /NSWorkspace\.didDeactivateApplicationNotification/,
  "the helper immediately hides lines when Zotero loses foreground",
);
assert.match(
  nativeHelperSource,
  /shouldShowOverlay\(\s*requestedVisible: requestedVisible,\s*parentApplicationActive: parentApplicationActive\s*\)/,
  "line visibility requires both a live geometry request and foreground Zotero",
);
assert.match(
  nativeHelperSource,
  /if !panel\.isVisible \{ panel\.orderFrontRegardless\(\) \}/,
  "visible overlay panels are not raised on every geometry frame",
);
assert.match(
  nativeHelperSource,
  /private let animationFrameInterval: TimeInterval = 1\.0 \/ 60\.0/,
  "the native surface advances endpoint interpolation at display-frame cadence",
);
assert.match(
  nativeHelperSource,
  /func advanceAnimation\(/,
  "the helper advances moving curves independently of incoming IPC snapshots",
);
assert.match(
  nativeHelperSource,
  /RunLoop\.main\.add\(timer, forMode: \.common\)/,
  "animation frames continue through common AppKit run-loop modes",
);

class FakeOutput {
  chunks = [];
  readers = [];
  ended = false;
  closed = false;

  readString() {
    if (this.chunks.length) return Promise.resolve(this.chunks.shift());
    if (this.ended || this.closed) return Promise.resolve("");
    return new Promise((resolve) => this.readers.push(resolve));
  }

  push(value) {
    const reader = this.readers.shift();
    if (reader) reader(value);
    else this.chunks.push(value);
  }

  end() {
    this.ended = true;
    for (const reader of this.readers.splice(0)) reader("");
  }

  close() {
    this.closed = true;
    this.end();
  }
}

class FakeChild {
  stdout = new FakeOutput();
  messages = [];
  killed = false;
  exitCode;
  exit;
  exitResolve;
  autoAck;
  constructor({ protocol = 1, autoAck = true, holdShutdown = false } = {}) {
    this.autoAck = autoAck;
    this.holdShutdown = holdShutdown;
    this.exit = new Promise((resolve) => (this.exitResolve = resolve));
    this.stdin = {
      write: (line) => {
        const message = JSON.parse(line);
        this.messages.push(message);
        if (message.type === "sync" && this.autoAck)
          Promise.resolve().then(() => this.ack(message.generation));
        if (message.type === "ping")
          Promise.resolve().then(() =>
            this.emit({ type: "pong", nonce: message.nonce }),
          );
        if (message.type === "shutdown") {
          if (!this.holdShutdown) {
            this.emit({ type: "ack", operation: "shutdown" });
            Promise.resolve().then(() => this.finish(0));
          }
        }
      },
      close: () => {
        if (!this.holdShutdown) this.finish(0);
      },
    };
    Promise.resolve().then(() =>
      this.emit({
        type: "ready",
        protocol,
        capabilities: {
          transparent: true,
          nonActivating: true,
          controlledZOrder: true,
          systemMousePassthrough: true,
          multiDisplay: true,
          tracksNativeDrag: true,
        },
      }),
    );
  }

  emit(value) {
    this.stdout.push(`${JSON.stringify(value)}\n`);
  }

  ack(generation) {
    this.emit({
      type: "ack",
      operation: "sync",
      generation,
      status: "rendered",
      activeWindows: 1,
      visibleWindows: 1,
      curveCount: 1,
    });
  }

  finish(exitCode) {
    if (this.exitCode !== undefined) return;
    this.exitCode = exitCode;
    this.exitResolve({ exitCode });
    this.stdout.end();
  }

  kill() {
    this.killed = true;
    this.finish(-9);
  }

  wait() {
    return this.exit;
  }
}

const capabilities = {
  transparent: true,
  nonActivating: true,
  controlledZOrder: true,
  systemMousePassthrough: true,
  multiDisplay: true,
  tracksNativeDrag: true,
};
const snapshot = (id) => [
  {
    id: "screen:0,0,1440,900",
    rect: { left: 0, top: 0, width: 1440, height: 900 },
    visible: true,
    curves: [
      {
        id,
        from: { x: 10, y: 20 },
        control1: { x: 30, y: 40 },
        control2: { x: 50, y: 60 },
        to: { x: 70, y: 80 },
        startArrow: true,
        endArrow: true,
      },
    ],
  },
];
const children = [];
const makeClient = (child, overrides = {}) => {
  children.push(child);
  return new DesktopOverlayProcessClient({
    launch: async () => child,
    readyTimeoutMs: 100,
    acknowledgementTimeoutMs: 100,
    shutdownTimeoutMs: 30,
    ...overrides,
  });
};

const child = new FakeChild();
const ackReports = [];
const client = makeClient(child, {
  onSnapshotAck: (ack) => ackReports.push(ack),
});
assert.deepEqual(await client.start(), capabilities);
await client.sendSnapshot(snapshot("first"));
assert.equal(ackReports.length, 1);
const { roundTripMs, ...ackReport } = ackReports[0];
assert.deepEqual(ackReport, {
  generation: 1,
  status: "rendered",
  activeWindows: 1,
  visibleWindows: 1,
  curveCount: 1,
});
assert.ok(Number.isFinite(roundTripMs) && roundTripMs >= 0);
await client.ping("health-1");
assert.equal(client.state, "ready");
assert.equal(
  child.messages.filter((message) => message.type === "sync")[0].generation,
  1,
);
await client.stop();
await client.stop();
assert.equal(client.state, "stopped", "stop is idempotent");
assert.equal(child.killed, false, "well-behaved helper exits gracefully");

let launchAttempts = 0;
const retryChild = new FakeChild();
const retryClient = new DesktopOverlayProcessClient({
  launch: async () => {
    launchAttempts++;
    if (launchAttempts === 1) throw new Error("spawn denied");
    return retryChild;
  },
  readyTimeoutMs: 100,
});
await assert.rejects(retryClient.start(), /spawn denied/);
await retryClient.stop();
assert.equal(
  retryClient.state,
  "stopped",
  "failed launch can be explicitly reset",
);
assert.deepEqual(await retryClient.start(), capabilities);
await retryClient.stop();

let callbackClient;
callbackClient = new DesktopOverlayProcessClient({
  launch: async () => {
    throw new Error("native helper unavailable");
  },
  onFailure: () => void callbackClient.stop(),
});
await assert.rejects(callbackClient.start(), /native helper unavailable/);
assert.equal(
  callbackClient.state,
  "stopped",
  "failure cleanup may reset before rejection",
);

const coalescedChild = new FakeChild({ autoAck: false });
const coalesced = makeClient(coalescedChild);
await coalesced.start();
const first = coalesced.sendSnapshot(snapshot("one"));
await new Promise((resolve) => setImmediate(resolve));
const second = coalesced.sendSnapshot(snapshot("two"));
const third = coalesced.sendSnapshot(snapshot("three"));
assert.equal(
  await second,
  "superseded",
  "pending intermediate frames coalesce",
);
coalescedChild.ack(1);
assert.equal(await first, "acknowledged");
await new Promise((resolve) => setImmediate(resolve));
const sentGenerations = coalescedChild.messages
  .filter((message) => message.type === "sync")
  .map((message) => message.generation);
assert.deepEqual(sentGenerations, [1, 3]);
coalescedChild.ack(3);
assert.equal(await third, "acknowledged");
await coalesced.stop();

const mismatch = makeClient(new FakeChild({ protocol: 99 }));
await assert.rejects(mismatch.start(), /protocol version mismatch/);
await mismatch.stop();

let timeoutFailures = 0;
const timeoutChild = new FakeChild({ autoAck: false });
const timeoutClient = makeClient(timeoutChild, {
  acknowledgementTimeoutMs: 10,
  onFailure: () => timeoutFailures++,
});
await timeoutClient.start();
await assert.rejects(
  timeoutClient.sendSnapshot(snapshot("timeout")),
  /timed out/,
);
assert.equal(timeoutFailures, 1);
await timeoutClient.stop();

const killedChild = new FakeChild({ holdShutdown: true });
const killedClient = makeClient(killedChild, { shutdownTimeoutMs: 10 });
await killedClient.start();
await killedClient.stop();
assert.equal(killedChild.killed, true, "hung helper is forcibly reaped");

const bytes = new Uint8Array(5000).fill(7);
const hash = createHash("sha256").update(bytes).digest("hex");
const response = (value) => ({
  ok: true,
  status: 200,
  json: async () => value,
  arrayBuffer: async () =>
    value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
});
const packagedChild = new FakeChild();
let extracted;
let removedExecutable;
const host = new NativeDesktopEdgeOverlayHost({
  // Gecko reports Services.appinfo.OS as "Darwin" on macOS.
  platform: "Darwin",
  profileDir: "/isolated/profile",
  processID: 42,
  resourceBaseURL: "chrome://test/content/native/macos",
  fetchResource: async (url) =>
    url.endsWith("manifest.json")
      ? response({
          protocolVersion: 1,
          binary: "desktop-overlay-helper",
          sha256: hash,
        })
      : response(bytes),
  writeExecutable: async (digest, binary) => {
    extracted = { digest, length: binary.length };
    return "/isolated/profile/native-helper";
  },
  removeExecutable: async (path) => {
    removedExecutable = path;
  },
  launch: async (path, parentPID) => {
    assert.equal(path, "/isolated/profile/native-helper");
    assert.equal(parentPID, 42);
    return packagedChild;
  },
});
await host.prepare();
assert.deepEqual(host.capabilities, {
  verified: true,
  transparent: true,
  nonActivating: true,
  controlledZOrder: true,
  systemMousePassthrough: true,
  tracksNativeDrag: true,
});
assert.deepEqual(extracted, { digest: hash, length: 5000 });
const surface = host.open(snapshot("surface")[0]);
surface.draw(snapshot("surface")[0], [
  {
    ...snapshot("surface")[0].curves[0],
    groupId: "group-1",
    routeStatus: "direct",
    startArrow: true,
    endArrow: true,
  },
]);
surface.show();
await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
assert.ok(
  packagedChild.messages.some(
    (message) => message.type === "sync" && message.displays[0].visible,
  ),
  "the host sends full display snapshots over the helper pipe",
);
surface.close();
await host.stop();
assert.equal(
  removedExecutable,
  undefined,
  "idle stop keeps the verified helper cached",
);
await host.dispose();
assert.equal(
  removedExecutable,
  "/isolated/profile/native-helper",
  "host disposal removes its extracted helper",
);

let unsupportedPlatformFetched = false;
const unsupportedHost = new NativeDesktopEdgeOverlayHost({
  platform: "Linux",
  fetchResource: async () => {
    unsupportedPlatformFetched = true;
    throw new Error("Unsupported platforms must not fetch the helper.");
  },
});
await assert.rejects(unsupportedHost.prepare(), /available only on macOS/);
assert.equal(
  unsupportedPlatformFetched,
  false,
  "unsupported platforms fail before reading or launching the helper",
);
await unsupportedHost.dispose();

process.stdout.write(
  "Native overlay IPC checks passed: handshake, bounded versioning, snapshots/ACKs, latest-frame coalescing, ping, launch retry, timeout fail-closed, graceful shutdown, forced reap, manifest hash extraction, and surface lifecycle.\n",
);
