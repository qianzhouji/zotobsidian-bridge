import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import {
  clearTimeout as clearTimer,
  setTimeout as setTimer,
} from "node:timers";
import { URL, fileURLToPath } from "node:url";
import { DOMParser } from "linkedom";

globalThis.DOMParser = DOMParser;

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const vaultPath = path.join(projectRoot, ".scaffold/smoke vault 测试 (#1)");
const dataPath = path.join(projectRoot, ".scaffold/test-data");
const literaturePath = path.join(vaultPath, "Zotero Literature");
const paperTitle = "Neural Mass/Model: Alpha?";
const annotationKey = "ANN001";
const expectedFolder = path.join(
  literaturePath,
  "Neural Mass Model Alpha (user-0-PAPER01)",
);
const paperPath = path.join(expectedFolder, "Paper.md");
const annotationPath = path.join(
  expectedFolder,
  "Annotations",
  `${annotationKey}.md`,
);

await fs.rm(vaultPath, { recursive: true, force: true });
await fs.rm(dataPath, { recursive: true, force: true });
await fs.mkdir(path.join(vaultPath, ".obsidian"), { recursive: true });
await fs.mkdir(dataPath, { recursive: true });

const launchedURLs = [];
const alerts = [];
const progressHeadlines = [];
const batchProgressHeadlines = [];
let lastBatchProgressSnapshot = null;
const confirmations = [];
let cancelBatchAfter = null;
const prefs = new Map([
  ["extensions.zotero.zoteroobsidianbridge.vaultPath", vaultPath],
  ["extensions.zotero.zoteroobsidianbridge.outputFolder", "Zotero Literature"],
]);
let failAtomicWrite = false;
let failIndexWrite = false;
let failResourceCommit = false;
let failCardWriteMarker = null;
let failCardWriteCode = null;
let r6CurrentBatchMetrics = null;
let gatedCardWrite = null;
let externalEditAfterNextReadPath = null;
let activeLibraryID = 1;
let activeAnnotationKey = annotationKey;
let quote = "A test highlight from the isolated fixture.";
let currentPaperTitle = paperTitle;
let syncMode = false;
let primarySourceDeleted = false;
const syncRecords = new Map();
const syncItemsByID = new Map();
const syncFieldsByKey = new Map();
const primarySyncFields = {
  annotationText: "A test highlight from the isolated fixture.",
  annotationComment: "Check this claim against the source.",
  annotationColor: "#ffd400",
  annotationPageLabel: "3",
  pageIndex: 2,
};

const parent = {
  id: 7,
  key: "PAPER01",
  libraryID: 1,
  isAnnotation: () => false,
  isAttachment: () => false,
  getField(field) {
    return (
      {
        title: currentPaperTitle,
        firstCreator: "Ada Example",
        date: "2026",
        publicationTitle: "Journal of Test Fixtures",
        DOI: "10.0000/example",
      }[field] ?? ""
    );
  },
};
const attachment = {
  key: "ATTACH01",
  libraryID: 1,
  parentItemID: parent.id,
  isAnnotation: () => false,
  isAttachment: () => true,
  getField: () => "fixture.pdf",
};
const annotation = {
  id: 19,
  get key() {
    return activeAnnotationKey;
  },
  get libraryID() {
    return activeLibraryID;
  },
  parentItem: attachment,
  isAnnotation: () => true,
  annotationPosition: JSON.stringify({ pageIndex: 2 }),
  annotationPageLabel: "3",
  annotationColor: "#ffd400",
  get annotationText() {
    return quote;
  },
  annotationComment: "Check this claim against the source.",
};
const secondaryAttachment = {
  ...attachment,
  id: 6,
  key: "ATTACH02",
  parentItemID: parent.id,
};
const batchAnnotation = {
  id: 20,
  key: "ANNBATCH",
  libraryID: 1,
  parentItem: attachment,
  isAnnotation: () => true,
  annotationPosition: JSON.stringify({ pageIndex: 5 }),
  annotationPageLabel: "6",
  annotationText: "A second selected highlight.",
  annotationComment: "Batch-created comment.",
  annotationColor: "#ffd400",
};
const failingBatchAnnotation = {
  id: 21,
  key: "BATCHFAIL",
  libraryID: 1,
  parentItem: attachment,
  isAnnotation: () => true,
  annotationPosition: "",
  annotationPageLabel: "",
  annotationText: "",
  annotationComment: "",
  annotationColor: "",
};
attachment.id = 5;
let savedAnnotations = [annotation, batchAnnotation, failingBatchAnnotation];
attachment.getAnnotations = () => savedAnnotations;

function registerSyncRecord(key, libraryID, id, fields) {
  const syncAttachment = { ...attachment, libraryID };
  const item = {
    id,
    key,
    libraryID,
    parentItem: syncAttachment,
    deleted: false,
    isAnnotation: () => true,
    isAttachment: () => false,
    get annotationPosition() {
      return JSON.stringify({ pageIndex: fields.pageIndex });
    },
    get annotationPageLabel() {
      return fields.annotationPageLabel ?? "";
    },
    get annotationColor() {
      return fields.annotationColor ?? "";
    },
    get annotationText() {
      return fields.annotationText ?? "";
    },
    get annotationComment() {
      return fields.annotationComment ?? "";
    },
  };
  syncRecords.set(`${libraryID}:${key}`, item);
  syncItemsByID.set(id, item);
  syncFieldsByKey.set(`${libraryID}:${key}`, fields);
  return item;
}

const pathUtils = {
  join: path.join,
  normalize: path.resolve,
  parent(value) {
    const parentPath = path.dirname(value);
    return parentPath === value ? null : parentPath;
  },
  split(value) {
    return path.resolve(value).split(path.sep).filter(Boolean);
  },
  isAbsolute: path.isAbsolute,
};

function fileFor(filePath) {
  return {
    path: filePath,
    exists() {
      try {
        fsSync.lstatSync(filePath);
        return true;
      } catch {
        return false;
      }
    },
    isDirectory() {
      try {
        return fsSync.statSync(filePath).isDirectory();
      } catch {
        return false;
      }
    },
    isWritable() {
      return this.exists();
    },
    isSymlink() {
      try {
        return fsSync.lstatSync(filePath).isSymbolicLink();
      } catch {
        return false;
      }
    },
  };
}

const fsSync = await import("node:fs");

