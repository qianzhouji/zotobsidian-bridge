import assert from "node:assert/strict";
import process from "node:process";
import { mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EditorSession } from "../src/services/editor-session.ts";
import { readEditorDraft } from "../src/adapters/editor-drafts.ts";
const { structuredClone } = globalThis;

// Drive every transition explicitly; no background timer may hide a failed assertion.
globalThis.setTimeout = () => 1;
globalThis.clearTimeout = () => {};
globalThis.setInterval = () => 1;
globalThis.clearInterval = () => {};
const content = (markdown) => ({ title: "", markdown });
const requestId = "12121212-1212-4212-8212-121212121212";
const identity = {
  vaultPath: "/b5-fixture",
  cardID: "34343434-3434-4434-8434-343434343434",
  sourceID: "user:0/annotation/B5",
  relativePath: "P01N01.md",
};
function fixture() {
  const state = {
    disk: content("base"),
    draft: null,
    calls: 0,
    outcome: { status: "pending" },
    unreadable: false,
  };
  const adapter = {
    async readDisk() {
      if (state.unreadable) throw new Error("Vault unavailable");
      return { content: structuredClone(state.disk), source: "source" };
    },
    async readDraft() {
      return structuredClone(state.draft);
    },
    async writeDraft(value) {
      state.draft = structuredClone(value);
    },
    async deleteDraft() {
      state.draft = null;
    },
    async save() {
      state.calls++;
      return { status: "pending", requestId };
    },
    async getSaveOutcome() {
      return state.outcome;
    },
  };
  const create = () => new EditorSession(identity, adapter, "b5");
  return { state, adapter, create };
}
async function pending(f) {
  const session = f.create();
  await session.initialize();
  session.edit(content("local"));
  await session.requestSave();
  return session;
}

