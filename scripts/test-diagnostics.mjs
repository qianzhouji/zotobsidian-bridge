import assert from "node:assert/strict";
import process from "node:process";
import {
  classifyDiagnosticError,
  createDiagnosticReport,
  diagnosticGuidance,
} from "../src/core/diagnostics.ts";

assert.equal(
  classifyDiagnosticError("The companion Vault pairing ID does not match."),
  "companion",
);
assert.equal(
  classifyDiagnosticError("Card changed before write; conflict detected."),
  "conflict",
);
assert.equal(
  classifyDiagnosticError("EACCES: permission denied"),
  "permission",
);
assert.match(diagnosticGuidance("conflict"), /Open the linked card/);

const report = createDiagnosticReport({
  generatedAt: "2026-10-28T00:00:00.000Z",
  appVersion: "10.0.6",
  pluginVersion: "0.1.0",
  writerMode: "companion",
  companion: {
    configured: true,
    heartbeatAgeSeconds: 2,
    queueState: "available",
  },
  counts: { pending: 1, running: 0, done: 4, retry: 1, conflict: 0 },
  tasks: [
    {
      id: "operation-1",
      sourceID: "user:1/annotation/ANN001",
      status: "retry",
      attempts: 2,
      updatedAt: "2026-10-28T00:00:00.000Z",
      lastError:
        "Failed at /Users/private/Notes/My Vault/Paper.md with private note body",
    },
  ],
});

const serialized = JSON.stringify(report);
assert.equal(report.queue.failures.length, 1);
assert.equal(report.queue.failures[0].operationId, "operation-1");
assert.equal(report.queue.failures[0].sourceKind, "annotation");
assert.equal(report.queue.failures[0].errorType, "configuration");
assert.equal(report.privacy.noteBodiesIncluded, false);
assert.equal(report.privacy.absolutePathsIncluded, false);
assert.equal(report.privacy.rawErrorMessagesIncluded, false);
assert.ok(!serialized.includes("/Users/private"));
assert.ok(!serialized.includes("private note body"));
assert.ok(!serialized.includes("ANN001"));

process.stdout.write(
  "R5 diagnostics classification and privacy checks passed.\n",
);
