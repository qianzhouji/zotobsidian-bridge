import assert from "node:assert/strict";
import { stdout } from "node:process";
import { parseHTML } from "linkedom";
import { DesktopCardWindowRegistry } from "../src/core/desktop-card-window-registry.ts";
import {
  getDesktopWindowRegistration,
  makeDesktopGroupIdentity,
} from "../src/services/desktop-window-registry.ts";
import { createDesktopWindowHost } from "../src/adapters/desktop-window-host.ts";
import {
  installManagedCardWindowKeyboard,
  ManagedWindowFocusGroup,
} from "../src/adapters/managed-window-focus.ts";
import { DesktopCardWindowGroup } from "../src/services/desktop-card-window-group.ts";

const identity = (overrides = {}) => ({
  profileInstanceId: "profile-c",
  ownerWindowId: "reader-1",
  rootSessionId: "root-session-1",
  groupId: "group-1",
  vaultId: "vault-c",
  pairingEpoch: "epoch-1",
  canonicalPath: "Mathematics/Bayes.md",
  ...overrides,
});

const registry = new DesktopCardWindowRegistry(2, 3);
const first = registry.reserve(identity());
assert.equal(first.status, "reserved");
assert.equal(registry.reserve(identity()).status, "existing");
assert.equal(
  registry.transition(first.lease.id, first.lease.generation, "ready"),
  true,
);
assert.equal(
  registry.transition(first.lease.id, first.lease.generation, "opening"),
  false,
);

const second = registry.reserve(
  identity({ canonicalPath: "Physics/Motion.md" }),
);
assert.equal(second.status, "reserved");
assert.equal(
  registry.reserve(identity({ canonicalPath: "Cycles/A.md" })).status,
  "group-limit",
);
assert.equal(registry.countGroup(identity()), 2);

const third = registry.reserve(
  identity({ groupId: "group-2", canonicalPath: "Mathematics/Bayes.md" }),
);
assert.equal(third.status, "reserved");
assert.equal(
  registry.reserve(
    identity({ groupId: "group-3", canonicalPath: "Physics/Motion.md" }),
  ).status,
  "owner-limit",
);

const closing = registry.beginGroupClose({
  profileInstanceId: "profile-c",
  ownerWindowId: "reader-1",
  rootSessionId: "root-session-1",
  groupId: "group-1",
  vaultId: "vault-c",
  pairingEpoch: "epoch-1",
});
assert.equal(closing.length, 2);
assert.ok(closing.every((lease) => lease.state === "closing"));
assert.equal(
  registry.transition(first.lease.id, first.lease.generation, "ready"),
  false,
  "a late ready event cannot resurrect a closing window",
);
assert.equal(
  registry.transition(first.lease.id, first.lease.generation, "closed"),
  true,
);
assert.equal(registry.countGroup(identity()), 1);
assert.equal(registry.release(first.lease.id, first.lease.generation), false);

const retryRegistry = new DesktopCardWindowRegistry(1, 1);
const failed = retryRegistry.reserve(identity());
assert.equal(failed.status, "reserved");
assert.equal(
  retryRegistry.transition(failed.lease.id, failed.lease.generation, "failed"),
  true,
);
const retried = retryRegistry.reserve(identity());
assert.equal(retried.status, "reserved");
assert.notEqual(retried.lease.generation, failed.lease.generation);
assert.equal(retryRegistry.countOwner("profile-c", "reader-1"), 1);

