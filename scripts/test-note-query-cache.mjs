import assert from "node:assert/strict";
import console from "node:console";
import { NoteQueryMemoryCache } from "../src/core/note-query-cache.ts";

let now = 1000;
const limits = {
  maxBytes: 2 * 1024 * 1024,
  maxRecords: 2,
  maxPartitions: 2,
  maxResourcesPerNote: 320,
  ttlMs: 100,
};
const cache = new NoteQueryMemoryCache(() => now, limits);
const scope = {
  vaultId: "vault-a",
  pairingEpoch: "pair-a",
  readFolders: ["Math"],
};
const note = (path, revision, markdown = `# ${revision}`) => ({
  path,
  markdown,
  revision,
  readAt: now,
  indexGeneration: 1,
  metadata: { valid: true, revision, headings: [], blocks: [] },
});
const resolved = (path, revision) => ({
  path,
  revision,
  fragment: "Heading",
  indexGeneration: 1,
  anchorState: "found",
  anchor: {
    kind: "heading",
    id: "Heading",
    position: {
      start: { line: 1, col: 0, offset: 0 },
      end: { line: 1, col: 9, offset: 9 },
    },
  },
});

cache.putResolved(
  "queue-a",
  scope,
  "Root.md",
  "Bayes",
  resolved("Math/Bayes.md", "r1"),
);
cache.putNote(
  "queue-a",
  scope,
  note("Math/Bayes.md", "r1", "# r1\n\n![pixel](image.png)"),
);
const initial = cache.getResolved("queue-a", scope, "Root.md", "Bayes");
assert.equal(initial.note.revision, "r1");
assert.equal(initial.staleRevision, false);

const oldGeneration = cache.captureGeneration("queue-a");
cache.activateScope("queue-a", {
  ...scope,
  readFolders: ["Math", "Physics"],
});
assert.equal(cache.isGenerationCurrent("queue-a", oldGeneration), false);
assert.equal(
  cache.getResolved("queue-a", scope, "Root.md", "Bayes"),
  undefined,
);
assert.equal(
  cache.getNote(
    "queue-a",
    { ...scope, readFolders: ["Math", "Physics"] },
    "Math/Bayes.md",
  ),
  undefined,
  "permission-scope changes clear prior snapshots instead of widening access",
);

const expandedScope = { ...scope, readFolders: ["Math", "Physics"] };
cache.putResolved(
  "queue-a",
  expandedScope,
  "Root.md",
  "Bayes",
  resolved("Math/Bayes.md", "r1"),
);
cache.putNote("queue-a", expandedScope, note("Math/Bayes.md", "r1"));
cache.putNote("queue-a", expandedScope, note("Math/Bayes.md", "r2"));
const stale = cache.getResolved("queue-a", expandedScope, "Root.md", "Bayes");
assert.equal(stale.staleRevision, true);
assert.equal(stale.resolved.revision, "r2");
assert.equal(stale.resolved.anchorState, "indexing");
assert.equal("anchor" in stale.resolved, false);
assert.equal(
  cache.getNote("queue-a", expandedScope, "Math/Bayes.md", "r1"),
  undefined,
);

const originalResource = {
  path: "Math/image.png",
  mimeType: "image/png",
  base64: "AAAA",
  byteLength: 3,
  revision: "r2",
  readAt: now,
};
cache.putResource(
  "queue-a",
  expandedScope,
  "Math/Bayes.md",
  "r2",
  "image.png",
  originalResource,
);
const bytesBeforeRejectedOverwrite = cache.bytesUsed;
cache.putResource(
  "queue-a",
  expandedScope,
  "Math/Bayes.md",
  "r2",
  "image.png",
  {
    ...originalResource,
    base64: "A".repeat(80),
    byteLength: 60,
  },
);
assert.equal(
  cache
    .getResources("queue-a", expandedScope, "Math/Bayes.md", "r2")
    .get("Math/Bayes.md\0image.png").base64,
  originalResource.base64,
  "an over-budget replacement restores the previous resource",
);
assert.equal(cache.bytesUsed, bytesBeforeRejectedOverwrite);

assert.equal(
  cache.getNote("queue-b", expandedScope, "Math/Bayes.md"),
  undefined,
  "cache reads cannot cross queue identity",
);
cache.putNote("queue-b", expandedScope, note("Math/Bayes.md", "r2"));
assert.equal(
  cache.getNote("queue-b", expandedScope, "Math/Bayes.md").revision,
  "r2",
);
assert.equal(
  cache.getNote("queue-a", expandedScope, "Math/Bayes.md").revision,
  "r2",
);
assert.equal(
  cache.getNote(
    "queue-b",
    { ...expandedScope, vaultId: "vault-b" },
    "Math/Bayes.md",
  ),
  undefined,
  "cache reads cannot cross queue or Vault identity",
);

const lru = new NoteQueryMemoryCache(() => now, { ...limits, maxRecords: 2 });
lru.putNote("p", scope, note("A.md", "a"));
lru.putNote("p", scope, note("B.md", "b"));
lru.getNote("p", scope, "A.md");
lru.putNote("p", scope, note("C.md", "c"));
assert.equal(lru.getNote("p", scope, "A.md").revision, "a");
assert.equal(lru.getNote("p", scope, "B.md"), undefined);
assert.equal(lru.recordCount, 2);

const partitions = new NoteQueryMemoryCache(() => now, limits);
partitions.activateScope("p1", scope);
partitions.putNote("p1", scope, note("A.md", "a"));
partitions.activateScope("p2", scope);
partitions.putNote("p2", scope, note("B.md", "b"));
partitions.activateScope("p3", scope);
assert.equal(partitions.activeScope("p1"), undefined);
assert.equal(partitions.getNote("p1", scope, "A.md"), undefined);
assert.ok(partitions.recordCount <= limits.maxRecords);

now += limits.ttlMs + 1;
assert.equal(lru.getNote("p", scope, "A.md"), undefined);
assert.equal(lru.getNote("p", scope, "C.md"), undefined);
assert.equal(lru.bytesUsed, 0);

const globalGeneration = cache.captureGeneration("queue-b");
cache.clearAll();
assert.equal(cache.isGenerationCurrent("queue-b", globalGeneration), false);
assert.equal(cache.bytesUsed, 0);
assert.equal(cache.recordCount, 0);
console.log(
  "C6 note-query cache bounds, scope isolation, revision invalidation, TTL and generation fences passed.",
);
