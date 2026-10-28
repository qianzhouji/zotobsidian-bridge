import assert from "node:assert/strict";
import process from "node:process";
import {
  assertAllowedCompanionPath,
  assertCompanionVaultPairing,
  COMPANION_PROTOCOL_VERSION,
  MAX_COMPANION_RESOURCE_BYTES,
  isValidCompanionVaultId,
  normalizeVaultRelativePath,
  validateCompanionResponse,
  validateCompanionRequest,
} from "../src/adapters/companion-protocol.ts";
import { transitionWriterMode } from "../src/core/writer-transition.ts";

assert.equal(
  assertAllowedCompanionPath(
    "Zotero Literature/Paper/Annotations/ABC.md",
    "Zotero Literature",
  ),
  "Zotero Literature/Paper/Annotations/ABC.md",
);
assert.doesNotThrow(() =>
  assertCompanionVaultPairing(
    "4b0481d2-8550-4f5b-bd26-61c461f995d2",
    "4b0481d2-8550-4f5b-bd26-61c461f995d2",
  ),
);
assert.equal(
  isValidCompanionVaultId("4b0481d2-8550-4f5b-bd26-61c461f995d2"),
  true,
);
assert.equal(isValidCompanionVaultId("not-a-vault-id"), false);
assert.throws(
  () =>
    assertCompanionVaultPairing(
      "4b0481d2-8550-4f5b-bd26-61c461f995d2",
      "dd23f8bb-b01a-483c-99af-34c76d2427f2",
    ),
  /different Obsidian Vault/,
);
assert.equal(
  normalizeVaultRelativePath("Zotero\\Literature"),
  "Zotero/Literature",
);
assert.throws(
  () => assertAllowedCompanionPath("Other/ABC.md", "Zotero Literature"),
  /configured output folder/,
);
assert.throws(() => normalizeVaultRelativePath("../outside.md"), /normalized/);
assert.throws(() => normalizeVaultRelativePath("/absolute.md"), /normalized/);
const request = {
  protocolVersion: COMPANION_PROTOCOL_VERSION,
  requestId: "8d607498-8e20-44e0-9cbe-f7da47d6758a",
  targetVaultId: "4b0481d2-8550-4f5b-bd26-61c461f995d2",
  createdAt: "2026-10-26T00:00:00.000Z",
  operation: "replace",
  cardId: "f118c536-7cc4-4a6d-8f68-b7a5353f4579",
  sourceId: "user:0/annotation/ANN001",
  outputFolder: "Zotero Literature",
  relativePath: "Zotero Literature/Paper/Annotations/ANN001.md",
  baseRevision: "a".repeat(64),
  content: "---\nbridge_card_id: f118c536-7cc4-4a6d-8f68-b7a5353f4579\n---\n",
  recoveryRelativePath: "Zotero Literature/Paper/Bridge Recovery/ANN001.bak",
  recoveryContent: "prior revision",
};
assert.equal(
  validateCompanionRequest(request, "Zotero Literature").relativePath,
  request.relativePath,
);
const noteCardId = "b60f00a9-934b-48db-8b52-53045bb3fd79";
const nativeNoteRequest = {
  ...request,
  operation: "create",
  cardId: noteCardId,
  sourceId: "user:0/note/NOTE001",
  relativePath: "Zotero Literature/Paper/Notes/NOTE001.md",
  baseRevision: null,
  recoveryRelativePath: undefined,
  recoveryContent: undefined,
  content: `---\nbridge_card_id: ${noteCardId}\nbridge_source_id: user:0/note/NOTE001\n---\n\nNative note.\n`,
};
assert.equal(
  validateCompanionRequest(nativeNoteRequest, "Zotero Literature").sourceId,
  "user:0/note/NOTE001",
);
const resourceRequest = {
  protocolVersion: COMPANION_PROTOCOL_VERSION,
  requestId: "8d607498-8e20-44e0-9cbe-f7da47d67589",
  createdAt: "2026-10-26T00:00:00.000Z",
  operation: "create-resource",
  cardId: noteCardId,
  sourceId: "user:0/note/NOTE001",
  targetVaultId: "4b0481d2-8550-4f5b-bd26-61c461f995d2",
  outputFolder: "Zotero Literature",
  relativePath: `Zotero Literature/Paper/Notes/assets/NOTE001-${"c".repeat(64)}.png`,
  baseRevision: null,
  resourceMimeType: "image/png",
  resourceSha256: "c".repeat(64),
  resourceSizeBytes: 68,
};
assert.equal(
  validateCompanionRequest(resourceRequest, "Zotero Literature").operation,
  "create-resource",
);
assert.throws(
  () =>
    validateCompanionRequest(
      {
        ...resourceRequest,
        relativePath: `Zotero Literature/Paper/Notes/assets/NOTE001-${"c".repeat(64)}.jpg`,
      },
      "Zotero Literature",
    ),
  /metadata is malformed/,
);
assert.throws(
  () =>
    validateCompanionRequest(
      {
        ...resourceRequest,
        resourceSizeBytes: MAX_COMPANION_RESOURCE_BYTES + 1,
      },
      "Zotero Literature",
    ),
  /metadata is malformed/,
);
assert.throws(
  () =>
    validateCompanionRequest(
      {
        ...resourceRequest,
        relativePath: "Zotero Literature/assets/other.png",
      },
      "Zotero Literature",
    ),
  /metadata is malformed/,
);
assert.equal(
  validateCompanionResponse(
    {
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      requestId: request.requestId,
      status: "applied",
      revision: "b".repeat(64),
      completedAt: "2026-10-26T00:00:00.000Z",
    },
    request.requestId,
  ).status,
  "applied",
);
assert.throws(
  () =>
    validateCompanionResponse(
      {
        protocolVersion: COMPANION_PROTOCOL_VERSION,
        requestId: request.requestId,
        status: "applied",
        completedAt: "2026-10-26T00:00:00.000Z",
      },
      request.requestId,
    ),
  /invalid companion response/,
);
assert.throws(
  () =>
    validateCompanionRequest(
      { ...request, protocolVersion: 1 },
      "Zotero Literature",
    ),
  /malformed or incompatible/,
);
assert.throws(
  () =>
    validateCompanionRequest(
      { ...request, relativePath: "Zotero Literature/card.json" },
      "Zotero Literature",
    ),
  /Markdown notes/,
);
assert.throws(
  () =>
    validateCompanionRequest(
      { ...request, outputFolder: "Other" },
      "Zotero Literature",
    ),
  /outputFolder/,
);
assert.throws(
  () =>
    validateCompanionRequest(
      { ...request, sourceId: "unregistered/arbitrary/path" },
      "Zotero Literature",
    ),
  /malformed or incompatible/,
);
assert.throws(
  () =>
    validateCompanionRequest(
      { ...request, cardId: "some-other-id" },
      "Zotero Literature",
    ),
  /malformed or incompatible/,
);
assert.throws(
  () =>
    validateCompanionRequest(
      { ...request, recoveryRelativePath: "Zotero Literature/bad.md" },
      "Zotero Literature",
    ),
  /\.bak extension/,
);
assert.throws(
  () =>
    validateCompanionRequest(
      { ...request, operation: "create", baseRevision: "a".repeat(64) },
      "Zotero Literature",
    ),
  /malformed or incompatible/,
);

const modeTransitions = [];
let writesDrained = false;
await transitionWriterMode("direct", "companion", {
  setMode: (mode) => modeTransitions.push(mode),
  waitForWrites: async () => {
    writesDrained = true;
  },
  requestsPending: async () => false,
});
assert.equal(writesDrained, true);
assert.deepEqual(modeTransitions, ["transition", "companion"]);

const failedTransitions = [];
await assert.rejects(
  transitionWriterMode("companion", "direct", {
    setMode: (mode) => failedTransitions.push(mode),
    waitForWrites: async () => {},
    requestsPending: async () => true,
    timeoutMs: 0,
    pollIntervalMs: 0,
  }),
  /queue is still pending/,
);
assert.deepEqual(failedTransitions, ["transition", "companion"]);

process.stdout.write("Companion protocol checks passed.\n");