async function atomicWrite(filePath, content, options = {}) {
  if (failCardWriteMarker && content.includes(failCardWriteMarker)) {
    failCardWriteMarker = null;
    const error = new Error("injected card-content write failure");
    if (failCardWriteCode) {
      error.code = failCardWriteCode;
      failCardWriteCode = null;
    }
    throw error;
  }
  if (gatedCardWrite && content.includes(gatedCardWrite.marker)) {
    const gate = gatedCardWrite;
    gatedCardWrite = null;
    gate.started();
    await gate.wait;
  }
  if (
    options.tmpPath &&
    failAtomicWrite &&
    filePath.startsWith(`${vaultPath}${path.sep}`)
  ) {
    throw new Error("injected atomic write failure");
  }
  if (options.tmpPath && (await exists(filePath)) && options.backupFile) {
    await fs.copyFile(filePath, options.backupFile);
  }
  const destination = options.tmpPath ?? filePath;
  const flag = options.mode === "create" ? "wx" : "w";
  await fs.writeFile(destination, content, { encoding: "utf8", flag });
  if (options.tmpPath) await fs.rename(options.tmpPath, filePath);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function withTimeout(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimer(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimer(timer);
  }
}

globalThis.PathUtils = {
  ...pathUtils,
  isAbsolute: path.isAbsolute,
};
globalThis.IOUtils = {
  async makeDirectory(directory, options = {}) {
    await fs.mkdir(directory, { recursive: options.createAncestors });
  },
  exists,
  async getChildren(directory, options = {}) {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      return entries.map((entry) => path.join(directory, entry.name));
    } catch (error) {
      if (options.ignoreAbsent && error.code === "ENOENT") return [];
      throw error;
    }
  },
  async readUTF8(filePath) {
    const contents = await fs.readFile(filePath, "utf8");
    if (externalEditAfterNextReadPath === filePath) {
      externalEditAfterNextReadPath = null;
      await fs.writeFile(filePath, `${contents}\nExternal edit during sync.\n`);
    }
    return contents;
  },
  async read(filePath) {
    return new Uint8Array(await fs.readFile(filePath));
  },
  async readJSON(filePath) {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  },
  async writeUTF8(filePath, contents, options = {}) {
    await atomicWrite(filePath, contents, options);
  },
  async write(filePath, bytes, options = {}) {
    await fs.writeFile(filePath, bytes, {
      flag: options.mode === "create" ? "wx" : "w",
    });
  },
  async writeJSON(filePath, value, options = {}) {
    if (failIndexWrite && filePath.endsWith(`${path.sep}cards.json`)) {
      failIndexWrite = false;
      throw new Error("injected card-index write failure");
    }
    await atomicWrite(filePath, JSON.stringify(value, null, 2), options);
  },
  async move(source, target, options = {}) {
    if (failResourceCommit && target.includes(`${path.sep}assets${path.sep}`)) {
      failResourceCommit = false;
      throw new Error("injected resource commit failure");
    }
    if (options.noOverwrite && (await exists(target))) {
      throw new Error("destination exists");
    }
    await fs.rename(source, target);
  },
  async remove(filePath, options = {}) {
    await fs.rm(filePath, {
      force: Boolean(options.ignoreAbsent),
      recursive: Boolean(options.recursive),
    });
  },
};
globalThis.Zotero = {
  DataDirectory: { dir: dataPath },
  Prefs: {
    get: (name) => prefs.get(name),
    set: (name, value) => prefs.set(name, value),
  },
  File: { pathToFile: fileFor },
  Items: {
    getByLibraryAndKeyAsync: async (libraryID, key) => {
      if (syncMode) {
        if (libraryID === 1 && key === annotationKey && primarySourceDeleted) {
          return false;
        }
        return syncRecords.get(`${libraryID}:${key}`) ?? false;
      }
      activeAnnotationKey = key;
      activeLibraryID = libraryID;
      return annotation;
    },
    getAsync: async (id) => {
      if (id === parent.id) return parent;
      if (id === attachment.id) return attachment;
      return syncItemsByID.get(Number(id)) ?? null;
    },
  },
  Libraries: {
    get: (libraryID) =>
      libraryID === 1
        ? { libraryType: "user", libraryTypeID: 0 }
        : { libraryType: "group", libraryTypeID: 77 },
    getAll: () => [
      { libraryID: 1, libraryType: "user", libraryTypeID: 0 },
      { libraryID: 2, libraryType: "group", libraryTypeID: 77 },
    ],
  },
  launchURL: (url) => launchedURLs.push(url),
  ProgressWindow: class MockProgressWindow {
    changeHeadline(headline) {
      progressHeadlines.push(headline);
    }
    show() {}
    startCloseTimer() {}
  },
  getMainWindow: () => ({
    alert: (message) => alerts.push(message),
    confirm: (message) => {
      confirmations.push(message);
      return true;
    },
    openDialog: (_url, _name, _features, state) => {
      const metrics = r6CurrentBatchMetrics;
      state.render = () => {
        batchProgressHeadlines.push(state.headline);
        lastBatchProgressSnapshot = {
          completed: state.completed,
          total: state.total,
          finished: state.finished,
          headline: state.headline,
        };
        if (metrics) {
          const now = performance.now();
          metrics.maxRssBytes = Math.max(
            metrics.maxRssBytes,
            process.memoryUsage().rss,
          );
          if (state.completed > metrics.completed) {
            metrics.latencies.push(now - metrics.lastCompletionAt);
            metrics.completed = state.completed;
            metrics.lastCompletionAt = now;
          }
          if (state.finished) {
            metrics.finished = true;
          }
        }
        if (
          cancelBatchAfter !== null &&
          state.completed >= cancelBatchAfter &&
          !state.finished
        ) {
          cancelBatchAfter = null;
          state.cancelRequested = true;
          state.onCancel();
        }
      };
      return {
        closed: false,
        document: {},
        close() {},
        addEventListener() {},
      };
    },
  }),
  debug: () => {},
};
const imageCachePaths = new Map();
globalThis.Zotero.Annotations = {
  hasCacheImage: async (item) => imageCachePaths.has(item.key),
  getCacheImagePath: (item) => imageCachePaths.get(item.key),
};
globalThis.Zotero.PDFWorker = {
  renderAttachmentAnnotations: async () => {},
};
globalThis.addon = {
  data: { config: { addonRef: "zoteroobsidianbridge" } },
};

const {
  cancelAnnotationBatch,
  createCardFromAnnotation,
  importAllSavedAnnotations,
} = await import("../src/services/annotation-card.ts");
const { updateCardSourceFields } =
  await import("../src/services/card-updater.ts");
const { parseMarkdownFrontmatter, readFrontmatterValue, replaceSourceBlock } =
  await import("../src/core/markdown.ts");
const { resolveVaultPath, readCardIndex, writeCardIndex } =
  await import("../src/adapters/vault-storage.ts");
const { findCardByFrontmatter } =
  await import("../src/adapters/vault-storage.ts");
const { readSyncTaskLog, writeSyncTaskLog } =
  await import("../src/adapters/vault-storage.ts");
const { ensureVaultDirectory } =
  await import("../src/adapters/vault-storage.ts");
const { waitForVaultWrites } = await import("../src/adapters/vault-storage.ts");
const { validateVaultRelativePath } = await import("../src/core/models.ts");

await createCardFromAnnotation({}, { key: annotationKey, libraryID: 1 });
let card = await fs.readFile(annotationPath, "utf8");
card = card.replace(
  "type: zotero-annotation\n",
  "type: zotero-annotation\ncustom_metadata:\n  owner: me\n  flags: [keep, exact]\n",
);
card += "\n```md\n<!-- zotero-obsidian-bridge:source:start -->\n````\n";
await fs.writeFile(annotationPath, card, "utf8");
const initialCard = card;
const paperNote = await fs.readFile(paperPath, "utf8");
assert.equal(readFrontmatterValue(card, "bridge_schema"), 1);
assert.equal(readFrontmatterValue(card, "zotero_library"), "user:0");
assert.equal(
  readFrontmatterValue(card, "zotero_annotation_key"),
  annotationKey,
);
assert.match(card, /A test highlight from the isolated fixture\./);
assert.match(card, /Check this claim against the source\./);
assert.match(card, /zotero:\/\/open-pdf\/library\/items\/ATTACH01\?page=3/);
assert.equal(readFrontmatterValue(paperNote, "zotero_item_key"), "PAPER01");
assert.match(paperNote, /Ada Example/);
assert.match(paperNote, /zotero:\/\/select\/library\/items\/PAPER01/);
assert.equal(launchedURLs.length, 1);
assert.equal(new URL(launchedURLs[0]).searchParams.get("path"), annotationPath);

const cardID = readFrontmatterValue(card, "bridge_card_id");
const sourceID = readFrontmatterValue(card, "bridge_source_id");
assert.equal(typeof cardID, "string");
assert.equal(sourceID, "user:0/annotation/ANN001");

const duplicateSourcePath = path.join(
  expectedFolder,
  "Annotations",
  "duplicate-source-card.md",
);
await fs.copyFile(annotationPath, duplicateSourcePath);
await assert.rejects(
  findCardByFrontmatter(
    vaultPath,
    "Zotero Literature",
    "bridge_source_id",
    sourceID,
  ),
  /Multiple Markdown cards match bridge_source_id/,
);
await fs.rm(duplicateSourcePath);

const bodyBefore = parseMarkdownFrontmatter(card).body;
await updateCardSourceFields(
  vaultPath,
  path.relative(vaultPath, annotationPath),
  cardID,
  {
    zotero_doi: "10.0000/updated",
  },
);
card = await fs.readFile(annotationPath, "utf8");
assert.equal(readFrontmatterValue(card, "zotero_doi"), "10.0000/updated");
assert.equal(parseMarkdownFrontmatter(card).body, bodyBefore);
assert.deepEqual(readFrontmatterValue(card, "custom_metadata"), {
  owner: "me",
  flags: ["keep", "exact"],
});
const recoveryPath = path.join(
  expectedFolder,
  "Annotations",
  ".bridge-recovery",
);
const recoveryFiles = await fs.readdir(recoveryPath);
assert.equal(recoveryFiles.length, 1);
assert.equal(
  await fs.readFile(path.join(recoveryPath, recoveryFiles[0]), "utf8"),
  initialCard,
);

const updatedCard = card;
externalEditAfterNextReadPath = annotationPath;
await assert.rejects(
  updateCardSourceFields(
    vaultPath,
    path.relative(vaultPath, annotationPath),
    cardID,
    { zotero_doi: "10.0000/race" },
  ),
  /changed before direct write/,
);
assert.match(
  await fs.readFile(annotationPath, "utf8"),
  /External edit during sync/,
);
await fs.writeFile(annotationPath, updatedCard, "utf8");

failAtomicWrite = true;
await assert.rejects(
  updateCardSourceFields(
    vaultPath,
    path.relative(vaultPath, annotationPath),
    cardID,
    {
      zotero_doi: "10.0000/failed",
    },
  ),
  /injected atomic write failure/,
);
failAtomicWrite = false;
assert.equal(await fs.readFile(annotationPath, "utf8"), updatedCard);

const replacement =
  "<!-- zotero-obsidian-bridge:source:start -->\n## Updated source\n\nnew excerpt\n<!-- zotero-obsidian-bridge:source:end -->\n";