// Use real files and separate OS processes to verify the persisted request link.
if (process.argv[2] === "--child") {
  const [directory, stage] = process.argv.slice(3);
  const f = fixture();
  const draftPath = join(directory, "draft.json");
  const diskPath = join(directory, "card.json");
  f.adapter.readDisk = async () => ({
    content: JSON.parse(await readFile(diskPath, "utf8")),
    source: "source",
  });
  f.adapter.readDraft = async () => {
    try {
      return JSON.parse(await readFile(draftPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  };
  f.adapter.writeDraft = async (value) => {
    await writeFile(`${draftPath}.tmp`, JSON.stringify(value));
    await rename(`${draftPath}.tmp`, draftPath);
  };
  f.adapter.deleteDraft = () => rm(draftPath, { force: true });
  if (stage === "enqueue") {
    await pending(f);
    assert.equal(f.state.calls, 1);
  } else {
    const session = f.create();
    await session.initialize();
    assert.equal(session.snapshot().status, "pending");
    assert.equal(session.snapshot().content.markdown, "local");
    await session.requestSave();
    await session.poll();
    assert.equal(f.state.calls, 0, "restart must not enqueue a second request");
    await writeFile(diskPath, JSON.stringify(content("local")));
    f.state.outcome = { status: "applied", revision: "r1" };
    await session.poll();
    assert.equal(session.snapshot().status, "saved");
    assert.equal(await f.adapter.readDraft(), null);
  }
  process.exit(0);
}

// A late ACK cannot certify a different external version or erase the local draft.
{
  const f = fixture();
  const session = await pending(f);
  f.state.disk = content("external after ACK");
  f.state.outcome = { status: "applied", revision: "r1" };
  await session.poll();
  assert.equal(session.snapshot().status, "conflict");
  assert.equal(session.snapshot().conflict.disk.markdown, "external after ACK");
  assert.equal(f.state.draft.draft.markdown, "local");
  assert.equal(f.state.calls, 1);
}
// An unreadable target retains the request link until disk verification succeeds.
{
  const f = fixture();
  const session = await pending(f);
  f.state.outcome = { status: "applied", revision: "r1" };
  f.state.unreadable = true;
  await session.poll();
  assert.equal(session.snapshot().status, "offline");
  assert.equal(f.state.draft.pendingSave.requestId, requestId);
  await session.requestSave();
  assert.equal(f.state.calls, 1);
  f.state.unreadable = false;
  f.state.disk = content("local");
  await session.poll();
  assert.equal(session.snapshot().status, "saved");
  assert.equal(f.state.draft, null);
}
// Reverting while an older write is queued must not delete the undo intent.
{
  const f = fixture();
  const session = await pending(f);
  session.edit(content("base"));
  await session.flushDraft();
  assert.notEqual(session.snapshot().status, "saved");
  assert.equal(f.state.draft.draft.markdown, "base");
  const recovered = f.create();
  await recovered.initialize();
  assert.equal(recovered.snapshot().status, "pending");
  await recovered.requestSave();
  assert.equal(f.state.calls, 1);
  f.state.disk = content("local");
  f.state.outcome = { status: "applied", revision: "r1" };
  f.adapter.save = async (_baseline, next) => {
    f.state.calls++;
    f.state.disk = structuredClone(next);
    return { status: "saved" };
  };
  await recovered.poll();
  await recovered.requestSave();
  assert.equal(f.state.disk.markdown, "base");
  assert.equal(f.state.calls, 2);
  assert.equal(f.state.draft, null);
}
// Missing response/request is not proof of a successful write.
{
  const f = fixture();
  const session = await pending(f);
  f.state.outcome = { status: "completed" };
  await session.poll();
  assert.equal(session.snapshot().status, "error");
  await session.poll();
  assert.match(session.snapshot().error, /without a saved result/);
  assert.equal(f.state.calls, 1);
  assert.equal(f.state.draft.draft.markdown, "local");
}
// Unit-only failure injection; the deferred B4 live-host test is not executed.
{
  const f = fixture();
  f.adapter.save = async () => {
    f.state.calls++;
    return { status: "error", message: "EACCES fixture" };
  };
  const session = f.create();
  await session.initialize();
  session.edit(content("recover me"));
  await assert.rejects(session.requestSave(), /EACCES/);
  await session.poll();
  assert.equal(
    f.state.calls,
    1,
    "persistent failures must not spin on each poll",
  );
  assert.equal(f.state.draft.draft.markdown, "recover me");
  const recovered = f.create();
  await recovered.initialize();
  assert.equal(recovered.snapshot().content.markdown, "recover me");
  f.adapter.save = async (_baseline, next) => {
    f.state.disk = next;
    return { status: "saved" };
  };
  await recovered.requestSave();
  assert.equal(f.state.disk.markdown, "recover me");
  assert.equal(f.state.draft, null);
}
// A failed checkpoint blocks the write and cannot claim a persisted local draft.
{
  const f = fixture();
  f.adapter.writeDraft = async () => {
    throw new Error("checkpoint unavailable");
  };
  const session = f.create();
  await session.initialize();
  session.edit(content("only in memory"));
  await assert.rejects(session.requestSave(), /checkpoint unavailable/);
  assert.equal(session.snapshot().draftPersisted, false);
  assert.equal(f.state.calls, 0);
}
// A direct write in progress must preserve a newer revert-to-baseline draft.
{
  const f = fixture();
  let finish;
  let started;
  const start = new Promise((resolve) => {
    started = resolve;
  });
  f.adapter.save = async (_baseline, next) => {
    if (next.markdown === "local") {
      started();
      await new Promise((resolve) => {
        finish = resolve;
      });
    }
    f.state.disk = next;
    return { status: "saved" };
  };
  const session = f.create();
  await session.initialize();
  session.edit(content("local"));
  const saving = session.requestSave();
  await start;
  session.edit(content("base"));
  await session.flushDraft();
  assert.equal(f.state.draft.draft.markdown, "base");
  finish();
  await saving;
  assert.equal(f.state.disk.markdown, "base");
}

// Exercise the production draft validator without accessing any Zotero profile.
{
  const f = fixture();
  await pending(f);
  globalThis.Zotero = { DataDirectory: { dir: "/isolated-b5" } };
  globalThis.PathUtils = { isAbsolute: (path) => path.startsWith("/"), join };
  globalThis.IOUtils = {
    exists: async () => true,
    readJSON: async () => structuredClone(f.state.draft),
  };
  assert.equal(
    (await readEditorDraft(identity.cardID)).pendingSave.requestId,
    requestId,
  );
  delete f.state.draft.pendingSave;
  assert.equal((await readEditorDraft(identity.cardID)).schema, 1);
  f.state.draft.pendingSave = { requestId: "invalid" };
  await assert.rejects(readEditorDraft(identity.cardID), /malformed/);
  assert.equal(f.state.draft.pendingSave.requestId, "invalid");
}

const directory = await mkdtemp(join(tmpdir(), "bridge-b5-"));
try {
  await writeFile(
    join(directory, "card.json"),
    JSON.stringify(content("base")),
  );
  for (const stage of ["enqueue", "recover"]) {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        fileURLToPath(import.meta.url),
        "--child",
        directory,
        stage,
      ],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.equal(
      result.status,
      0,
      `${stage}: ${result.stderr || result.error}`,
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
process.stdout.write(
  "B5 recovery tests passed: ACK verification, offline retry, revert, errors, checkpoint failure, separate-process recovery.",
);
