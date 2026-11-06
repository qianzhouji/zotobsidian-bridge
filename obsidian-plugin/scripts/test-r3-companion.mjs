import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { clearInterval, clearTimeout, setTimeout } from "node:timers";
import { statSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { hasSameMarkdownExceptUpdatedAt } from "../../src/core/markdown.ts";

const output = path.resolve(".scaffold/obsidian-plugin/main.js");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "zob-r3-test-"));

class FakeFileSystemAdapter {
  constructor(basePath) {
    this.basePath = basePath;
  }
  getBasePath() {
    return this.basePath;
  }
}
class TFile {
  constructor(filePath) {
    this.path = filePath;
  }
}
class TFolder {
  constructor(folderPath) {
    this.path = folderPath;
  }
}
class MarkdownView {
  constructor(file) {
    this.file = file;
  }
}
class FakePlugin {
  constructor(app) {
    this.app = app;
    this.savedData = null;
  }
  async loadData() {
    return this.savedData;
  }
  async saveData(value) {
    this.savedData = JSON.parse(JSON.stringify(value));
  }
  addStatusBarItem() {
    return {
      text: "",
      title: "",
      setText(value) {
        this.text = value;
      },
      setAttribute(key, value) {
        this[key] = value;
      },
    };
  }
  addSettingTab() {}
  addCommand() {}
  registerInterval() {}
}
class FakeNotice {
  constructor(message) {
    this.message = message;
  }
}
class FakePluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = { empty() {} };
  }
}
class FakeSetting {
  constructor() {}
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  addText() {
    return this;
  }
}

