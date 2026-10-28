import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  acquireQueueOwnership,
  QueueOwnershipError,
} from "../src/queue-ownership.ts";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "zob-owner-test-"));
try {
  const queue = path.join(root, "queue");
  const first = await acquireQueueOwnership(queue, "vault-test");
  await assert.rejects(
    acquireQueueOwnership(queue, "vault-test"),
    (error) =>
      error instanceof QueueOwnershipError &&
      /owned by Obsidian process/.test(error.message),
  );
  await first.release();

  const second = await acquireQueueOwnership(queue, "vault-test");
  const ownerPath = path.join(queue, ".zotero-obsidian-bridge-owner.json");
  const owner = JSON.parse(await fs.readFile(ownerPath, "utf8"));
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.vaultId, "vault-test");
  await second.release();

  await fs.writeFile(
    ownerPath,
    JSON.stringify({
      ownerToken: "dead-owner",
      pid: 2_147_483_647,
      vaultId: "vault-test",
      acquiredAt: new Date(0).toISOString(),
    }),
  );
  const recovered = await acquireQueueOwnership(queue, "vault-test");
  assert.notEqual(
    JSON.parse(await fs.readFile(ownerPath, "utf8")).ownerToken,
    "dead-owner",
  );
  await recovered.release();

  await fs.writeFile(
    ownerPath,
    JSON.stringify({
      ownerToken: "dead-owner-race",
      pid: 2_147_483_647,
      vaultId: "vault-test",
      acquiredAt: new Date(0).toISOString(),
    }),
  );
  const contenders = await Promise.allSettled([
    acquireQueueOwnership(queue, "vault-test"),
    acquireQueueOwnership(queue, "vault-test"),
  ]);
  const winners = contenders.filter((entry) => entry.status === "fulfilled");
  const rejected = contenders.filter((entry) => entry.status === "rejected");
  assert.equal(winners.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(
    rejected[0].reason instanceof QueueOwnershipError ||
      rejected[0].reason.code === "ENOENT",
  );
  await winners[0].value.release();
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

process.stdout.write("Companion queue ownership checks passed.\n");