const { window: registryRoot } = parseHTML("<html><body></body></html>");
const { window: firstFrame } = parseHTML("<html><body></body></html>");
const { window: secondFrame } = parseHTML("<html><body></body></html>");
Object.defineProperty(firstFrame, "top", { value: registryRoot });
Object.defineProperty(secondFrame, "top", { value: registryRoot });
const previousZotero = globalThis.Zotero;
globalThis.Zotero = { getMainWindow: () => registryRoot };
const frameRegistrationA = getDesktopWindowRegistration(firstFrame);
const frameRegistrationB = getDesktopWindowRegistration(secondFrame);
assert.strictEqual(
  frameRegistrationA.registry,
  frameRegistrationB.registry,
  "frame surfaces share the registry stored on Zotero's main window",
);
assert.equal(
  frameRegistrationA.ownerWindowId,
  frameRegistrationB.ownerWindowId,
);
const registrationScope = { vaultId: "vault-shared", pairingEpoch: "epoch-7" };
const groupA = makeDesktopGroupIdentity(
  firstFrame,
  "group-a",
  registrationScope,
);
const groupB = makeDesktopGroupIdentity(
  secondFrame,
  "group-b",
  registrationScope,
);
for (let index = 0; index < 8; index++) {
  assert.equal(
    frameRegistrationA.registry.reserve({
      ...groupA,
      canonicalPath: `pending:a:${index}`,
    }).status,
    "reserved",
  );
}
for (let index = 0; index < 8; index++) {
  assert.equal(
    frameRegistrationB.registry.reserve({
      ...groupB,
      canonicalPath: `pending:b:${index}`,
    }).status,
    "reserved",
  );
}
const groupC = makeDesktopGroupIdentity(
  firstFrame,
  "group-c",
  registrationScope,
);
assert.equal(
  frameRegistrationA.registry.reserve({
    ...groupC,
    canonicalPath: "pending:c:0",
  }).status,
  "owner-limit",
  "pending inline and desktop windows share the same owner cap",
);
assert.equal(frameRegistrationA.registry.countGroup(groupA), 8);
assert.equal(
  frameRegistrationA.registry.countOwner(
    frameRegistrationA.profileInstanceId,
    frameRegistrationA.ownerWindowId,
  ),
  16,
);
for (const lease of [
  ...Array.from({ length: 8 }, (_, index) =>
    frameRegistrationA.registry.reserve({
      ...groupA,
      canonicalPath: `pending:a:${index}`,
    }),
  ),
  ...Array.from({ length: 8 }, (_, index) =>
    frameRegistrationA.registry.reserve({
      ...groupB,
      canonicalPath: `pending:b:${index}`,
    }),
  ),
]) {
  assert.equal(lease.status, "existing");
  const active = frameRegistrationA.registry.get(lease.lease.id);
  assert.ok(active);
  frameRegistrationA.registry.transition(
    active.id,
    active.generation,
    "closing",
  );
  frameRegistrationA.registry.transition(
    active.id,
    active.generation,
    "closed",
  );
}
assert.equal(
  frameRegistrationA.registry.countOwner(
    frameRegistrationA.profileInstanceId,
    frameRegistrationA.ownerWindowId,
  ),
  0,
  "closing all leases releases shared capacity",
);
if (previousZotero === undefined) delete globalThis.Zotero;
else globalThis.Zotero = previousZotero;

const { window } = parseHTML("<html><body></body></html>");
let openArguments;
window.openDialog = (...args) => {
  openArguments = args;
  return window;
};
const host = createDesktopWindowHost(window, "zoteroobsidianbridge");
assert.equal(
  host.open({
    url: "chrome://zoteroobsidianbridge/content/desktop-window-prototype.xhtml",
    name: "prototype",
    args: [{ fixture: true }],
  }),
  window,
);
assert.equal(openArguments[1], "prototype");
assert.equal(openArguments.at(-1).fixture, true);
assert.throws(
  () =>
    host.open({
      url: "https://example.org/",
      name: "external",
      args: [],
    }),
  /packaged add-on content/,
);