const replaced = replaceSourceBlock(card, replacement);
assert.match(replaced, /new excerpt/);
assert.match(replaced, /## My notes/);
assert.throws(
  () => resolveVaultPath(vaultPath, "../outside.md"),
  /normalized relative paths/,
);
assert.throws(
  () => resolveVaultPath(vaultPath, "/outside.md"),
  /normalized relative paths/,
);
const originalPathNormalize = globalThis.PathUtils.normalize;
globalThis.PathUtils.normalize = (value) => {
  if (!fsSync.existsSync(value)) {
    throw new Error("PathUtils.normalize cannot normalize a missing path");
  }
  return originalPathNormalize(value);
};
try {
  const notYetCreated = "not-created/annotation.md";
  assert.equal(
    resolveVaultPath(vaultPath, notYetCreated),
    path.join(vaultPath, notYetCreated),
  );
} finally {
  globalThis.PathUtils.normalize = originalPathNormalize;
}
assert.throws(() => validateVaultRelativePath("../outside"), /cannot contain/);
assert.throws(
  () => validateVaultRelativePath("/outside"),
  /non-empty path inside/,
);
assert.throws(
  () => parseMarkdownFrontmatter("---\ntitle: [broken\n---\nbody"),
  /Invalid YAML frontmatter/,
);

const outsidePath = path.join(projectRoot, ".scaffold/outside-test-target");
await fs.mkdir(outsidePath, { recursive: true });
const racedDirectory = "Zotero Literature/raced-directory";
const originalMakeDirectory = globalThis.IOUtils.makeDirectory;
globalThis.IOUtils.makeDirectory = async (directory, options) => {
  await originalMakeDirectory(directory, options);
  throw new Error("Folder already exists.");
};
try {
  assert.equal(
    await ensureVaultDirectory(vaultPath, racedDirectory),
    path.join(vaultPath, racedDirectory),
  );
} finally {
  globalThis.IOUtils.makeDirectory = originalMakeDirectory;
}
const escapedFolder = path.join(literaturePath, "escaped");
await fs.symlink(outsidePath, escapedFolder, "dir");
await assert.rejects(
  ensureVaultDirectory(vaultPath, "Zotero Literature/escaped/new-folder"),
  /symbolic link/,
);
assert.equal(alerts.length, 0);
await fs.rm(escapedFolder, { force: true });
await fs.rm(outsidePath, { recursive: true, force: true });

for (let attempt = 0; attempt < 9; attempt++) {
  quote = `Changed content ${attempt}`;
  await createCardFromAnnotation({}, { key: annotationKey, libraryID: 1 });
}
const refreshedCard = await fs.readFile(annotationPath, "utf8");
assert.equal(readFrontmatterValue(refreshedCard, "bridge_card_id"), cardID);
assert.equal(readFrontmatterValue(refreshedCard, "bridge_source_id"), sourceID);
assert.deepEqual(readFrontmatterValue(refreshedCard, "custom_metadata"), {
  owner: "me",
  flags: ["keep", "exact"],
});
assert.match(refreshedCard, /> Changed content 8/);
assert.match(
  refreshedCard,
  /```md\n<!-- zotero-obsidian-bridge:source:start -->\n````/,
);
assert.equal(launchedURLs.length, 10);
assert.equal(
  (await fs.readdir(path.join(expectedFolder, "Annotations"))).filter((name) =>
    name.endsWith(".md"),
  ).length,
  1,
);

const movedPath = path.join(expectedFolder, "Annotations", "renamed card.md");
await fs.rename(annotationPath, movedPath);
await createCardFromAnnotation({}, { key: annotationKey, libraryID: 1 });
assert.equal(await exists(movedPath), true);
assert.equal(await exists(annotationPath), false);

const suspendedFile = path.join(projectRoot, ".scaffold/suspended-card.md");
await fs.rename(movedPath, suspendedFile);
await assert.rejects(
  createCardFromAnnotation({}, { key: annotationKey, libraryID: 1 }),
  /suspended instead of being recreated/,
);
assert.equal(await exists(annotationPath), false);
const indexPath = path.join(
  dataPath,
  "storage",
  "zotero-obsidian-bridge",
  "cards.json",
);
let suspendedIndex = await readCardIndex(indexPath);
assert.equal(
  suspendedIndex.suspendedCards["user:0/annotation/ANN001"].cardID,
  cardID,
);
await fs.rename(suspendedFile, movedPath);
await createCardFromAnnotation({}, { key: annotationKey, libraryID: 1 });
suspendedIndex = await readCardIndex(indexPath);
assert.equal(
  suspendedIndex.suspendedCards["user:0/annotation/ANN001"],
  undefined,
);
assert.equal(alerts.length, 0);

activeLibraryID = 2;
activeAnnotationKey = annotationKey;
await createCardFromAnnotation({}, { key: annotationKey, libraryID: 2 });
const secondLibraryCard = path.join(
  literaturePath,
  "Neural Mass Model Alpha (group-77-PAPER01)",
  "Annotations",
  `${annotationKey}.md`,
);
assert.equal(await exists(secondLibraryCard), true);
assert.equal(
  readFrontmatterValue(
    await fs.readFile(secondLibraryCard, "utf8"),
    "zotero_library",
  ),
  "group:77",
);

activeLibraryID = 1;
for (let attempt = 2; attempt <= 10; attempt++) {
  activeAnnotationKey = `ANN${String(attempt).padStart(3, "0")}`;
  quote = `Independent annotation ${attempt}`;
  await createCardFromAnnotation(
    {},
    { key: activeAnnotationKey, libraryID: 1 },
  );
}
const userCards = (
  await fs.readdir(path.join(expectedFolder, "Annotations"))
).filter((name) => name.endsWith(".md"));
assert.equal(userCards.length, 10);

const index = await readCardIndex(indexPath);
assert.equal(Object.keys(index.cards).length, 11);
assert.equal(
  index.cards["user:0/annotation/ANN001"].relativePath,
  path.relative(vaultPath, movedPath),
);
assert.equal(
  index.cards["group:77/annotation/ANN001"].relativePath,
  path.relative(vaultPath, secondLibraryCard),
);

const selectedCardPath = path.join(
  expectedFolder,
  "Annotations",
  "ANNBATCH.md",
);
const urlsBeforeBatch = launchedURLs.length;
await createCardFromAnnotation(
  { itemID: attachment.id },
  { id: String(batchAnnotation.id) },
  [String(annotation.id), String(batchAnnotation.id)],
);
assert.equal(await exists(selectedCardPath), true);
assert.match(
  await fs.readFile(selectedCardPath, "utf8"),
  /A second selected highlight\./,
);
assert.equal(launchedURLs.length, urlsBeforeBatch + 1);
assert.equal(
  new URL(launchedURLs.at(-1)).searchParams.get("path"),
  selectedCardPath,
);
assert.ok(batchProgressHeadlines.some((headline) => headline.includes("1/2")));
assert.ok(batchProgressHeadlines.some((headline) => headline.includes("2/2")));

const batchIndex = await readCardIndex(indexPath);
batchIndex.suspendedCards["user:0/annotation/BATCHFAIL"] = {
  cardID: "suspended-batch-card",
  relativePath: "Zotero Literature/missing.md",
  suspendedAt: new Date().toISOString(),
  reason: "missing",
};
await writeCardIndex(indexPath, batchIndex);
const urlsBeforePartialBatch = launchedURLs.length;
await createCardFromAnnotation(
  { itemID: attachment.id },
  { id: String(batchAnnotation.id) },
  [
    String(failingBatchAnnotation.id),
    String(annotation.id),
    String(batchAnnotation.id),
  ],
);
assert.equal(launchedURLs.length, urlsBeforePartialBatch + 1);
assert.equal(alerts.length, 1);
assert.match(alerts[0], /已处理 2\/3 条批注/);

const taskLogPath = path.join(
  dataPath,
  "storage",
  "zotero-obsidian-bridge",
  "sync-tasks.json",
);
const emptyTaskLog = await readSyncTaskLog(taskLogPath);
assert.deepEqual(emptyTaskLog, { bridge_schema: 1, tasks: [] });
const taskLog = {
  bridge_schema: 1,
  tasks: [
    {
      id: "task-1",
      sourceID: "user:0/annotation/ANN001",
      status: "pending",
      attempts: 0,
      updatedAt: new Date().toISOString(),
    },
  ],
};
await writeSyncTaskLog(taskLogPath, taskLog);
assert.deepEqual(await readSyncTaskLog(taskLogPath), taskLog);
await assert.rejects(
  writeSyncTaskLog(taskLogPath, {
    bridge_schema: 1,
    tasks: [{ ...taskLog.tasks[0], status: "unknown" }],
  }),
  /invalid task record/,
);

const corruptIndex = path.join(dataPath, "corrupt-index.json");
await fs.writeFile(corruptIndex, "{ broken", "utf8");
await assert.rejects(readCardIndex(corruptIndex));

for (let attempt = 1; attempt <= 10; attempt++) {
  const key = `ANN${String(attempt).padStart(3, "0")}`;
  const fields =
    attempt === 1
      ? primarySyncFields
      : {
          annotationText: `Independent annotation ${attempt}`,
          annotationComment: "",
          annotationColor: "#ffd400",
          annotationPageLabel: String(attempt + 2),
          pageIndex: attempt + 1,
        };
  registerSyncRecord(key, 1, attempt === 1 ? 19 : 100 + attempt, fields);
}
registerSyncRecord("ANN001", 2, 219, {
  annotationText: "Group-library annotation.",
  annotationComment: "",
  annotationColor: "#ffd400",
  annotationPageLabel: "3",
  pageIndex: 2,
});
registerSyncRecord("ANNBATCH", 1, 220, {
  annotationText: "A second selected highlight.",
  annotationComment: "Batch-created comment.",
  annotationColor: "#ffd400",
  annotationPageLabel: "6",
  pageIndex: 5,
});

let syncCard = await fs.readFile(movedPath, "utf8");
syncCard += "\nPersonal note that must survive source synchronization.\n";
await fs.writeFile(movedPath, syncCard, "utf8");
const personalBody = parseMarkdownFrontmatter(syncCard).body;
const userNotesBefore = personalBody.slice(personalBody.indexOf("## My notes"));
syncMode = true;

const {
  flushSyncQueue,
  getSyncStatus,
  handleNotifierEvent,
  queueSourceSync,
  startSyncQueue,
  stopSyncQueue,
} = await import("../src/services/sync-queue.ts");
const userNotes = (markdown) => {
  const body = parseMarkdownFrontmatter(markdown).body;
  return body.slice(body.indexOf("## My notes"));
};
await startSyncQueue();
await flushSyncQueue();
let syncStatus = await getSyncStatus();
assert.equal(syncStatus.counts.conflict, 0);
assert.equal(syncStatus.counts.retry, 0);
assert.equal(syncStatus.counts.pending, 0);
syncCard = await fs.readFile(movedPath, "utf8");
assert.equal(userNotes(syncCard), userNotesBefore);

currentPaperTitle = "Updated Neural Mass Model";
handleNotifierEvent("modify", "item", [parent.id], null);
for (let attempt = 0; attempt < 200; attempt++) {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
  await flushSyncQueue();
  syncCard = await fs.readFile(movedPath, "utf8");
  if (
    readFrontmatterValue(syncCard, "zotero_paper_title") === currentPaperTitle
  ) {
    break;
  }
}
assert.equal(
  readFrontmatterValue(syncCard, "zotero_paper_title"),
  currentPaperTitle,
);
assert.equal(userNotes(syncCard), userNotesBefore);
const updatedPaperNote = await fs.readFile(paperPath, "utf8");
assert.equal(
  readFrontmatterValue(updatedPaperNote, "zotero_title"),
  currentPaperTitle,
);
assert.match(updatedPaperNote, /Updated Neural Mass Model/);

primarySyncFields.annotationText = "Latest source text after a burst.";
primarySyncFields.annotationComment = "Latest Zotero comment.";
primarySyncFields.annotationColor = "#ff6666";
primarySyncFields.annotationPageLabel = "8";
primarySyncFields.pageIndex = 7;
const recoveryCount = async () =>
  (await fs.readdir(recoveryPath)).filter((name) => name.endsWith(".bak"))
    .length;
const recoveryCountBeforeBurst = await recoveryCount();
await Promise.all(
  Array.from({ length: 20 }, () =>
    queueSourceSync("user:0/annotation/ANN001", "modify"),
  ),
);
await flushSyncQueue();
syncCard = await fs.readFile(movedPath, "utf8");
assert.equal(readFrontmatterValue(syncCard, "zotero_page_index"), 7);
assert.equal(readFrontmatterValue(syncCard, "zotero_page_label"), "8");
assert.equal(
  readFrontmatterValue(syncCard, "zotero_annotation_color"),
  "#ff6666",
);
assert.match(syncCard, /Latest source text after a burst\./);
assert.match(syncCard, /Latest Zotero comment\./);
assert.equal(userNotes(syncCard), userNotesBefore);
assert.equal(await recoveryCount(), recoveryCountBeforeBurst + 1);

primarySourceDeleted = true;
await queueSourceSync("user:0/annotation/ANN001", "delete");
await flushSyncQueue();
syncCard = await fs.readFile(movedPath, "utf8");
assert.equal(readFrontmatterValue(syncCard, "bridge_source_status"), "missing");
assert.equal(userNotes(syncCard), userNotesBefore);
assert.equal(await exists(movedPath), true);

primarySourceDeleted = false;
primarySyncFields.annotationText = "Restored Zotero source text.";
await queueSourceSync("user:0/annotation/ANN001", "add");
await flushSyncQueue();
syncCard = await fs.readFile(movedPath, "utf8");
assert.equal(
  readFrontmatterValue(syncCard, "bridge_source_status"),
  "available",
);
assert.match(syncCard, /Restored Zotero source text\./);
assert.equal(userNotes(syncCard), userNotesBefore);

const removedCardPath = path.join(expectedFolder, "Annotations", "ANN002.md");
await fs.rm(removedCardPath);
await queueSourceSync("user:0/annotation/ANN002", "modify");
await flushSyncQueue();
assert.equal(await exists(removedCardPath), false);
const afterCardRemovalIndex = await readCardIndex(indexPath);
assert.equal(
  afterCardRemovalIndex.suspendedCards["user:0/annotation/ANN002"].reason,
  "missing",
);
assert.equal(
  (await getSyncStatus()).tasks.some(
    (task) =>
      task.sourceID === "user:0/annotation/ANN002" &&
      task.status === "conflict",
  ),
  true,
);

syncFieldsByKey.get("1:ANN003").annotationText =
  "A source update that will fail once.";
failAtomicWrite = true;
await queueSourceSync("user:0/annotation/ANN003", "modify");
await flushSyncQueue();
syncStatus = await getSyncStatus();
assert.ok(
  syncStatus.tasks.some(
    (task) =>
      task.sourceID === "user:0/annotation/ANN003" && task.status === "retry",
  ),
);
failAtomicWrite = false;
await flushSyncQueue();
const retryCardPath = path.join(expectedFolder, "Annotations", "ANN003.md");
assert.match(
  await fs.readFile(retryCardPath, "utf8"),
  /A source update that will fail once\./,
);

syncFieldsByKey.get("1:ANN004").annotationText =
  "Persisted pending task after restart.";
await queueSourceSync("user:0/annotation/ANN004", "modify");
await stopSyncQueue();
await startSyncQueue();
await flushSyncQueue();
const resumedCardPath = path.join(expectedFolder, "Annotations", "ANN004.md");
assert.match(
  await fs.readFile(resumedCardPath, "utf8"),
  /Persisted pending task after restart\./,
);
await stopSyncQueue();

const { readSourceMarkdown, readUserNoteContent, replaceUserNoteContent } =
  await import("../src/core/note-content.ts");
const { renderMarkdown } = await import("../src/core/markdown-preview.ts");
const { formatLineDiff } = await import("../src/core/text-diff.ts");
const {
  updateCardSourceContent,
  updateCardUserContent,
  UserContentConflictError,
} = await import("../src/services/card-updater.ts");
const {
  archiveEditorConflict,
  deleteEditorDraft,
  readEditorDraft,
  writeEditorDraft,
} = await import("../src/adapters/editor-drafts.ts");
const editorCard = await fs.readFile(resumedCardPath, "utf8");
const editorCardID = readFrontmatterValue(editorCard, "bridge_card_id");
const editorSourceBefore = readSourceMarkdown(editorCard);
const editorBaseline = readUserNoteContent(editorCard);
const zoteroEdit = {
  title: "Training observation",
  markdown: "A note with $\\alpha + \\beta$ and a list:\n\n- one\n- two\n",
};
await updateCardUserContent(
  vaultPath,
  path.relative(vaultPath, resumedCardPath),
  editorCardID,
  editorBaseline,
  zoteroEdit,
);
let editedCard = await fs.readFile(resumedCardPath, "utf8");
assert.deepEqual(readUserNoteContent(editedCard), zoteroEdit);
assert.equal(readSourceMarkdown(editedCard), editorSourceBefore);

const concurrentNote = {
  title: "Concurrent editor update",
  markdown: "The source and note writers ran at the same time.\n",
};
const concurrentSource =
  "<!-- zotero-obsidian-bridge:source:start -->\n## Concurrent source\n\nUpdated excerpt.\n<!-- zotero-obsidian-bridge:source:end -->\n";
await Promise.all([
  updateCardSourceContent(
    vaultPath,
    path.relative(vaultPath, resumedCardPath),
    editorCardID,
    { zotero_doi: "10.0000/concurrent" },
    concurrentSource,
  ),
  updateCardUserContent(
    vaultPath,
    path.relative(vaultPath, resumedCardPath),
    editorCardID,
    zoteroEdit,
    concurrentNote,
  ),
]);
editedCard = await fs.readFile(resumedCardPath, "utf8");
assert.deepEqual(readUserNoteContent(editedCard), concurrentNote);
assert.equal(
  readSourceMarkdown(editedCard),
  "## Concurrent source\n\nUpdated excerpt.",
);
assert.equal(
  readFrontmatterValue(editedCard, "note_title"),
  concurrentNote.title,
);
await updateCardSourceFields(
  vaultPath,
  path.relative(vaultPath, resumedCardPath),
  editorCardID,
  { zotero_doi: "10.0000/editor-test" },
);
editedCard = await fs.readFile(resumedCardPath, "utf8");
assert.deepEqual(readUserNoteContent(editedCard), concurrentNote);
assert.equal(
  readSourceMarkdown(editedCard),
  "## Concurrent source\n\nUpdated excerpt.",
);

const previewHTML = renderMarkdown(
  '<script>alert("x")</script>\n\n[x](javascript:alert(1))\n\n![remote](https://example.com/image.png)\n\n$\\alpha + \\beta$\n\n$$\nx^2\n$$',
);
assert.doesNotMatch(previewHTML, /<script\b/i);
assert.match(previewHTML, /&lt;script&gt;/);
assert.doesNotMatch(previewHTML, /href="javascript:/i);
assert.doesNotMatch(previewHTML, /<img\b/i);
assert.match(previewHTML, /class="katex"/);
assert.match(previewHTML, /katex-display/);
assert.deepEqual(formatLineDiff("same\nold\n", "same\nnew\n"), [
  { kind: "context", lines: ["same"] },
  { kind: "removed", lines: ["old"] },
  { kind: "added", lines: ["new"] },
]);

const diskEdit = {
  title: "Obsidian edit",
  markdown: "A concurrent edit made outside Zotero.\n",
};
editedCard = replaceUserNoteContent(editedCard, diskEdit);
await fs.writeFile(resumedCardPath, editedCard, "utf8");
await assert.rejects(
  updateCardUserContent(
    vaultPath,
    path.relative(vaultPath, resumedCardPath),
    editorCardID,
    concurrentNote,
    { title: "Zotero edit", markdown: "Must not silently overwrite.\n" },
  ),
  (error) =>
    error instanceof UserContentConflictError &&
    error.current.markdown === diskEdit.markdown,
);
assert.deepEqual(
  readUserNoteContent(await fs.readFile(resumedCardPath, "utf8")),
  diskEdit,
);

const recoveryDraft = {
  schema: 1,
  cardID: editorCardID,
  sourceID: readFrontmatterValue(editedCard, "bridge_source_id"),
  relativePath: path.relative(vaultPath, resumedCardPath),
  baseline: concurrentNote,
  draft: { title: "Recovered title", markdown: "Recovered draft body.\n" },
  updatedAt: new Date().toISOString(),
};
await writeEditorDraft(recoveryDraft);
assert.deepEqual(await readEditorDraft(editorCardID), recoveryDraft);
const archivePath = await archiveEditorConflict({
  ...recoveryDraft,
  disk: diskEdit,
  resolution: "keep-local",
  archivedAt: new Date().toISOString(),
});
assert.equal(await exists(archivePath), true);
await deleteEditorDraft(editorCardID);
assert.equal(await readEditorDraft(editorCardID), null);

const { ensureCardForAnnotation } =
  await import("../src/services/annotation-card.ts");
const offlineVaultPath = path.join(projectRoot, ".scaffold/unavailable-vault");
prefs.set("extensions.zotero.zoteroobsidianbridge.vaultPath", offlineVaultPath);
const urlsBeforeOfflineOpen = launchedURLs.length;
const offlineReference = await ensureCardForAnnotation(
  {},
  { key: annotationKey, libraryID: 1 },
);
assert.equal(offlineReference.cardID, cardID);
assert.equal(offlineReference.sourceID, "user:0/annotation/ANN001");
assert.equal(offlineReference.vaultPath, offlineVaultPath);
assert.equal(offlineReference.absolutePath.startsWith(offlineVaultPath), true);
assert.equal(launchedURLs.length, urlsBeforeOfflineOpen);
prefs.set("extensions.zotero.zoteroobsidianbridge.vaultPath", vaultPath);

const largeBatchAnnotations = Array.from({ length: 100 }, (_, index) => {
  const key = `LOAD${String(index + 1).padStart(3, "0")}`;
  const fields = {
    annotationPosition:
      index === 0 ? "not-json" : JSON.stringify({ pageIndex: index }),
    annotationPageLabel: index === 0 ? "iv" : String(index + 1),
    annotationText: index === 0 ? "" : `Load-test highlight ${index + 1}`,
    annotationComment: "",
  };
  return {
    id: 1000 + index,
    key,
    libraryID: 1,
    parentItem: index === 1 ? secondaryAttachment : attachment,
    isAnnotation: () => true,
    ...fields,
  };
});
savedAnnotations = largeBatchAnnotations;
const largeBatchIDs = largeBatchAnnotations.map((item) => String(item.id));
largeBatchIDs.push(largeBatchIDs[0]);
const largeBatchFolder = path.join(
  literaturePath,
  "Updated Neural Mass Model (user-0-PAPER01)",
);
const urlsBeforeLargeBatch = launchedURLs.length;
await createCardFromAnnotation(
  { itemID: attachment.id },
  { id: largeBatchIDs[0] },
  largeBatchIDs,
);
assert.equal(launchedURLs.length, urlsBeforeLargeBatch + 1);
assert.equal(
  new URL(launchedURLs.at(-1)).searchParams.get("path"),
  path.join(largeBatchFolder, "Annotations", "LOAD001.md"),
);
const largeBatchFiles = await fs.readdir(
  path.join(largeBatchFolder, "Annotations"),
);
assert.equal(
  largeBatchFiles.filter((name) => name.endsWith(".md")).length,
  100,
);
const loadTestCardIDs = new Set();
for (let index = 0; index < largeBatchAnnotations.length; index++) {
  const key = `LOAD${String(index + 1).padStart(3, "0")}`;
  const markdown = await fs.readFile(
    path.join(largeBatchFolder, "Annotations", `${key}.md`),
    "utf8",
  );
  assert.equal(
    readFrontmatterValue(markdown, "bridge_source_id"),
    `user:0/annotation/${key}`,
  );
  assert.equal(readFrontmatterValue(markdown, "zotero_annotation_key"), key);
  if (index === 1) {
    assert.equal(
      readFrontmatterValue(markdown, "zotero_attachment_key"),
      "ATTACH02",
    );
    assert.match(
      markdown,
      /zotero:\/\/open-pdf\/library\/items\/ATTACH02\?page=2/,
    );
  }
  const cardID = readFrontmatterValue(markdown, "bridge_card_id");
  assert.ok(!loadTestCardIDs.has(cardID));
  loadTestCardIDs.add(cardID);
  if (index === 0) {
    assert.equal(readFrontmatterValue(markdown, "zotero_page_index"), null);
    assert.match(markdown, /## Page iv/);
    assert.doesNotMatch(markdown, /\?page=/);
  } else {
    assert.ok(markdown.includes(`Load-test highlight ${index + 1}`));
  }
}
assert.equal(loadTestCardIDs.size, 100);

const historicalAnnotations = Array.from({ length: 4 }, (_, index) => ({
  id: 3000 + index,
  key: `HIST${String(index + 1).padStart(3, "0")}`,
  libraryID: 1,
  parentItem: attachment,
  deleted: false,
  isAnnotation: () => true,
  annotationPosition: JSON.stringify({ pageIndex: index }),
  annotationPageLabel: String(index + 1),
  annotationText: `Historical import highlight ${index + 1}`,
  annotationComment: "",
  annotationColor: "#ffd400",
}));
savedAnnotations = historicalAnnotations;
const historicalFolder = path.join(largeBatchFolder, "Annotations");
await importAllSavedAnnotations(
  { itemID: attachment.id },
  String(historicalAnnotations[1].id),
);
assert.match(confirmations.at(-1), /Import 4 saved annotations/);
assert.equal(
  (await fs.readdir(historicalFolder)).filter(
    (name) => name.startsWith("HIST") && name.endsWith(".md"),
  ).length,
  historicalAnnotations.length,
);
const firstImportCardIDs = new Set();
for (const item of historicalAnnotations) {
  const note = await fs.readFile(
    path.join(historicalFolder, `${item.key}.md`),
    "utf8",
  );
  firstImportCardIDs.add(readFrontmatterValue(note, "bridge_card_id"));
}
await importAllSavedAnnotations(
  { itemID: attachment.id },
  String(historicalAnnotations[1].id),
);
const secondImportCardIDs = new Set();
for (const item of historicalAnnotations) {
  const note = await fs.readFile(
    path.join(historicalFolder, `${item.key}.md`),
    "utf8",
  );
  secondImportCardIDs.add(readFrontmatterValue(note, "bridge_card_id"));
}
assert.deepEqual(secondImportCardIDs, firstImportCardIDs);
assert.equal(secondImportCardIDs.size, historicalAnnotations.length);

savedAnnotations = [];
await assert.rejects(
  createCardFromAnnotation(
    { itemID: attachment.id },
    { id: "NO_TEXT_ANNOTATION" },
    ["NO_TEXT_ANNOTATION"],
  ),
  /No saved annotation was found/,
);
savedAnnotations = [annotation, batchAnnotation, failingBatchAnnotation];

const cancelBatchAnnotations = Array.from({ length: 10 }, (_, index) => {
  const key = `CANCEL${String(index + 1).padStart(3, "0")}`;
  return {
    id: 2000 + index,
    key,
    libraryID: 1,
    parentItem: attachment,
    isAnnotation: () => true,
    annotationPosition: JSON.stringify({ pageIndex: index }),
    annotationPageLabel: String(index + 1),
    annotationText: `Cancellation fixture ${index + 1}`,
    annotationComment: "",
    annotationColor: "#ffd400",
  };
});
savedAnnotations = cancelBatchAnnotations;
cancelBatchAfter = 5;
const cancelBatchIDs = cancelBatchAnnotations.map((item) => String(item.id));
await createCardFromAnnotation(
  { itemID: attachment.id },
  { id: cancelBatchIDs[0] },
  cancelBatchIDs,
);
const cancelledBatchFolder = path.join(
  literaturePath,
  "Updated Neural Mass Model (user-0-PAPER01)",
  "Annotations",
);
const cancelledCards = (await fs.readdir(cancelledBatchFolder)).filter((name) =>
  name.startsWith("CANCEL"),
);
assert.equal(cancelledCards.length, 5);
for (let index = 0; index < 5; index++) {
  assert.equal(
    await exists(
      path.join(
        cancelledBatchFolder,
        `CANCEL${String(index + 1).padStart(3, "0")}.md`,
      ),
    ),
    true,
  );
}
assert.equal(
  await exists(path.join(cancelledBatchFolder, "CANCEL006.md")),
  false,
);
assert.match(alerts.at(-1), /已处理 5\/10 条批注/);
assert.match(alerts.at(-1), /Batch cancelled by user/);

const inFlightAnnotations = Array.from({ length: 3 }, (_, index) => ({
  id: 8100 + index,
  key: `R6CANCEL00${index + 1}`,
  libraryID: 1,
  parentItem: attachment,
  isAnnotation: () => true,
  annotationPosition: JSON.stringify({ pageIndex: index }),
  annotationPageLabel: String(index + 1),
  annotationText: `In-flight cancellation ${index + 1}`,
  annotationComment: "",
  annotationColor: "#ffd400",
}));
savedAnnotations = inFlightAnnotations;
let startBlockedWrite;
let releaseBlockedWrite;
const blockedWriteStarted = new Promise((resolve) => {
  startBlockedWrite = resolve;
});
const blockedWriteWait = new Promise((resolve) => {
  releaseBlockedWrite = resolve;
});
gatedCardWrite = {
  marker: "zotero_annotation_key: R6CANCEL001",
  started: startBlockedWrite,
  wait: blockedWriteWait,
};
const inFlightIDs = inFlightAnnotations.map((item) => String(item.id));
const inFlightBatch = createCardFromAnnotation(
  { itemID: attachment.id },
  { id: inFlightIDs[0] },
  inFlightIDs,
);
await withTimeout(
  blockedWriteStarted,
  5000,
  "Timed out waiting for gated write",
);
let vaultWritesDrained = false;
const vaultWriteWait = waitForVaultWrites().then(() => {
  vaultWritesDrained = true;
});
await Promise.resolve();
assert.equal(vaultWritesDrained, false);
assert.equal(cancelAnnotationBatch(), true);
releaseBlockedWrite();
await withTimeout(
  inFlightBatch,
  10000,
  "Timed out waiting for cancelled batch",
);
await vaultWriteWait;
assert.equal(vaultWritesDrained, true);
assert.equal(cancelAnnotationBatch(), false);
const inFlightFolder = path.join(
  literaturePath,
  "Updated Neural Mass Model (user-0-PAPER01)",
  "Annotations",
);
assert.equal(await exists(path.join(inFlightFolder, "R6CANCEL001.md")), true);
assert.equal(await exists(path.join(inFlightFolder, "R6CANCEL002.md")), false);
assert.equal(await exists(path.join(inFlightFolder, "R6CANCEL003.md")), false);
savedAnnotations = [annotation, batchAnnotation, failingBatchAnnotation];

const companionQueue = path.join(dataPath, "companion-queue");
const lateRequestId = "e59a0602-4fc4-49f6-bcea-5aaae8be42a8";
const lateSourceID = "user:0/annotation/LATE001";
const malformedRequestId = "ef9889bf-dadd-43ca-bd3f-7b1f5a8e7f12";
await fs.mkdir(path.join(companionQueue, "requests"), { recursive: true });
await fs.mkdir(path.join(companionQueue, "responses"), { recursive: true });
await fs.writeFile(
  path.join(companionQueue, "requests", `${lateRequestId}.json`),
  JSON.stringify({ requestId: lateRequestId, sourceId: lateSourceID }),
);
await fs.writeFile(
  path.join(companionQueue, "responses", `${lateRequestId}.json`),
  JSON.stringify({
    protocolVersion: 2,
    requestId: lateRequestId,
    status: "applied",
    revision: "a".repeat(64),
    completedAt: new Date().toISOString(),
  }),
);
await fs.writeFile(
  path.join(companionQueue, "requests", `${malformedRequestId}.json`),
  "{ malformed request",
);
await fs.writeFile(
  path.join(companionQueue, "responses", `${malformedRequestId}.json`),
  JSON.stringify({
    protocolVersion: 2,
    requestId: malformedRequestId,
    status: "applied",
    revision: "b".repeat(64),
    completedAt: new Date().toISOString(),
  }),
);
prefs.set(
  "extensions.zotero.zoteroobsidianbridge.companionQueuePath",
  companionQueue,
);
const { acknowledgeCompanionResponses } =
  await import("../src/adapters/companion-queue.ts");
const { hasPendingCompanionRequests } =
  await import("../src/adapters/companion-queue.ts");
const lateAckPath = path.join(companionQueue, "acks", `${lateRequestId}.json`);
assert.equal(await hasPendingCompanionRequests(), true);
await assert.rejects(
  acknowledgeCompanionResponses(async () => {
    assert.equal(await exists(lateAckPath), false);
    throw new Error("simulated reconciliation persistence failure");
  }),
  /simulated reconciliation persistence failure/,
);
assert.equal(await exists(lateAckPath), false);
assert.deepEqual(
  await acknowledgeCompanionResponses(async (sourceIDs) => {
    assert.deepEqual(sourceIDs, [lateSourceID]);
    assert.equal(await exists(lateAckPath), false);
  }),
  [lateSourceID],
);
assert.equal(await exists(lateAckPath), true);
assert.equal(
  await exists(path.join(companionQueue, "acks", `${malformedRequestId}.json`)),
  false,
);
assert.equal(await hasPendingCompanionRequests(), true);
await fs.rm(path.join(companionQueue, "requests", `${lateRequestId}.json`));
await fs.rm(path.join(companionQueue, "responses", `${lateRequestId}.json`));
await fs.rm(lateAckPath);
await fs.rm(
  path.join(companionQueue, "requests", `${malformedRequestId}.json`),
);
await fs.rm(
  path.join(companionQueue, "responses", `${malformedRequestId}.json`),
);
assert.equal(await hasPendingCompanionRequests(), false);

const parentedAttachment = annotation.parentItem;
const originalAnnotationPosition = annotation.annotationPosition;
const originalAnnotationPageLabel = annotation.annotationPageLabel;
syncMode = false;
activeLibraryID = 1;
annotation.annotationPosition = JSON.stringify({ pageIndex: 0 });
annotation.annotationPageLabel = "i";
const standaloneAttachment = {
  id: 901,
  key: "ORPHAN01",
  parentItemID: false,
  isAnnotation: () => false,
  isAttachment: () => true,
  getField(field) {
    return field === "title" ? "独立 PDF：中文/测试?" : "standalone.pdf";
  },
};
annotation.parentItem = standaloneAttachment;
await createCardFromAnnotation({}, { key: "ORPHANANN", libraryID: 1 });
annotation.parentItem = parentedAttachment;
annotation.annotationPosition = originalAnnotationPosition;
annotation.annotationPageLabel = originalAnnotationPageLabel;

const standaloneFolderName = (await fs.readdir(literaturePath)).find((name) =>
  name.endsWith("(user-0-ORPHAN01)"),
);
assert.equal(standaloneFolderName, "独立 PDF：中文 测试 (user-0-ORPHAN01)");
const standaloneFolder = path.join(literaturePath, standaloneFolderName);
const standalonePaper = await fs.readFile(
  path.join(standaloneFolder, "Paper.md"),
  "utf8",
);
const standaloneCardPath = path.join(
  standaloneFolder,
  "Annotations",
  "ORPHANANN.md",
);
const standaloneCard = await fs.readFile(standaloneCardPath, "utf8");
assert.equal(
  readFrontmatterValue(standalonePaper, "zotero_title"),
  "独立 PDF：中文/测试?",
);
assert.equal(
  readFrontmatterValue(standalonePaper, "zotero_uri"),
  "zotero://select/library/items/ORPHAN01",
);
assert.equal(
  readFrontmatterValue(standaloneCard, "zotero_attachment_key"),
  "ORPHAN01",
);
assert.equal(readFrontmatterValue(standaloneCard, "zotero_page_index"), 0);
assert.equal(readFrontmatterValue(standaloneCard, "zotero_page_label"), "i");
assert.equal(
  readFrontmatterValue(standaloneCard, "zotero_uri"),
  "zotero://open-pdf/library/items/ORPHAN01?page=1",
);
assert.match(standaloneCard, /## Page i/);
assert.equal(
  new URL(launchedURLs.at(-1)).searchParams.get("path"),
  standaloneCardPath,
);

const { importNativeNote } =
  await import("../src/services/native-note-card.ts");
const { noteSourceID } = await import("../src/core/models.ts");
let nativeNoteTitle = "A native research note";
let nativeNoteHTML =
  "<html><body><h1>Native note source</h1><p>Initial Zotero content.</p><table><tr><th>Term</th><th>Meaning</th></tr><tr><td>Kernel</td><td>Similarity</td></tr></table></body></html>";
const nativeNote = {
  key: "NOTE001",
  libraryID: 1,
  parentItem: parent,
  isNote: () => true,
  deleted: false,
  getNoteTitle: () => nativeNoteTitle,
  getNote: () => nativeNoteHTML,
  getAttachments: () => [],
};
const nativeNoteSourceID = noteSourceID({ type: "user", typeID: 0 }, "NOTE001");
await importNativeNote(nativeNote);
let nativeIndex = await readCardIndex(indexPath);
const nativeEntry = nativeIndex.cards[nativeNoteSourceID];
assert.ok(nativeEntry);
const nativeCardPath = path.join(vaultPath, nativeEntry.relativePath);
let nativeCard = await fs.readFile(nativeCardPath, "utf8");
assert.equal(readFrontmatterValue(nativeCard, "type"), "zotero-note");
assert.equal(
  readFrontmatterValue(nativeCard, "bridge_source_id"),
  nativeNoteSourceID,
);
assert.equal(
  readFrontmatterValue(nativeCard, "zotero_note_title"),
  nativeNoteTitle,
);
assert.equal(
  readFrontmatterValue(nativeCard, "zotero_parent_item_key"),
  "PAPER01",
);
assert.match(nativeCard, /\| Term \| Meaning \|/);
assert.match(nativeCard, /Initial Zotero content\./);
nativeCard += "Personal addition that must survive a Zotero refresh.\n";
await fs.writeFile(nativeCardPath, nativeCard, "utf8");
nativeNoteTitle = "Updated native note title";
nativeNoteHTML =
  "<html><body><h2>Updated source</h2><p>Latest Zotero content.</p></body></html>";
await importNativeNote(nativeNote);
nativeIndex = await readCardIndex(indexPath);
assert.equal(nativeIndex.cards[nativeNoteSourceID].cardID, nativeEntry.cardID);
assert.equal(
  nativeIndex.cards[nativeNoteSourceID].relativePath,
  nativeEntry.relativePath,
);
nativeCard = await fs.readFile(nativeCardPath, "utf8");
assert.equal(
  readFrontmatterValue(nativeCard, "zotero_note_title"),
  nativeNoteTitle,
);
assert.match(nativeCard, /Latest Zotero content\./);
assert.doesNotMatch(nativeCard, /Initial Zotero content\./);
assert.match(
  nativeCard,
  /Personal addition that must survive a Zotero refresh\./,
);
assert.equal(
  nativeCard.split("<!-- zotero-obsidian-bridge:source:start -->").length - 1,
  1,
);

const standaloneNativeNote = {
  ...nativeNote,
  key: "NOTE002",
  parentItem: null,
};
await importNativeNote(standaloneNativeNote);
nativeIndex = await readCardIndex(indexPath);
assert.match(
  nativeIndex.cards[noteSourceID({ type: "user", typeID: 0 }, "NOTE002")]
    .relativePath,
  /Standalone Notes \(user-0\)\//,
);

syncMode = true;
syncRecords.set("1:NOTE001", nativeNote);
await startSyncQueue();
nativeNoteHTML =
  "<html><body><p>Queue-refreshed Zotero note content.</p></body></html>";
await queueSourceSync(nativeNoteSourceID, "modify");
await flushSyncQueue();
nativeCard = await fs.readFile(nativeCardPath, "utf8");
assert.match(nativeCard, /Queue-refreshed Zotero note content\./);
assert.match(
  nativeCard,
  /Personal addition that must survive a Zotero refresh\./,
);
syncRecords.delete("1:NOTE001");
await queueSourceSync(nativeNoteSourceID, "delete");
await flushSyncQueue();
nativeCard = await fs.readFile(nativeCardPath, "utf8");
assert.equal(
  readFrontmatterValue(nativeCard, "bridge_source_status"),
  "missing",
);
assert.equal(
  readFrontmatterValue(nativeCard, "bridge_source_missing_reason"),
  "zotero-deleted",
);
assert.match(nativeCard, /Queue-refreshed Zotero note content\./);
assert.match(
  nativeCard,
  /Personal addition that must survive a Zotero refresh\./,
);
await stopSyncQueue();
syncMode = false;

let r6Results = null;
if (process.env.R6_STRESS === "1") {
  const makeR6Annotation = (key, id, fields = {}) => ({
    id,
    key,
    libraryID: 1,
    parentItem: attachment,
    isAnnotation: () => true,
    annotationPosition: JSON.stringify({ pageIndex: id % 300 }),
    annotationPageLabel: String((id % 300) + 1),
    annotationText: `R6 test annotation ${key}`,
    annotationComment: "",
    annotationColor: "#ffd400",
    ...fields,
  });
  const createOneR6Card = async (item) => {
    savedAnnotations = [item];
    await createCardFromAnnotation(
      { itemID: attachment.id },
      { id: String(item.id) },
      [String(item.id)],
    );
  };

  const diskFailure = makeR6Annotation("R6DISK001", 90001);
  failCardWriteMarker = "zotero_annotation_key: R6DISK001";
  await assert.rejects(
    createOneR6Card(diskFailure),
    /injected card-content write failure/,
  );
  assert.equal(await exists(path.join(inFlightFolder, "R6DISK001.md")), false);
  await createOneR6Card(diskFailure);
  assert.equal(await exists(path.join(inFlightFolder, "R6DISK001.md")), true);

  const permissionFailure = makeR6Annotation("R6PERM001", 90007);
  failCardWriteMarker = "zotero_annotation_key: R6PERM001";
  failCardWriteCode = "EACCES";
  await assert.rejects(
    createOneR6Card(permissionFailure),
    (error) => error.code === "EACCES",
  );
  assert.equal(await exists(path.join(inFlightFolder, "R6PERM001.md")), false);
  await createOneR6Card(permissionFailure);
  assert.equal(await exists(path.join(inFlightFolder, "R6PERM001.md")), true);

  const filesystemPermissionFailure = makeR6Annotation("R6PERM002", 90008);
  const originalDirectoryMode = (await fs.stat(inFlightFolder)).mode & 0o777;
  await fs.chmod(inFlightFolder, originalDirectoryMode & ~0o222);
  try {
    await assert.rejects(
      createOneR6Card(filesystemPermissionFailure),
      (error) => error.code === "EACCES" || error.code === "EPERM",
    );
    assert.equal(
      await exists(path.join(inFlightFolder, "R6PERM002.md")),
      false,
    );
  } finally {
    await fs.chmod(inFlightFolder, originalDirectoryMode);
  }
  await createOneR6Card(filesystemPermissionFailure);
  assert.equal(await exists(path.join(inFlightFolder, "R6PERM002.md")), true);

  const indexFailure = makeR6Annotation("R6INDEX001", 90002);
  const indexFailureSource = "user:0/annotation/R6INDEX001";
  failIndexWrite = true;
  await assert.rejects(
    createOneR6Card(indexFailure),
    /injected card-index write failure/,
  );
  const indexFailureCardPath = path.join(inFlightFolder, "R6INDEX001.md");
  assert.equal(await exists(indexFailureCardPath), true);
  let r6Index = await readCardIndex(indexPath);
  assert.equal(r6Index.cards[indexFailureSource], undefined);
  const indexFailureCardID = readFrontmatterValue(
    await fs.readFile(indexFailureCardPath, "utf8"),
    "bridge_card_id",
  );
  await createOneR6Card(indexFailure);
  r6Index = await readCardIndex(indexPath);
  assert.equal(r6Index.cards[indexFailureSource].cardID, indexFailureCardID);
  assert.equal(
    (await fs.readdir(inFlightFolder)).filter((name) =>
      name.startsWith("R6INDEX001"),
    ).length,
    1,
  );

  const checkpointAnnotations = Array.from({ length: 30 }, (_, index) =>
    makeR6Annotation(
      `R6CKPT-${String(index + 1).padStart(3, "0")}`,
      91000 + index,
    ),
  );
  savedAnnotations = checkpointAnnotations;
  failIndexWrite = true;
  const checkpointIDs = checkpointAnnotations.map((item) => String(item.id));
  await createCardFromAnnotation(
    { itemID: attachment.id },
    { id: checkpointIDs[0] },
    checkpointIDs,
  );
  assert.deepEqual(lastBatchProgressSnapshot, {
    completed: 30,
    total: 30,
    finished: true,
    headline: "批注卡片处理完成：30/30",
  });
  r6Index = await readCardIndex(indexPath);
  const checkpointEntries = Object.entries(r6Index.cards).filter(([sourceID]) =>
    sourceID.startsWith("user:0/annotation/R6CKPT-"),
  );
  assert.equal(checkpointEntries.length, checkpointAnnotations.length);
  assert.equal(
    new Set(checkpointEntries.map(([, entry]) => entry.cardID)).size,
    checkpointAnnotations.length,
  );

  const largeText = "large research note payload ".repeat(10000);
  const largeTextAnnotation = makeR6Annotation("R6BIGTXT001", 90003, {
    annotationText: largeText,
  });
  await createOneR6Card(largeTextAnnotation);
  assert.ok(
    (
      await fs.readFile(path.join(inFlightFolder, "R6BIGTXT001.md"), "utf8")
    ).includes(largeText),
  );

  const imageKey = "R6IMAGE001";
  const imageAnnotation = makeR6Annotation(imageKey, 90004, {
    annotationType: "image",
    annotationText: "Large image resource fixture",
  });
  const imageCachePath = path.join(dataPath, "image-cache", `${imageKey}.png`);
  const imageBytes = new Uint8Array(2 * 1024 * 1024);
  imageBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  imageBytes.set(Buffer.from("R6 image resource payload"), 32);
  await fs.mkdir(path.dirname(imageCachePath), { recursive: true });
  await fs.writeFile(imageCachePath, imageBytes);
  imageCachePaths.set(imageKey, imageCachePath);
  const previousImageDecoder = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({
    width: 1,
    height: 1,
    close() {},
  });
  failResourceCommit = true;
  await assert.rejects(
    createOneR6Card(imageAnnotation),
    /injected resource commit failure/,
  );
  const imageAssetsFolder = path.join(inFlightFolder, "assets");
  assert.equal(
    await exists(path.join(inFlightFolder, `${imageKey}.md`)),
    false,
  );
  assert.equal(
    (await fs.readdir(imageAssetsFolder)).some((name) =>
      name.startsWith(`${imageKey}-`),
    ),
    false,
  );
  await createOneR6Card(imageAnnotation);
  globalThis.createImageBitmap = previousImageDecoder;
  const imageAssetNames = (await fs.readdir(imageAssetsFolder)).filter((name) =>
    name.startsWith(`${imageKey}-`),
  );
  assert.equal(imageAssetNames.length, 1);
  const exportedImage = await fs.readFile(
    path.join(imageAssetsFolder, imageAssetNames[0]),
  );
  assert.deepEqual(exportedImage, Buffer.from(imageBytes));
  assert.equal(
    imageAssetNames[0],
    `${imageKey}-${createHash("sha256").update(imageBytes).digest("hex")}.png`,
  );
  assert.match(
    await fs.readFile(path.join(inFlightFolder, `${imageKey}.md`), "utf8"),
    new RegExp(`assets/${imageKey}-[a-f0-9]{64}\\.png`),
  );

  const duplicateSourceID = "user:0/annotation/R6DUP001";
  for (const suffix of ["A", "B"]) {
    await fs.writeFile(
      path.join(inFlightFolder, `R6DUPLICATE-${suffix}.md`),
      `---\nbridge_card_id: duplicate-${suffix}\nbridge_source_id: ${duplicateSourceID}\n---\n\nExisting card.\n`,
    );
  }
  const duplicateAnnotations = [
    makeR6Annotation("R6DUP001", 90005),
    makeR6Annotation("R6DUP002", 90006),
  ];
  savedAnnotations = duplicateAnnotations;
  await createCardFromAnnotation(
    { itemID: attachment.id },
    { id: String(duplicateAnnotations[0].id) },
    duplicateAnnotations.map((item) => String(item.id)),
  );
  assert.match(alerts.at(-1), /Multiple Markdown cards match bridge_source_id/);
  assert.equal(await exists(path.join(inFlightFolder, "R6DUP001.md")), false);
  assert.equal(await exists(path.join(inFlightFolder, "R6DUP002.md")), true);

  const benchmarkResults = [];
  const memoryAtStart = process.memoryUsage().rss;
  for (const size of [1, 100, 1000]) {
    const label = String(size).padStart(4, "0");
    const annotations = Array.from({ length: size }, (_, index) =>
      makeR6Annotation(
        `R6LOAD-${label}-${String(index + 1).padStart(4, "0")}`,
        100000 + size * 2000 + index,
      ),
    );
    savedAnnotations = annotations;
    const selectedIDs = annotations.map((item) => String(item.id));
    const start = performance.now();
    if (size === 1) {
      await createCardFromAnnotation(
        { itemID: attachment.id },
        { id: selectedIDs[0] },
        selectedIDs,
      );
    } else {
      r6CurrentBatchMetrics = {
        completed: 0,
        finished: false,
        lastCompletionAt: start,
        latencies: [],
        maxRssBytes: process.memoryUsage().rss,
      };
      await createCardFromAnnotation(
        { itemID: attachment.id },
        { id: selectedIDs[0] },
        selectedIDs,
      );
    }
    const elapsedMs = performance.now() - start;
    const progressMetrics = r6CurrentBatchMetrics;
    r6CurrentBatchMetrics = null;
    const prefix = `user:0/annotation/R6LOAD-${label}-`;
    r6Index = await readCardIndex(indexPath);
    const indexedCards = Object.entries(r6Index.cards).filter(([sourceID]) =>
      sourceID.startsWith(prefix),
    );
    const cardIDs = new Set(indexedCards.map(([, entry]) => entry.cardID));
    assert.equal(indexedCards.length, size);
    assert.equal(cardIDs.size, size);
    if (size > 1) {
      assert.equal(progressMetrics.completed, size);
      assert.equal(progressMetrics.finished, true);
      assert.equal(progressMetrics.latencies.length, size);
    }
    const latencies =
      size === 1
        ? [elapsedMs]
        : [...progressMetrics.latencies].sort((a, b) => a - b);
    const percentile = (fraction) =>
      latencies[Math.max(0, Math.ceil(latencies.length * fraction) - 1)];
    benchmarkResults.push({
      input: size,
      success: indexedCards.length,
      failed: 0,
      pending: 0,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      perItemP50Ms: Number(percentile(0.5).toFixed(2)),
      perItemP95Ms: Number(percentile(0.95).toFixed(2)),
      peakObservedProcessRssMiB: Number(
        (
          Math.max(
            progressMetrics?.maxRssBytes ?? 0,
            process.memoryUsage().rss,
          ) /
          1024 /
          1024
        ).toFixed(1),
      ),
      queueDrained: progressMetrics?.finished ?? true,
    });
    assert.equal(
      benchmarkResults.at(-1).input,
      benchmarkResults.at(-1).success +
        benchmarkResults.at(-1).failed +
        benchmarkResults.at(-1).pending,
    );
  }
  r6Results = {
    capturedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    processRssMiBAtStart: Number((memoryAtStart / 1024 / 1024).toFixed(1)),
    benchmarks: benchmarkResults,
    largeTextBytes: Buffer.byteLength(largeText),
    imageBytes: imageBytes.byteLength,
    injectedFailures: [
      "card-content write before commit",
      "card-index write after card creation, followed by idempotent retry",
      "image resource move/commit, followed by successful retry",
      "injected EACCES card write, followed by successful retry",
      "one-shot batch index checkpoint write, recovered by one immediate retry",
    ],
    batchCheckpointRetryPass: true,
    permissionDeniedRecoveryPass: true,
    actualFilesystemPermissionDeniedRecoveryPass: true,
    batchDuplicateIdentityFailClosed: true,
    inFlightCancellation: {
      currentWriteCompleted: true,
      followingCardsStarted: false,
      vaultWriteWaiterReleased: true,
    },
  };
  await fs.writeFile(
    path.join(projectRoot, ".scaffold/r6-stress-results.json"),
    `${JSON.stringify(r6Results, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(r6Results, null, 2)}\n`);
}

process.stdout.write(
  "Isolated smoke tests passed: parented and standalone PDFs and Zotero notes, duplicate note updates, user-content preservation, Chinese titles, multi-PDF mapping, 100-card import, queue recovery, and editor conflicts.\n",
);
