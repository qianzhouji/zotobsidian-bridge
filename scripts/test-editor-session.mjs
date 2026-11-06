import assert from "node:assert/strict";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import {
  acquireEditorSession,
  activeEditorSessionCount,
} from "../src/services/editor-session.ts";
import { observeWindowClose } from "../src/adapters/window-close-lifecycle.ts";
import { setEditorInputEnabled } from "../src/adapters/editor-input-state.ts";

// Status publications must not reset Gecko's caret or interrupt IME composition.
{
  let editable = "true";
  let changes = 0;
  const content = {
    get contentEditable() {
      return editable;
    },
    set contentEditable(value) {
      editable = value;
      changes++;
    },
  };
  const title = { disabled: false };
  for (let i = 0; i < 20; i++) setEditorInputEnabled(content, title, true);
  assert.equal(changes, 0, "unchanged editability does not reset selection");
  setEditorInputEnabled(content, title, false);
  assert.equal(title.disabled, true);
  for (let i = 0; i < 20; i++) setEditorInputEnabled(content, title, false);
  assert.equal(changes, 1, "another view composing disables input only once");
  setEditorInputEnabled(content, title, true);
  assert.equal(changes, 2);
  assert.equal(title.disabled, false);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeIdentity(
  cardID,
  vaultPath = "/vault-a",
  sourceID = "user:0/annotation/A",
) {
  return {
    vaultPath,
    cardID,
    sourceID,
    relativePath: `P01N01.md`,
  };
}

function makeAdapter({
  content,
  source = "source-v1",
  readDisk,
  save,
  getSaveOutcome,
} = {}) {
  const state = {
    content: content ?? { title: "", markdown: "initial" },
    source,
    draft: null,
    saveCalls: [],
    draftWrites: [],
  };
  return {
    state,
    adapter: {
      readDisk:
        readDisk ??
        (async () => ({
          content: { ...state.content },
          source: state.source,
        })),
      async readDraft() {
        return state.draft;
      },
      async writeDraft(draft) {
        state.draftWrites.push(clone(draft));
        state.draft = clone(draft);
      },
      async deleteDraft() {
        state.draft = null;
      },
      async getSaveOutcome(requestId) {
        if (!getSaveOutcome) return { status: "completed" };
        return getSaveOutcome(requestId, state);
      },
      async save(baseline, next, force = false) {
        state.saveCalls.push({
          baseline: { ...baseline },
          next: { ...next },
          force,
        });
        if (save) return save(baseline, next, force, state);
        state.content = { title: next.title.trim(), markdown: next.markdown };
        return { status: "saved" };
      },
    },
  };
}

// A draft write finishing during composition must publish the owner's latest text.
{
  const gate = deferred();
  const started = deferred();
  const fixture = makeAdapter({ content: { title: "", markdown: "base" } });
  const writeDraft = fixture.adapter.writeDraft;
  fixture.adapter.writeDraft = async (draft) => {
    started.resolve();
    await gate.promise;
    await writeDraft(draft);
  };
  const session = acquireEditorSession(
    makeIdentity("composition-draft-race"),
    fixture.adapter,
  );
  await session.initialize();
  const snapshots = [];
  const view = session.attachView((snapshot) => snapshots.push(snapshot));
  session.edit({ title: "", markdown: "base!" }, view.id);
  const flush = session.flushDraft();
  await started.promise;
  session.beginComposition(view.id);
  session.edit({ title: "", markdown: "base!你" }, view.id);
  gate.resolve();
  await flush;
  assert.equal(snapshots.at(-1).content.markdown, "base!你");
  assert.equal(snapshots.at(-1).compositionOwner, view.id);
  session.endComposition({ title: "", markdown: "base!你好" }, view.id);
  view.detach();
}

// A companion save that times out remains one in-flight request until ACK; polling must not duplicate it.
{
  const cardID = "12121212-1212-4212-8212-121212121212";
  let outcome = { status: "pending" };
  const adapter = makeAdapter({
    content: { title: "", markdown: "base" },
    save: async () => ({ status: "pending", requestId: "request-1" }),
    getSaveOutcome: async () => outcome,
  });
  const session = acquireEditorSession(makeIdentity(cardID), adapter.adapter);
  await session.initialize();
  session.edit({ title: "", markdown: "pending content" });
  await session.requestSave();
  assert.equal(session.snapshot().status, "pending");
  await session.poll();
  await session.poll();
  assert.equal(adapter.state.saveCalls.length, 1);
  assert.equal(session.snapshot().status, "pending");

  adapter.state.content = { title: "", markdown: "pending content" };
  outcome = { status: "applied", revision: "revision-1" };
  await session.poll();
  assert.equal(session.snapshot().status, "saved");
  assert.equal(adapter.state.saveCalls.length, 1);
  assert.equal(adapter.state.draft, null);
}

const id = "11111111-1111-4111-8111-111111111111";

// Zotero's addon sandbox lacks structuredClone, including while a save awaits ACK.
{
  const originalClone = globalThis.structuredClone;
  globalThis.structuredClone = undefined;
  try {
    const cardID = "13131313-1313-4313-8313-131313131313";
    let applied = false;
    const makePendingAdapter = () =>
      makeAdapter({
        content: { title: "", markdown: "base" },
        save: async (_baseline, next, _force, state) => {
          if (!applied) return { status: "pending", requestId: "pending-ack" };
          state.content = clone(next);
          return { status: "saved" };
        },
        getSaveOutcome: async () =>
          applied
            ? { status: "applied", revision: "ack-1" }
            : { status: "pending" },
      });
    const first = makePendingAdapter();
    const session = acquireEditorSession(makeIdentity(cardID), first.adapter);
    await session.initialize();
    session.edit({ title: "", markdown: "sent version" });
    await session.requestSave();
    assert.equal(session.snapshot().status, "pending");
    session.edit({ title: "", markdown: "newer local version" });
    await session.flushDraft();
    assert.equal(first.state.draft.draft.markdown, "newer local version");
    assert.equal(
      first.state.draft.pendingSave.snapshot.markdown,
      "sent version",
    );

    const restarted = makePendingAdapter();
    restarted.state.draft = clone(first.state.draft);
    const recovered = acquireEditorSession(
      makeIdentity(cardID, "/vault-without-structured-clone"),
      restarted.adapter,
    );
    await recovered.initialize();
    assert.equal(recovered.snapshot().status, "pending");
    assert.equal(recovered.snapshot().content.markdown, "newer local version");
    restarted.state.draft.pendingSave.snapshot.markdown =
      "mutated adapter data";
    applied = true;
    for (const [current, fixture] of [
      [session, first],
      [recovered, restarted],
    ]) {
      fixture.state.content = { title: "", markdown: "sent version" };
      await current.poll();
      await current.requestSave();
      assert.equal(current.snapshot().status, "saved");
      assert.equal(fixture.state.content.markdown, "newer local version");
    }
  } finally {
    globalThis.structuredClone = originalClone;
  }
}

// Ignore the initial blank-document unload; release only after the editor loads.
{
  const listeners = new Map();
  const target = {
    location: { href: "about:blank" },
    document: { readyState: "complete" },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
  };
  let closeCount = 0;
  observeWindowClose(
    target,
    "chrome://bridge/content/editor.xhtml",
    () => closeCount++,
  );
  target.dispatch("unload");
  assert.equal(closeCount, 0, "initial document unload is not observed");
  target.location.href = "chrome://bridge/content/editor.xhtml";
  target.document.readyState = "complete";
  target.dispatch("load");
  assert.equal(
    listeners.get("unload")?.size,
    1,
    "editor unload is observed after load",
  );
  target.dispatch("unload");
  assert.equal(closeCount, 1, "closing the loaded editor releases its lease");
}

// A window opening in another chrome context retains its session until its first view attaches.
{
  const cardID = "10101010-1010-4010-8010-101010101010";
  const adapter = makeAdapter({ content: { title: "", markdown: "base" } });
  const session = acquireEditorSession(makeIdentity(cardID), adapter.adapter);
  const release = session.retain();
  await session.initialize();
  session.edit({ title: "", markdown: "changed before view attach" });
  await session.requestSave();
  assert.equal(session.snapshot().status, "saved");
  assert.equal(
    (await session.initialize()).status,
    "saved",
    "a save completing before the editor view attaches cannot dispose a retained session",
  );
  release();
  assert.throws(
    () => session.initialize(),
    /Editor session is disposed/,
    "an idle session is collected after its window releases the lease",
  );
}

// Same vault/card/source identity resolves to one session; another vault does not.
{
  const first = makeAdapter();
  const sharedA = acquireEditorSession(makeIdentity(id), first.adapter);
  const sharedB = acquireEditorSession(makeIdentity(id), makeAdapter().adapter);
  const otherVault = acquireEditorSession(
    makeIdentity(id, "/vault-b"),
    makeAdapter().adapter,
  );
  assert.equal(sharedA, sharedB);
  assert.notEqual(sharedA, otherVault);
  await Promise.all([sharedA.initialize(), otherVault.initialize()]);
}

// Delayed loads for separate cards cannot publish into the other session/view.
{
  const cardA = "22222222-2222-4222-8222-222222222222";
  const cardB = "33333333-3333-4333-8333-333333333333";
  const delayedA = deferred();
  const delayedB = deferred();
  const sessionA = acquireEditorSession(
    makeIdentity(cardA),
    makeAdapter({ readDisk: () => delayedA.promise }).adapter,
  );
  const sessionB = acquireEditorSession(
    makeIdentity(cardB),
    makeAdapter({ readDisk: () => delayedB.promise }).adapter,
  );
  const loadA1 = sessionA.initialize();
  const loadA2 = sessionA.initialize();
  const loadB = sessionB.initialize();
  delayedB.resolve({
    content: { title: "B", markdown: "card B" },
    source: "b",
  });
  await loadB;
  delayedA.resolve({
    content: { title: "A", markdown: "card A" },
    source: "a",
  });
  await Promise.all([loadA1, loadA2]);
  assert.deepEqual(sessionA.snapshot().content, {
    title: "A",
    markdown: "card A",
  });
  assert.deepEqual(sessionB.snapshot().content, {
    title: "B",
    markdown: "card B",
  });
}

// An older save ACK cannot clear a newer edit; the session serializes the next save.
{
  const cardID = "44444444-4444-4444-8444-444444444444";
  const firstStarted = deferred();
  const firstGate = deferred();
  const secondStarted = deferred();
  const adapter = makeAdapter({
    content: { title: "", markdown: "base" },
    save: async (_baseline, next, _force, state) => {
      if (state.saveCalls.length === 1) {
        firstStarted.resolve(next);
        await firstGate.promise;
        state.content = { ...next };
        return { status: "saved" };
      }
      secondStarted.resolve(next);
      state.content = { ...next };
      return { status: "saved" };
    },
  });
  const session = acquireEditorSession(makeIdentity(cardID), adapter.adapter);
  await session.initialize();
  session.edit({ title: "", markdown: "first" });
  const saving = session.requestSave();
  await firstStarted.promise;
  await delay(0);
  session.edit({ title: "", markdown: "second" });
  firstGate.resolve();
  const second = await secondStarted.promise;
  assert.equal(second.markdown, "second");
  await saving;
  assert.equal(adapter.state.content.markdown, "second");
  assert.equal(adapter.state.draft, null);
  assert.deepEqual(
    adapter.state.saveCalls.map((call) => call.next.markdown),
    ["first", "second"],
  );
}

// Detaching the only view flushes and saves through the still-live session.
{
  const cardID = "55555555-5555-4555-8555-555555555555";
  const adapter = makeAdapter({ content: { title: "", markdown: "before" } });
  const session = acquireEditorSession(makeIdentity(cardID), adapter.adapter);
  await session.initialize();
  let attachedSnapshot;
  const view = session.attachView((snapshot) => {
    attachedSnapshot = snapshot;
  });
  session.edit({ title: "", markdown: "after" });
  view.detach();
  await session.requestSave();
  assert.equal(attachedSnapshot.content.markdown, "after");
  assert.equal(adapter.state.content.markdown, "after");
  assert.equal(adapter.state.draft, null);
}

// A deleted or unreadable card cannot be mistaken for an empty note to overwrite.
{
  const cardID = "66666666-6666-4666-8666-666666666666";
  const adapter = makeAdapter({
    readDisk: async () => {
      throw new Error("Card not found");
    },
  });
  const session = acquireEditorSession(makeIdentity(cardID), adapter.adapter);
  await assert.rejects(session.initialize(), /Card not found/);
  assert.equal(adapter.state.saveCalls.length, 0);
}

// Drafts survive a detached view and recover with their source identity intact.
{
  const cardID = "77777777-7777-4777-8777-777777777777";
  const identity = makeIdentity(cardID);
  const adapter = makeAdapter({ content: { title: "", markdown: "base" } });
  const session = acquireEditorSession(identity, adapter.adapter);
  await session.initialize();
  session.edit({ title: "draft title", markdown: "offline draft" });
  await session.flushDraft();
  const currentDraft = clone(adapter.state.draft);
  assert.equal(currentDraft.cardID, cardID);
  assert.equal(currentDraft.sourceID, identity.sourceID);
  assert.equal(currentDraft.draft.markdown, "offline draft");
}

// A detached then reattached view reuses the same session and latest snapshot.
{
  const cardID = "88888888-8888-4888-8888-888888888888";
  const adapter = makeAdapter({ content: { title: "", markdown: "base" } });
  const identity = makeIdentity(cardID);
  const session = acquireEditorSession(identity, adapter.adapter);
  await session.initialize();
  const firstView = session.attachView(() => {});
  session.edit({ title: "", markdown: "latest" });
  firstView.detach();
  await session.flushDraft();
  let remounted;
  const second = acquireEditorSession(identity, makeAdapter().adapter);
  assert.equal(second, session);
  const secondView = second.attachView((snapshot) => {
    remounted = snapshot;
  });
  assert.equal(remounted.content.markdown, "latest");
  secondView.detach();
  await session.requestSave();
}

// Multiple views share one snapshot and IME composition excludes sibling edits.
{
  const cardID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const adapter = makeAdapter({ content: { title: "", markdown: "base" } });
  const session = acquireEditorSession(makeIdentity(cardID), adapter.adapter);
  await session.initialize();
  const viewA = session.attachView(() => {});
  const viewB = session.attachView(() => {});
  assert.equal(session.beginComposition(viewA.id), true);
  assert.equal(
    session.edit({ title: "", markdown: "sibling overwrite" }, viewB.id),
    false,
  );
  session.endComposition({ title: "", markdown: "IME result" }, viewA.id);
  assert.equal(session.snapshot().content.markdown, "IME result");
  assert.equal(session.snapshot().composing, false);
  viewA.detach();
  viewB.detach();
  await session.requestSave();
  assert.equal(adapter.state.content.markdown, "IME result");
}

// Repeated views share exactly one poll timer and detached views stop receiving updates.
{
  const cardID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const adapter = makeAdapter({ content: { title: "", markdown: "base" } });
  const session = acquireEditorSession(makeIdentity(cardID), adapter.adapter);
  await session.initialize();
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let intervalsStarted = 0;
  let intervalsCleared = 0;
  globalThis.setInterval = () => {
    intervalsStarted++;
    return intervalsStarted;
  };
  globalThis.clearInterval = () => {
    intervalsCleared++;
  };
  try {
    let firstUpdates = 0;
    let secondUpdates = 0;
    let thirdUpdates = 0;
    const first = session.attachView(() => firstUpdates++);
    const second = session.attachView(() => secondUpdates++);
    assert.equal(intervalsStarted, 1);
    session.edit({ title: "", markdown: "one shared update" });
    assert.equal(firstUpdates, 2);
    assert.equal(secondUpdates, 2);
    first.detach();
    const third = session.attachView(() => thirdUpdates++);
    assert.equal(intervalsStarted, 1);
    session.edit({ title: "", markdown: "next shared update" });
    assert.equal(firstUpdates, 2);
    assert.equal(secondUpdates, 3);
    assert.equal(thirdUpdates, 2);
    second.detach();
    assert.equal(intervalsCleared, 0);
    third.detach();
    assert.equal(intervalsCleared, 1);
    const last = session.attachView(() => {});
    assert.equal(intervalsStarted, 2);
    last.detach();
    assert.equal(intervalsCleared, 2);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
  await session.requestSave();
  assert.equal(adapter.state.content.markdown, "next shared update");
}

// Conflict resolution and normal saves use the same serialized write queue.
{
  const cardID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const firstStarted = deferred();
  const firstGate = deferred();
  let activeSaves = 0;
  let maxActiveSaves = 0;
  const adapter = makeAdapter({
    content: { title: "", markdown: "base" },
    save: async (_baseline, next, force, state) => {
      activeSaves++;
      maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
      if (force) {
        firstStarted.resolve();
        await firstGate.promise;
      }
      state.content = { ...next };
      activeSaves--;
      return { status: "saved" };
    },
  });
  const session = acquireEditorSession(makeIdentity(cardID), adapter.adapter);
  await session.initialize();
  session.edit({ title: "", markdown: "kept local" });
  const resolving = session.keepLocal(
    { title: "", markdown: "external" },
    { title: "", markdown: "kept local" },
  );
  await firstStarted.promise;
  session.edit({ title: "", markdown: "newer edit" });
  const savingNewerEdit = session.requestSave();
  firstGate.resolve();
  await Promise.all([resolving, savingNewerEdit]);
  assert.equal(maxActiveSaves, 1);
  assert.equal(adapter.state.content.markdown, "newer edit");
}

// A conflict action based on an old view revision cannot discard newer typing.
{
  const cardID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const adapter = makeAdapter({ content: { title: "", markdown: "base" } });
  const session = acquireEditorSession(makeIdentity(cardID), adapter.adapter);
  await session.initialize();
  session.edit({ title: "", markdown: "captured local" });
  const expectedRevision = session.snapshot().revision;
  const resolution = session.keepLocal(
    { title: "", markdown: "disk" },
    { title: "", markdown: "captured local" },
    expectedRevision,
  );
  session.edit({ title: "", markdown: "typed during resolution" });
  await assert.rejects(resolution, /Editor changed while resolving/);
  assert.equal(adapter.state.saveCalls.length, 0);
  await session.requestSave();
  assert.equal(adapter.state.content.markdown, "typed during resolution");
}

// Reverting to baseline while a draft write is in flight removes stale recovery data.
{
  const cardID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const writeStarted = deferred();
  const writeGate = deferred();
  const adapter = makeAdapter({ content: { title: "", markdown: "base" } });
  const writeDraft = adapter.adapter.writeDraft;
  adapter.adapter.writeDraft = async (draft) => {
    writeStarted.resolve();
    await writeGate.promise;
    await writeDraft(draft);
  };
  const session = acquireEditorSession(makeIdentity(cardID), adapter.adapter);
  await session.initialize();
  session.edit({ title: "", markdown: "temporary draft" });
  const flushing = session.flushDraft();
  await writeStarted.promise;
  session.edit({ title: "", markdown: "base" });
  writeGate.resolve();
  await flushing;
  assert.equal(adapter.state.draft, null);
  await session.requestSave();
}

// External changes while local content is dirty become a recoverable conflict.
{
  const cardID = "99999999-9999-4999-8999-999999999999";
  const adapter = makeAdapter({ content: { title: "", markdown: "base" } });
  const session = acquireEditorSession(makeIdentity(cardID), adapter.adapter);
  await session.initialize();
  session.edit({ title: "", markdown: "local" });
  adapter.state.content = { title: "", markdown: "external" };
  await session.poll();
  const snapshot = session.snapshot();
  assert.equal(snapshot.status, "conflict");
  assert.equal(snapshot.conflict.disk.markdown, "external");
  assert.equal(snapshot.content.markdown, "local");
  assert.equal(adapter.state.draft.draft.markdown, "local");
}

// Returning to the old baseline during a conflict still preserves the local side.
{
  const cardID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const adapter = makeAdapter({ content: { title: "", markdown: "base" } });
  const session = acquireEditorSession(makeIdentity(cardID), adapter.adapter);
  await session.initialize();
  session.edit({ title: "", markdown: "local change" });
  adapter.state.content = { title: "", markdown: "external change" };
  await session.poll();
  assert.equal(session.snapshot().status, "conflict");
  session.edit({ title: "", markdown: "base" });
  await session.flushDraft();
  assert.equal(adapter.state.draft.draft.markdown, "base");
  assert.equal(session.snapshot().conflict.local.markdown, "base");

  const recoveredAdapter = makeAdapter({
    content: { title: "", markdown: "external change" },
  });
  recoveredAdapter.state.draft = clone(adapter.state.draft);
  const recovered = acquireEditorSession(
    makeIdentity(cardID, "/vault-restarted"),
    recoveredAdapter.adapter,
  );
  await recovered.initialize();
  assert.equal(recovered.snapshot().status, "conflict");
  assert.equal(recovered.snapshot().content.markdown, "base");
}

assert.ok(activeEditorSessionCount() >= 5);
process.stdout.write("Editor session lifecycle and race tests passed.\n");