const child = parseHTML("<html><body></body></html>").window;
const scheduled = [];
let entered = 0;
let left = 0;
const focusGroup = new ManagedWindowFocusGroup(window, {
  onEnterGroup: () => entered++,
  onLeaveGroup: () => left++,
  setTimer(callback) {
    const timer = { callback };
    scheduled.push(timer);
    return timer;
  },
  clearTimer(timer) {
    const index = scheduled.indexOf(timer);
    if (index >= 0) scheduled.splice(index, 1);
  },
});
focusGroup.add(child);
window.dispatchEvent(new window.Event("focus"));
for (let index = 0; index < 50; index++) {
  const current = index % 2 === 0 ? window : child;
  const next = index % 2 === 0 ? child : window;
  current.dispatchEvent(new current.Event("blur"));
  next.dispatchEvent(new next.Event("focus"));
  assert.equal(
    scheduled.length,
    0,
    "focus transfer to a managed sibling window is retained",
  );
}
assert.equal(entered, 1, "50 root/child transfers remain one active group");
window.dispatchEvent(new window.Event("blur"));
scheduled.shift().callback();
assert.equal(left, 1, "leaving the managed window group is reported once");
assert.equal(focusGroup.contains(child), true);
focusGroup.dispose();
assert.equal(focusGroup.contains(child), false);

const keyEvent = new window.Event("keydown", { cancelable: true });
Object.defineProperties(keyEvent, {
  key: { value: "w" },
  metaKey: { value: true },
  ctrlKey: { value: false },
  altKey: { value: false },
  shiftKey: { value: false },
});
let closeCount = 0;
const removeKeyboard = installManagedCardWindowKeyboard(
  window,
  () => closeCount++,
);
window.dispatchEvent(keyEvent);
assert.equal(keyEvent.defaultPrevented, true);
assert.equal(closeCount, 1, "Cmd+W closes only the current managed window");

const deleteEvent = new window.Event("keydown", { cancelable: true });
Object.defineProperties(deleteEvent, { key: { value: "Backspace" } });
window.dispatchEvent(deleteEvent);
assert.equal(deleteEvent.defaultPrevented, true);
removeKeyboard();

