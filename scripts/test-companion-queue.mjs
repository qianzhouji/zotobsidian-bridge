import assert from "node:assert/strict";
import { randomUUID, webcrypto } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = path.join(tmpdir(), `zob-companion-queue-${randomUUID()}`);
const queue = path.join(root, "queue");
await fs.mkdir(queue, { recursive: true });
globalThis.crypto ??= webcrypto;
globalThis.Zotero = {
  Prefs: {
    get(name) {
      return name.endsWith(".companionQueuePath") ? queue : null;
    },
  },
};
globalThis.PathUtils = {
  join: path.join,
  parent: path.dirname,
  split: (value) => value.split(path.sep),
  normalize: path.normalize,
  isAbsolute: path.isAbsolute,
};
globalThis.IOUtils = {
  async exists(filePath) {
    return fs.access(filePath).then(
      () => true,
      () => false,
    );
  },
  async makeDirectory(directory) {
    await fs.mkdir(directory, { recursive: true });
  },
  async writeUTF8(filePath, content, options) {
    await fs.writeFile(filePath, content, {
      flag: options.mode === "create" ? "wx" : "w",
    });
  },
  async writeJSON(filePath, value, options) {
    await fs.writeFile(options.tmpPath, JSON.stringify(value));
    await fs.rename(options.tmpPath, filePath);
  },
  async move(from, to) {
    await fs.rename(from, to);
  },
  async remove(filePath) {
    await fs.rm(filePath, { force: true });
  },
  async readJSON(filePath) {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  },
  async getChildren(directory, options = {}) {
    try {
      return (await fs.readdir(directory)).map((name) =>
        path.join(directory, name),
      );
    } catch (error) {
      if (options.ignoreAbsent && error.code === "ENOENT") return [];
      throw error;
    }
  },
};

try {
  const queueModule = await import("../src/adapters/companion-queue.ts");
  const targetVaultId = randomUUID();
  const sourceId = "user:0/annotation/ANN001";
  const makeInput = (cardId) => ({
    operation: "create",
    cardId,
    sourceId,
    targetVaultId,
    outputFolder: "Zotero Literature",
    relativePath: "Zotero Literature/Paper/Annotations/P01N01.md",
    baseRevision: null,
    content: `---\nbridge_card_id: ${cardId}\nbridge_source_id: ${sourceId}\n---\n`,
  });
  const firstCardId = randomUUID();
  const secondCardId = randomUUID();
  const [first, second] = await Promise.allSettled([
    queueModule.submitCompanionWrite(makeInput(firstCardId)),
    queueModule.submitCompanionWrite(makeInput(secondCardId)),
  ]);
  assert.equal(first.status, "rejected");
  assert.equal(second.status, "rejected");
  assert.equal(first.reason.name, "CompanionPendingError");
  assert.equal(second.reason.name, "CompanionPendingError");
  assert.equal(
    first.reason.requestId,
    second.reason.requestId,
    "retry reuses the already queued create request",
  );
  const requestDirectory = path.join(queue, "requests");
  const requestFiles = await fs.readdir(requestDirectory);
  assert.equal(requestFiles.length, 1, "only one create request is queued");
  const savedRequest = JSON.parse(
    await fs.readFile(path.join(requestDirectory, requestFiles[0]), "utf8"),
  );
  assert.equal(savedRequest.cardId, firstCardId);

  const responseDirectory = path.join(queue, "responses");
  await fs.mkdir(responseDirectory, { recursive: true });
  await fs.writeFile(
    path.join(responseDirectory, `${savedRequest.requestId}.json`),
    JSON.stringify({
      protocolVersion: 3,
      requestId: savedRequest.requestId,
      status: "applied",
      revision: "a".repeat(64),
      completedAt: new Date().toISOString(),
    }),
  );
  await queueModule.submitCompanionWrite(makeInput(secondCardId));
  await delay(0);
  assert.equal(
    (await fs.readdir(requestDirectory)).length,
    1,
    "an applied but not-yet-cleaned create request is still reused",
  );
  globalThis.process.stdout.write(
    "Companion create request deduplication checks passed.\n",
  );
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