const moduleShim = { exports: {} };
const runtimeRequire = (specifier) => {
  if (specifier === "obsidian") {
    return {
      FileSystemAdapter: FakeFileSystemAdapter,
      MarkdownView,
      Notice: FakeNotice,
      Plugin: FakePlugin,
      PluginSettingTab: FakePluginSettingTab,
      Setting: FakeSetting,
      TFile,
      TFolder,
    };
  }
  return require(specifier);
};
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
let imageDecodeBehavior = "ok";
const mockCreateImageBitmap = async () => {
  if (imageDecodeBehavior === "fail") {
    throw new Error("injected image decoder failure");
  }
  return { width: 1, height: 1, close() {} };
};
vm.runInNewContext(await fs.readFile(output, "utf8"), {
  Buffer,
  Blob: globalThis.Blob,
  atob: globalThis.atob,
  btoa: globalThis.btoa,
  clearInterval,
  clearTimeout,
  crypto: globalThis.crypto,
  createImageBitmap: mockCreateImageBitmap,
  exports: moduleShim.exports,
  module: moduleShim,
  process,
  require: runtimeRequire,
  setInterval: () => 1,
  setTimeout,
  TextDecoder: globalThis.TextDecoder,
  TextEncoder: globalThis.TextEncoder,
  window: { setInterval: () => 1 },
});
const PluginClass = moduleShim.exports.default;

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function createApp(vaultRoot) {
  await fs.mkdir(vaultRoot, { recursive: true });
  const leaves = [];
  const vault = {
    adapter: new FakeFileSystemAdapter(vaultRoot),
    async read(file) {
      return fs.readFile(path.join(vaultRoot, file.path), "utf8");
    },
    async create(filePath, content) {
      const absolutePath = path.join(vaultRoot, filePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, { flag: "wx" });
      return new TFile(filePath);
    },
    async createBinary(filePath, content) {
      const absolutePath = path.join(vaultRoot, filePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, Buffer.from(content), { flag: "wx" });
      return new TFile(filePath);
    },
    async readBinary(file) {
      return new Uint8Array(await fs.readFile(path.join(vaultRoot, file.path)));
    },
    async createFolder(folderPath) {
      await fs.mkdir(path.join(vaultRoot, folderPath), { recursive: true });
    },
    async rename(file, newPath) {
      const destination = path.join(vaultRoot, newPath);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rename(path.join(vaultRoot, file.path), destination);
    },
    async process(file, callback) {
      const absolutePath = path.join(vaultRoot, file.path);
      const current = await fs.readFile(absolutePath, "utf8");
      await fs.writeFile(absolutePath, callback(current));
    },
    getAbstractFileByPath(filePath) {
      try {
        const stat = statSync(path.join(vaultRoot, filePath));
        return stat.isDirectory() ? new TFolder(filePath) : new TFile(filePath);
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
  };
  return {
    leaves,
    app: {
      vault,
      fileManager: {
        async renameFile(file, newPath) {
          await vault.rename(file, newPath);
        },
      },
      workspace: {
        containerEl: {
          ownerDocument: {
            defaultView: { createImageBitmap: mockCreateImageBitmap },
          },
        },
        getLeavesOfType() {
          return leaves;
        },
      },
    },
  };
}

function makePlugin(app, queueDirectory, vaultId) {
  const plugin = new PluginClass(app, {});
  plugin.settings = {
    queueDirectory,
    outputFolder: "Zotero Literature",
    vaultId,
  };
  plugin.status = {
    text: "",
    setText(value) {
      this.text = value;
    },
    setAttribute(key, value) {
      this[key] = value;
    },
  };
  return plugin;
}

function makeRequest({
  operation = "create",
  cardId = randomUUID(),
  requestId = randomUUID(),
  content,
  baseRevision = null,
  targetVaultId,
}) {
  const sourceId = "user:0/annotation/ANN001";
  const note =
    content ??
    `---\nbridge_card_id: ${cardId}\nbridge_source_id: ${sourceId}\n---\nsource text\n`;
  return {
    protocolVersion: 2,
    requestId,
    createdAt: new Date().toISOString(),
    operation,
    cardId,
    sourceId,
    targetVaultId,
    outputFolder: "Zotero Literature",
    relativePath: `Zotero Literature/Paper/Annotations/${cardId}.md`,
    baseRevision,
    content: note,
  };
}

async function enqueue(queueDirectory, request) {
  const requestsPath = path.join(queueDirectory, "requests");
  await fs.mkdir(requestsPath, { recursive: true });
  await fs.writeFile(
    path.join(requestsPath, `${request.requestId}.json`),
    JSON.stringify(request),
  );
}

async function enqueueResource(queueDirectory, request, bytes) {
  const payloadsPath = path.join(queueDirectory, "payloads");
  const requestsPath = path.join(queueDirectory, "requests");
  await fs.mkdir(payloadsPath, { recursive: true });
  await fs.mkdir(requestsPath, { recursive: true });
  await fs.writeFile(
    path.join(payloadsPath, `${request.requestId}.bin`),
    bytes,
    { flag: "wx" },
  );
  await fs.writeFile(
    path.join(requestsPath, `${request.requestId}.json`),
    JSON.stringify(request),
    { flag: "wx" },
  );
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function responseFor(queueDirectory, requestId) {
  return JSON.parse(
    await fs.readFile(
      path.join(queueDirectory, "responses", `${requestId}.json`),
      "utf8",
    ),
  );
}

const vaultId = "4b0481d2-8550-4f5b-bd26-61c461f995d2";
const vaultRoot = path.join(root, "test-vault");
const queueDirectory = path.join(root, "queue");
const { app, leaves } = await createApp(vaultRoot);
let plugin = makePlugin(app, queueDirectory, vaultId);

try {
  const offlineRequest = makeRequest({ targetVaultId: vaultId });
  await enqueue(queueDirectory, offlineRequest);
  assert.equal(
    await fs
      .readFile(
        path.join(
          queueDirectory,
          "requests",
          `${offlineRequest.requestId}.json`,
        ),
        "utf8",
      )
      .then(Boolean),
    true,
  );
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, offlineRequest.requestId)).status,
    "applied",
  );
  assert.equal(
    plugin.status.text,
    "Zotero Bridge: awaiting Zotero acknowledgement (1)",
  );

  await fs.rm(
    path.join(queueDirectory, "responses", `${offlineRequest.requestId}.json`),
  );
  await plugin.releaseQueueOwnership();
  plugin = makePlugin(app, queueDirectory, vaultId);
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, offlineRequest.requestId)).status,
    "applied",
  );
  const targetPath = path.join(vaultRoot, offlineRequest.relativePath);
  assert.equal(await fs.readFile(targetPath, "utf8"), offlineRequest.content);

  const legacyCardId = randomUUID();
  const legacySourceId = "user:0/annotation/OLD001";
  const legacyPath = "Zotero Literature/Paper/Annotations/OLD001.md";
  const numberedPath = "Zotero Literature/Paper/Annotations/P03N01.md";
  const legacyContent = `---\ntype: zotero-annotation\nbridge_card_id: ${legacyCardId}\nbridge_source_id: ${legacySourceId}\n---\n\nLegacy user notes.\n`;
  const legacyCreate = {
    ...makeRequest({
      cardId: legacyCardId,
      content: legacyContent,
      targetVaultId: vaultId,
    }),
    sourceId: legacySourceId,
    relativePath: legacyPath,
  };
  await enqueue(queueDirectory, legacyCreate);
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, legacyCreate.requestId)).protocolVersion,
    2,
  );

  const legacyMove = {
    ...legacyCreate,
    protocolVersion: 3,
    requestId: randomUUID(),
    operation: "move",
    moveFromRelativePath: legacyPath,
    relativePath: numberedPath,
    baseRevision: sha256(legacyContent),
    recoveryRelativePath: undefined,
    recoveryContent: undefined,
  };
  leaves.push({ view: new MarkdownView(new TFile(legacyPath)) });
  await enqueue(queueDirectory, legacyMove);
  await plugin.processQueue();
  assert.equal(
    await fs.readFile(path.join(vaultRoot, legacyPath), "utf8"),
    legacyContent,
  );
  assert.equal(
    await fs
      .access(
        path.join(queueDirectory, "responses", `${legacyMove.requestId}.json`),
      )
      .then(() => true)
      .catch(() => false),
    false,
  );
  leaves.length = 0;
  plugin.retryState.clear();
  await plugin.processQueue();
  const legacyMoveResponse = await responseFor(
    queueDirectory,
    legacyMove.requestId,
  );
  assert.equal(legacyMoveResponse.protocolVersion, 3);
  assert.equal(
    legacyMoveResponse.status,
    "applied",
    legacyMoveResponse.message,
  );
  assert.equal(
    await fs.readFile(path.join(vaultRoot, numberedPath), "utf8"),
    legacyContent,
  );
  assert.equal(
    await fs
      .access(path.join(vaultRoot, legacyPath))
      .then(() => true)
      .catch(() => false),
    false,
  );

  const replayedMove = {
    ...legacyMove,
    requestId: randomUUID(),
  };
  await enqueue(queueDirectory, replayedMove);
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, replayedMove.requestId)).status,
    "applied",
  );
  assert.equal(
    await fs.readFile(path.join(vaultRoot, numberedPath), "utf8"),
    legacyContent,
  );

  const conflictCardId = randomUUID();
  const conflictSourceId = "user:0/annotation/MOVECONFLICT";
  const conflictSourcePath =
    "Zotero Literature/Paper/Annotations/MOVECONFLICT.md";
  const occupiedTargetPath = "Zotero Literature/Paper/Annotations/P99N99.md";
  const conflictSourceContent = `---\nbridge_card_id: ${conflictCardId}\nbridge_source_id: ${conflictSourceId}\n---\nSource must remain.\n`;
  const occupiedTargetContent = `---\nbridge_card_id: ${randomUUID()}\nbridge_source_id: user:0/annotation/OCCUPIED\n---\nTarget must remain.\n`;
  await app.vault.create(conflictSourcePath, conflictSourceContent);
  await app.vault.create(occupiedTargetPath, occupiedTargetContent);
  const occupiedMove = {
    ...legacyMove,
    protocolVersion: 3,
    requestId: randomUUID(),
    operation: "move",
    cardId: conflictCardId,
    sourceId: conflictSourceId,
    moveFromRelativePath: conflictSourcePath,
    relativePath: occupiedTargetPath,
    baseRevision: sha256(conflictSourceContent),
    content: conflictSourceContent,
  };
  await enqueue(queueDirectory, occupiedMove);
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, occupiedMove.requestId)).status,
    "conflict",
  );
  assert.equal(
    await fs.readFile(path.join(vaultRoot, conflictSourcePath), "utf8"),
    conflictSourceContent,
  );
  assert.equal(
    await fs.readFile(path.join(vaultRoot, occupiedTargetPath), "utf8"),
    occupiedTargetContent,
  );
  await fs.writeFile(
    path.join(queueDirectory, "acks", `${occupiedMove.requestId}.json`),
    JSON.stringify({
      protocolVersion: 3,
      requestId: occupiedMove.requestId,
      acknowledgedAt: new Date().toISOString(),
    }),
  );
  await plugin.processQueue();

  const duplicateIdentity = makeRequest({
    cardId: offlineRequest.cardId,
    content: offlineRequest.content.replace(
      "source text",
      "different source text",
    ),
    targetVaultId: vaultId,
  });
  await enqueue(queueDirectory, duplicateIdentity);
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, duplicateIdentity.requestId)).status,
    "conflict",
  );
  assert.equal(await fs.readFile(targetPath, "utf8"), offlineRequest.content);
  await fs.mkdir(path.join(queueDirectory, "acks"), { recursive: true });
  await fs.writeFile(
    path.join(queueDirectory, "acks", `${duplicateIdentity.requestId}.json`),
    JSON.stringify({
      protocolVersion: 2,
      requestId: duplicateIdentity.requestId,
      acknowledgedAt: new Date().toISOString(),
    }),
  );
  await plugin.processQueue();

  const original = offlineRequest.content;
  const edited = original.replace("source text", "source updated");
  const replaceRequest = makeRequest({
    operation: "replace",
    cardId: offlineRequest.cardId,
    content: edited,
    baseRevision: sha256(original),
    targetVaultId: vaultId,
  });
  leaves.push(
    { view: new MarkdownView(new TFile("Unrelated/note.md")) },
    { view: new MarkdownView(new TFile(offlineRequest.relativePath)) },
  );
  await enqueue(queueDirectory, replaceRequest);
  await plugin.processQueue();
  assert.equal(plugin.status.text, "Zotero Bridge: waiting for editor (1)");
  assert.equal(await fs.readFile(targetPath, "utf8"), original);
  assert.equal(
    await fs
      .access(
        path.join(
          queueDirectory,
          "responses",
          `${replaceRequest.requestId}.json`,
        ),
      )
      .then(() => true)
      .catch(() => false),
    false,
  );
  leaves.length = 0;
  plugin.retryState.clear();
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, replaceRequest.requestId)).status,
    "applied",
  );
  assert.equal(await fs.readFile(targetPath, "utf8"), edited);

  const firstTimestampedContent = edited.replace(
    "---\n",
    "---\nbridge_updated_at: 2026-10-27T08:48:00.000Z\n",
  );
  const firstTimestampedRequest = makeRequest({
    operation: "replace",
    cardId: offlineRequest.cardId,
    content: firstTimestampedContent,
    baseRevision: sha256(edited),
    targetVaultId: vaultId,
  });
  await enqueue(queueDirectory, firstTimestampedRequest);
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, firstTimestampedRequest.requestId))
      .status,
    "applied",
  );

  const replayRequest = makeRequest({
    operation: "replace",
    cardId: offlineRequest.cardId,
    content: firstTimestampedContent.replace("08:48:00.000Z", "08:48:21.000Z"),
    baseRevision: sha256(edited),
    targetVaultId: vaultId,
  });
  const onDiskBeforeReplay = await fs.readFile(targetPath, "utf8");
  assert.equal(onDiskBeforeReplay, firstTimestampedContent);
  assert.equal(
    hasSameMarkdownExceptUpdatedAt(onDiskBeforeReplay, replayRequest.content),
    true,
  );
  await enqueue(queueDirectory, replayRequest);
  await plugin.processQueue();
  const replayResponse = await responseFor(
    queueDirectory,
    replayRequest.requestId,
  );
  assert.equal(replayResponse.status, "applied", replayResponse.message);
  assert.equal(await fs.readFile(targetPath, "utf8"), firstTimestampedContent);

  const savedUserEdit = firstTimestampedContent.replace(
    "source updated",
    "user's saved edit",
  );
  await fs.writeFile(targetPath, savedUserEdit);
  const staleRequest = makeRequest({
    operation: "replace",
    cardId: offlineRequest.cardId,
    content: original,
    baseRevision: sha256(edited),
    targetVaultId: vaultId,
  });
  await enqueue(queueDirectory, staleRequest);
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, staleRequest.requestId)).status,
    "conflict",
  );
  assert.match(plugin.status.text, /conflict/);
  assert.match(plugin.status.title, /Base revision changed/);
  assert.equal(await fs.readFile(targetPath, "utf8"), savedUserEdit);

  const wrongVault = makeRequest({ targetVaultId: randomUUID() });
  await enqueue(queueDirectory, wrongVault);
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, wrongVault.requestId)).status,
    "conflict",
  );

  const imageBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1sAAAAASUVORK5CYII=",
    "base64",
  );
  const imageHash = sha256Bytes(imageBytes);
  const imagePath = `Zotero Literature/Paper/Annotations/assets/ANNIMG-${imageHash}.png`;
  const resourceRequest = {
    protocolVersion: 2,
    requestId: randomUUID(),
    createdAt: new Date().toISOString(),
    operation: "create-resource",
    cardId: randomUUID(),
    sourceId: "user:0/annotation/ANNIMG",
    targetVaultId: vaultId,
    outputFolder: "Zotero Literature",
    relativePath: imagePath,
    baseRevision: null,
    resourceMimeType: "image/png",
    resourceSha256: imageHash,
    resourceSizeBytes: imageBytes.byteLength,
  };
  await enqueueResource(queueDirectory, resourceRequest, imageBytes);
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, resourceRequest.requestId)).status,
    "applied",
  );
  assert.deepEqual(
    await fs.readFile(path.join(vaultRoot, imagePath)),
    imageBytes,
  );

  const undecodableRequest = { ...resourceRequest, requestId: randomUUID() };
  imageDecodeBehavior = "fail";
  await enqueueResource(queueDirectory, undecodableRequest, imageBytes);
  await plugin.processQueue();
  imageDecodeBehavior = "ok";
  assert.equal(
    (await responseFor(queueDirectory, undecodableRequest.requestId)).status,
    "conflict",
  );
  assert.deepEqual(
    await fs.readFile(path.join(vaultRoot, imagePath)),
    imageBytes,
  );

  const imageReplay = { ...resourceRequest, requestId: randomUUID() };
  await enqueueResource(queueDirectory, imageReplay, imageBytes);
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, imageReplay.requestId)).status,
    "applied",
  );
  assert.equal(
    (
      await fs.readdir(
        path.join(vaultRoot, "Zotero Literature/Paper/Annotations/assets"),
      )
    ).length,
    1,
  );

  const corruptedRequest = { ...resourceRequest, requestId: randomUUID() };
  const corruptedBytes = Buffer.from(imageBytes);
  corruptedBytes[corruptedBytes.length - 1] ^= 0xff;
  await enqueueResource(queueDirectory, corruptedRequest, corruptedBytes);
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, corruptedRequest.requestId)).status,
    "conflict",
  );
  assert.deepEqual(
    await fs.readFile(path.join(vaultRoot, imagePath)),
    imageBytes,
  );

  const movedPath = "Zotero Literature/Paper/Annotations/Moved.md";
  await fs.rename(targetPath, path.join(vaultRoot, movedPath));
  const movedRequest = makeRequest({
    operation: "replace",
    cardId: offlineRequest.cardId,
    content: edited,
    baseRevision: sha256(savedUserEdit),
    targetVaultId: vaultId,
  });
  await enqueue(queueDirectory, movedRequest);
  await plugin.processQueue();
  assert.equal(
    (await responseFor(queueDirectory, movedRequest.requestId)).status,
    "conflict",
  );
  assert.equal(
    await fs.readFile(path.join(vaultRoot, movedPath), "utf8"),
    savedUserEdit,
  );

  await plugin.saveData(plugin.settings);
  plugin.settings.queueDirectory = path.join(root, "new-queue");
  await assert.rejects(
    plugin.saveSettings(),
    /acknowledge all companion queue entries/,
  );
  plugin.settings.queueDirectory = queueDirectory;

  const secondPlugin = makePlugin(app, queueDirectory, vaultId);
  await secondPlugin.processQueue();
  assert.match(secondPlugin.status.text, /owned by another instance/);
  assert.equal(
    await fs
      .readFile(
        path.join(queueDirectory, ".zotero-obsidian-bridge-owner.json"),
        "utf8",
      )
      .then((raw) => JSON.parse(raw).pid),
    process.pid,
  );
  secondPlugin.unloading = true;
  await secondPlugin.releaseQueueOwnership();

  const ackDirectory = path.join(queueDirectory, "acks");
  await fs.mkdir(ackDirectory, { recursive: true });
  for (const request of [
    offlineRequest,
    legacyCreate,
    legacyMove,
    replayedMove,
    occupiedMove,
    duplicateIdentity,
    replaceRequest,
    firstTimestampedRequest,
    replayRequest,
    staleRequest,
    wrongVault,
    resourceRequest,
    imageReplay,
    corruptedRequest,
    undecodableRequest,
    movedRequest,
  ]) {
    await fs.writeFile(
      path.join(ackDirectory, `${request.requestId}.json`),
      JSON.stringify({
        protocolVersion: 2,
        requestId: request.requestId,
        acknowledgedAt: new Date().toISOString(),
      }),
    );
  }
  await plugin.processQueue();
  assert.equal(
    (await fs.readdir(path.join(queueDirectory, "requests"))).length,
    0,
  );
  assert.equal(
    (await fs.readdir(path.join(queueDirectory, "responses"))).length,
    0,
  );
  assert.equal((await fs.readdir(ackDirectory)).length, 0);
  assert.equal(
    await fs
      .access(
        path.join(
          queueDirectory,
          "payloads",
          `${resourceRequest.requestId}.bin`,
        ),
      )
      .then(() => true)
      .catch(() => false),
    false,
  );

  plugin.onunload();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(
    fs.access(path.join(queueDirectory, ".zotero-obsidian-bridge-owner.json")),
    { code: "ENOENT" },
  );
  const reenabledPlugin = makePlugin(app, queueDirectory, vaultId);
  await reenabledPlugin.processQueue();
  assert.equal(reenabledPlugin.status.text, "Zotero Bridge: connected");
  await reenabledPlugin.releaseQueueOwnership();
  process.stdout.write(
    "Companion checks passed: v2 compatibility, v3 safe card moves and replay, binary resource verification, ACK cleanup, Markdown recovery/conflicts, editor deferral, Vault pairing, and single-owner enforcement.\n",
  );
} finally {
  await plugin.releaseQueueOwnership();
  await fs.rm(root, { recursive: true, force: true });
}