function makeWindow() {
  let { window: nativeWindow } = parseHTML(
    '<html><body><main id="prototype" data-ready="false"></main></body></html>',
  );
  let closed = false;
  let focusCount = 0;
  let frameSequence = 0;
  const animationFrames = new Map();
  const location = { href: "fixture:uninitialized" };
  return {
    location,
    get document() {
      return nativeWindow.document;
    },
    get Event() {
      return nativeWindow.Event;
    },
    addEventListener: (...args) => nativeWindow.addEventListener(...args),
    removeEventListener: (...args) => nativeWindow.removeEventListener(...args),
    dispatchEvent: (...args) => nativeWindow.dispatchEvent(...args),
    navigate(url) {
      nativeWindow.dispatchEvent(new nativeWindow.Event("unload"));
      nativeWindow = parseHTML(
        '<html><body><main id="prototype" data-ready="true"></main></body></html>',
      ).window;
      location.href = url;
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame(callback) {
      const id = ++frameSequence;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
    flushAnimationFrames(timestamp = 0) {
      const pending = [...animationFrames.values()];
      animationFrames.clear();
      for (const callback of pending) callback(timestamp);
    },
    get pendingAnimationFrameCount() {
      return animationFrames.size;
    },
    get closed() {
      return closed;
    },
    get focusCount() {
      return focusCount;
    },
    focus() {
      focusCount++;
    },
    close() {
      if (closed) return;
      closed = true;
      nativeWindow.dispatchEvent(new nativeWindow.Event("unload"));
    },
  };
}

function makeGroup({
  child,
  timers = new Map(),
  failures = [],
  closed = [],
  hostMethods = {},
  geometryChanges = [],
  geometryFrames = [],
} = {}) {
  const owner = makeWindow();
  const groupRegistry = new DesktopCardWindowRegistry(2, 3);
  let timerSequence = 0;
  const group = new DesktopCardWindowGroup({
    owner,
    identity: {
      profileInstanceId: "profile-c",
      ownerWindowId: "reader-host",
      rootSessionId: "session-c",
      groupId: "group-c",
      vaultId: "vault-c",
      pairingEpoch: "epoch-c",
    },
    registry: groupRegistry,
    host: {
      open(options) {
        if (child.location.href === "fixture:uninitialized")
          child.location.href = options.url;
        return child;
      },
      ...hostMethods,
    },
    openOptions: (path) => ({ url: `fixture:${path}`, name: path, args: [] }),
    readyTimeoutMs: 1000,
    setTimer(callback, delay) {
      const id = ++timerSequence;
      callback.delay = delay;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    onFailure: (_path, error) => failures.push(error),
    onWindowClosed: (lease) => closed.push(lease.identity.canonicalPath),
    onGeometryChanged: () => geometryChanges.push(true),
    onGeometryFrame: () => geometryFrames.push(true),
  });
  return {
    owner,
    group,
    groupRegistry,
    timers,
    failures,
    closed,
    geometryChanges,
    geometryFrames,
  };
}

const groupIdentity = {
  profileInstanceId: "profile-c",
  ownerWindowId: "reader-host",
  rootSessionId: "session-c",
  groupId: "group-c",
  vaultId: "vault-c",
  pairingEpoch: "epoch-c",
};

// openDialog may unload about:blank before loading the packaged document.
const navigatingChild = makeWindow();
navigatingChild.location.href = "about:blank";
const navigatingHarness = makeGroup({ child: navigatingChild });
const navigatingLease = navigatingHarness.group.open("Mathematics/Bayes.md");
navigatingChild.dispatchEvent(new navigatingChild.Event("unload"));
assert.equal(
  navigatingHarness.groupRegistry.get(navigatingLease.lease.id)?.state,
  "opening",
  "the initial blank-document unload must not retire the live native window",
);
navigatingChild.navigate("fixture:Mathematics/Bayes.md");
const [pollID, pollReady] = [...navigatingHarness.timers].find(
  ([, callback]) => callback.delay === 50,
);
navigatingHarness.timers.delete(pollID);
pollReady();
assert.equal(await navigatingLease.ready, navigatingChild);
assert.equal(
  navigatingHarness.groupRegistry.get(navigatingLease.lease.id)?.state,
  "ready",
  "owner polling recovers readiness after the initial document listeners disappear",
);
assert.equal(navigatingHarness.timers.size, 0);
const navigatedClose = new navigatingChild.Event("keydown", {
  cancelable: true,
});
Object.defineProperties(navigatedClose, {
  key: { value: "w" },
  metaKey: { value: true },
});
navigatingChild.dispatchEvent(navigatedClose);
assert.equal(navigatingChild.closed, true);
assert.deepEqual(navigatingHarness.closed, ["Mathematics/Bayes.md"]);
assert.equal(navigatingHarness.groupRegistry.countGroup(groupIdentity), 0);
navigatingHarness.group.dispose();

const readyChild = makeWindow();
const geometryArea = { left: -1000, top: 24, width: 1000, height: 700 };
const geometryRects = new WeakMap();
geometryRects.set(readyChild, {
  left: -2200,
  top: -200,
  width: 480,
  height: 360,
});
const readyHarness = makeGroup({
  child: readyChild,
  hostMethods: {
    getWindowRect(window) {
      return (
        geometryRects.get(window) ?? {
          left: -900,
          top: 80,
          width: 700,
          height: 500,
        }
      );
    },
    getAvailableScreenArea() {
      return geometryArea;
    },
    setWindowRect(window, rect) {
      geometryRects.set(window, rect);
    },
  },
});
const rootLease = readyHarness.group.open("Mathematics/Bayes.md");
assert.equal(rootLease.status, "reserved");
assert.equal(
  readyHarness.groupRegistry.get(rootLease.lease.id).state,
  "opening",
);
const duplicateLease = readyHarness.group.open("Mathematics/Bayes.md");
assert.equal(duplicateLease.status, "existing");
assert.equal(
  readyChild.focusCount,
  1,
  "duplicate opens focus the existing native window",
);
readyChild.document
  .getElementById("prototype")
  .setAttribute("data-ready", "true");
readyChild.dispatchEvent(new readyChild.Event("desktop-card-ready"));
assert.equal(readyHarness.groupRegistry.get(rootLease.lease.id).state, "ready");
assert.deepEqual(
  geometryRects.get(readyChild),
  { left: -1000, top: 24, width: 480, height: 360 },
  "a persisted off-screen window is clamped to its real monitor on ready",
);
assert.ok(
  readyChild.pendingAnimationFrameCount > 0,
  "the geometry sampler starts on the detached card's display frame loop",
);
let scheduledGeometryPaint = 0;
readyHarness.group.requestGeometryFrame(() => scheduledGeometryPaint++);
assert.equal(
  readyHarness.owner.pendingAnimationFrameCount,
  0,
  "geometry painting does not depend on the Reader owner's frame loop",
);
const geometryFrameCount = readyHarness.geometryFrames.length;
const geometryChangeCount = readyHarness.geometryChanges.length;
geometryRects.set(readyChild, {
  left: -850,
  top: 90,
  width: 480,
  height: 360,
});
readyChild.flushAnimationFrames();
assert.equal(
  readyHarness.geometryFrames.length,
  geometryFrameCount + 1,
  "frame-based geometry polling refreshes overlay lines in the same display frame",
);
assert.equal(
  readyHarness.geometryChanges.length,
  geometryChangeCount,
  "same-frame polling does not schedule a redundant later repaint",
);
assert.ok(
  readyChild.pendingAnimationFrameCount > 0,
  "geometry polling remains on the card frame loop while a child is open",
);
assert.equal(scheduledGeometryPaint, 1);
geometryRects.set(readyChild, {
  left: -5000,
  top: -3000,
  width: 480,
  height: 360,
});
const moveEventFrameCount = readyHarness.geometryFrames.length;
readyChild.dispatchEvent(new readyChild.Event("move"));
assert.equal(
  readyHarness.geometryFrames.length,
  moveEventFrameCount + 1,
  "native move events repaint changed geometry immediately without waiting for a later frame",
);
const geometryTimer = [...readyHarness.timers].find(
  ([, callback]) => callback.delay === 100,
);
assert.ok(
  geometryTimer,
  "native move events schedule a bounded geometry check",
);
readyHarness.timers.delete(geometryTimer[0]);
geometryTimer[1]();
assert.deepEqual(
  geometryRects.get(readyChild),
  { left: -1000, top: 24, width: 480, height: 360 },
  "dragging beyond available desktop bounds remains recoverable",
);
const childCloseEvent = new readyChild.Event("keydown", { cancelable: true });
Object.defineProperties(childCloseEvent, {
  key: { value: "w" },
  metaKey: { value: true },
  ctrlKey: { value: false },
  altKey: { value: false },
  shiftKey: { value: false },
});
readyChild.dispatchEvent(childCloseEvent);
assert.equal(childCloseEvent.defaultPrevented, true);
assert.equal(readyChild.closed, true);
assert.deepEqual(readyHarness.closed, ["Mathematics/Bayes.md"]);
assert.equal(
  readyChild.pendingAnimationFrameCount > 0,
  false,
  "the geometry frame loop stops after the final desktop card closes",
);
assert.equal(
  readyHarness.owner.closed,
  false,
  "Cmd+W closes only the managed child",
);
assert.equal(readyHarness.groupRegistry.countGroup(groupIdentity), 0);
readyHarness.group.dispose();

const pendingChild = makeWindow();
const pendingHarness = makeGroup({ child: pendingChild });
const pendingLease = pendingHarness.group.open("Physics/Motion.md");
pendingHarness.group.close(pendingLease.lease.id);
await assert.rejects(pendingLease.ready, /closed before ready/);
pendingChild.document
  .getElementById("prototype")
  .setAttribute("data-ready", "true");
pendingChild.dispatchEvent(new pendingChild.Event("desktop-card-ready"));
assert.equal(pendingHarness.groupRegistry.countGroup(groupIdentity), 0);
assert.equal(
  pendingHarness.groupRegistry.get(pendingLease.lease.id),
  undefined,
);
pendingHarness.group.dispose();

const earlyClosedChild = makeWindow();
earlyClosedChild.location.href = "about:blank";
const earlyClosedHarness = makeGroup({ child: earlyClosedChild });
const earlyClosedLease = earlyClosedHarness.group.open("Physics/EarlyClose.md");
earlyClosedChild.close();
const [earlyPollID, earlyPoll] = [...earlyClosedHarness.timers].find(
  ([, callback]) => callback.delay === 50,
);
earlyClosedHarness.timers.delete(earlyPollID);
earlyPoll();
await assert.rejects(earlyClosedLease.ready, /closed before ready/);
assert.equal(earlyClosedHarness.groupRegistry.countGroup(groupIdentity), 0);
assert.equal(earlyClosedHarness.timers.size, 0);
assert.deepEqual(earlyClosedHarness.closed, ["Physics/EarlyClose.md"]);
earlyClosedHarness.group.dispose();

const failedNavigationChild = makeWindow();
failedNavigationChild.location.href = "about:blank";
const failedNavigationHarness = makeGroup({ child: failedNavigationChild });
const failedNavigationLease =
  failedNavigationHarness.group.open("Cycles/Failed.md");
failedNavigationChild.navigate("fixture:Cycles/Failed.md");
failedNavigationChild.document
  .getElementById("prototype")
  .setAttribute("data-ready", "failed");
const [failedPollID, failedPoll] = [...failedNavigationHarness.timers].find(
  ([, callback]) => callback.delay === 50,
);
failedNavigationHarness.timers.delete(failedPollID);
failedPoll();
await assert.rejects(failedNavigationLease.ready, /initialization failed/);
assert.equal(failedNavigationChild.closed, true);
assert.equal(
  failedNavigationHarness.groupRegistry.countGroup(groupIdentity),
  0,
);
assert.equal(failedNavigationHarness.timers.size, 0);
failedNavigationHarness.group.dispose();

const timeoutChild = makeWindow();
const timeoutHarness = makeGroup({ child: timeoutChild });
timeoutHarness.group.open("Mathematics/Timeout.md");
assert.equal(timeoutHarness.timers.size, 2);
timeoutHarness.timers.values().next().value();
assert.equal(timeoutChild.closed, true);
assert.equal(timeoutHarness.groupRegistry.countGroup(groupIdentity), 0);
assert.match(timeoutHarness.failures[0], /timeout/);
timeoutHarness.group.dispose();

const failureChild = makeWindow();
const failureHarness = makeGroup({ child: failureChild });
failureHarness.group.open("Mathematics/Failure.md");
failureChild.dispatchEvent(new failureChild.Event("desktop-card-failed"));
assert.equal(failureChild.closed, true);
assert.equal(failureHarness.groupRegistry.countGroup(groupIdentity), 0);
assert.match(failureHarness.failures[0], /initialization failed/);
failureHarness.group.dispose();

const unloadChild = makeWindow();
const unloadHarness = makeGroup({ child: unloadChild });
unloadHarness.group.open("Physics/Unload.md");
unloadHarness.owner.dispatchEvent(new unloadHarness.owner.Event("unload"));
assert.equal(unloadChild.closed, true);
assert.equal(unloadHarness.groupRegistry.countGroup(groupIdentity), 0);

for (const host of [
  { open: () => null },
  {
    open() {
      throw new Error("synthetic open failure");
    },
  },
]) {
  const owner = makeWindow();
  const failedRegistry = new DesktopCardWindowRegistry(1, 1);
  const failedGroup = new DesktopCardWindowGroup({
    owner,
    identity: groupIdentity,
    registry: failedRegistry,
    host,
    openOptions: (path) => ({ url: `fixture:${path}`, name: path, args: [] }),
  });
  assert.throws(() => failedGroup.open("Cycles/OpenFailure.md"));
  assert.equal(failedRegistry.countGroup(groupIdentity), 0);
  failedGroup.dispose();
}

stdout.write(
  "Desktop window host checks passed: identity reuse, quotas, late events, frame-driven geometry polling, ready/timeout/failure cleanup, owner unload, focus transfer and local keyboard handling.\n",
);
