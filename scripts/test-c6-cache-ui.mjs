import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import { setTimeout as delay } from "node:timers/promises";
import { parseHTML } from "linkedom";
import { createKnowledgeNoteCard } from "../src/services/knowledge-note-card.ts";
import { knowledgeNoteMemoryCache } from "../src/core/note-query-cache.ts";

const { document, window } = parseHTML(
  '<html lang="en"><head></head><body><main id="cached-owner"></main><main id="empty-owner"></main></body></html>',
);
window.innerWidth = 1400;
window.innerHeight = 900;
window.AbortController = globalThis.AbortController;
window.atob = globalThis.atob;
window.Blob = globalThis.Blob;
let createdURLs = 0;
let revokedURLs = 0;
window.URL = {
  createObjectURL() {
    return `blob:c6-${++createdURLs}`;
  },
  revokeObjectURL() {
    revokedURLs++;
  },
};

const authorization = {
  vaultId: "c6-vault",
  pairingEpoch: "pair-1",
  readFolders: ["Math"],
};
const note = {
  path: "Math/Bayes.md",
  markdown: "# Bayes\n\nCached snapshot.\n\n![pixel](image.png)",
  revision: "r1",
  readAt: Date.now() - 10_000,
  indexGeneration: 1,
  metadata: { valid: true, revision: "r1", headings: [], blocks: [] },
};
const resolution = {
  path: note.path,
  revision: note.revision,
  indexGeneration: 1,
  anchorState: "none",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAAR0lEQVR4nO3PIRUAIBBEwSuEQ2BJRw2ikIEmNCDDCVDz3vc7G7v1VGfVVGXMVAEEBAQEBAQE9Bn0eiB7GAgICAgICAjoM+gCRcYIiGP22CMAAAAASUVORK5CYII=",
  "base64",
);
const resource = {
  path: "Math/image.png",
  mimeType: "image/png",
  base64: png.toString("base64"),
  byteLength: png.byteLength,
  revision: note.revision,
  readAt: note.readAt,
};
const resourceMap = new Map([[`${note.path}\0image.png`, resource]]);
let online = false;
let closes = 0;
let cacheAvailable = true;
const client = {
  cachePartition: "c6-ui-partition",
  async scope() {
    return JSON.stringify([
      authorization.vaultId,
      authorization.pairingEpoch,
      authorization.readFolders,
    ]);
  },
  async scopeIdentity() {
    return authorization;
  },
  async cachedResolution() {
    return cacheAvailable
      ? { resolved: resolution, note, staleRevision: false }
      : undefined;
  },
  async cachedResources() {
    return resourceMap;
  },
  async query(operation) {
    if (!online) return { status: "offline", operation };
    if (operation === "resolve-link")
      return { status: "ok", result: resolution };
    if (operation === "read-note")
      return {
        status: "ok",
        result: {
          ...note,
          markdown: note.markdown.replace(
            "Cached snapshot.",
            "Online confirmed.",
          ),
        },
      };
    if (operation === "read-note-resource")
      return { status: "ok", result: resource };
    throw new Error(`Unexpected ${operation}`);
  },
  invalidatePath() {
    cacheAvailable = false;
  },
  cancel() {},
  close() {
    closes++;
  },
};
const waitFor = async (predicate) => {
  for (let i = 0; i < 250; i++) {
    if (predicate()) return;
    await delay(4);
  }
  throw new Error("C6 UI condition timed out");
};

knowledgeNoteMemoryCache.activateScope(client.cachePartition, authorization);
const group = createKnowledgeNoteCard({
  owner: document.getElementById("cached-owner"),
  createClient: () => client,
  vaultPath: "/c6-vault",
  launchURL() {},
});
await group.open("Bayes", "Root.md");
const cachedPanel = document.querySelector(".zob-knowledge-card");
assert.ok(cachedPanel);
assert.equal(cachedPanel.dataset.state, "cached");
assert.match(
  cachedPanel.querySelector(".zob-knowledge-cache-warning").textContent,
  /Offline cached snapshot/,
);
assert.equal(
  cachedPanel.querySelector(".zob-knowledge-cache-warning").hidden,
  false,
);
assert.match(
  cachedPanel.querySelector(".zob-knowledge-body").textContent,
  /Cached snapshot/,
);
assert.equal(
  cachedPanel.querySelectorAll("img").length,
  1,
  "explicitly cached local images render offline",
);
assert.equal(createdURLs, 1);

online = true;
cachedPanel.querySelector('[data-zob-card-action="refresh"]').click();
await waitFor(() => cachedPanel.dataset.state === "ready");
assert.match(
  cachedPanel.querySelector(".zob-knowledge-body").textContent,
  /Online confirmed/,
);
assert.equal(
  cachedPanel.querySelector(".zob-knowledge-cache-warning").hidden,
  true,
);

authorization.pairingEpoch = "pair-2";
knowledgeNoteMemoryCache.activateScope(client.cachePartition, authorization);
assert.equal(
  document.querySelectorAll(".zob-knowledge-card").length,
  0,
  "pairing epoch changes close cards in the old scope",
);
assert.equal(document.querySelectorAll(".zob-knowledge-layer").length, 0);
assert.equal(closes, 1);
assert.equal(
  revokedURLs,
  createdURLs,
  "scope invalidation revokes rendered object URLs",
);

const noCacheClient = {
  ...client,
  cachePartition: "c6-empty-ui-partition",
  async cachedResolution() {
    return undefined;
  },
  async query() {
    return { status: "offline" };
  },
  close() {},
};
const emptyGroup = createKnowledgeNoteCard({
  owner: document.getElementById("empty-owner"),
  createClient: () => noCacheClient,
  vaultPath: "/c6-vault",
  launchURL() {},
});
await emptyGroup.open("NeverCached", "Root.md");
await waitFor(() =>
  document.querySelector('.zob-knowledge-card[data-state="error"]'),
);
const emptyPanel = document.querySelector(
  '.zob-knowledge-card[data-state="error"]',
);
assert.match(
  emptyPanel.querySelector(".zob-knowledge-status-details").textContent,
  /Offline/,
);
assert.equal(
  emptyPanel.querySelector(".zob-knowledge-body").textContent,
  "",
  "no-cache offline targets remain unavailable, never false empty notes",
);

group.dispose();
emptyGroup.dispose();
knowledgeNoteMemoryCache.clearAll();
console.log(
  "C6 UI checks passed: cached-first snapshot, online revalidation, offline warning, empty-cache failure and permission-scope resource cleanup.",
);
