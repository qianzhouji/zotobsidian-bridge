import assert from "node:assert/strict";
import { createCancellationController } from "../src/core/cancellation.ts";
import {
  annotationRefKey,
  DEFAULT_AUTO_ENROLLMENT_CONFIG,
  matchesAutoEnrollmentScope,
  matchesAnyAutoEnrollmentScope,
  runHistoricalBatch,
  uniqueAnnotationRefs,
  validateAutoEnrollmentConfig,
  validateAutoEnrollmentState,
} from "../src/core/auto-enrollment.ts";

assert.equal(DEFAULT_AUTO_ENROLLMENT_CONFIG.enabled, false);
assert.deepEqual(DEFAULT_AUTO_ENROLLMENT_CONFIG.scopes, []);

const collectionOnly = {
  libraryID: 1,
  wholeLibrary: false,
  collectionKeys: ["A", "B"],
  tagNames: [],
  includeSubcollections: false,
};
const tagOnly = {
  libraryID: 1,
  wholeLibrary: false,
  collectionKeys: [],
  tagNames: ["review", "important"],
  includeSubcollections: false,
};
const intersection = {
  libraryID: 1,
  wholeLibrary: false,
  collectionKeys: ["A", "B"],
  tagNames: ["review", "important"],
  includeSubcollections: true,
};

assert.equal(
  matchesAutoEnrollmentScope(collectionOnly, {
    libraryID: 1,
    collectionKeys: ["B"],
    tagNames: [],
  }),
  true,
  "multiple selected collections form a union",
);
assert.equal(
  matchesAutoEnrollmentScope(tagOnly, {
    libraryID: 1,
    collectionKeys: [],
    tagNames: ["important"],
  }),
  true,
  "multiple selected tags form a union",
);
assert.equal(
  matchesAutoEnrollmentScope(intersection, {
    libraryID: 1,
    collectionKeys: ["A"],
    tagNames: ["review"],
  }),
  true,
  "collection and tag dimensions intersect",
);
assert.equal(
  matchesAutoEnrollmentScope(intersection, {
    libraryID: 1,
    collectionKeys: ["A"],
    tagNames: ["other"],
  }),
  false,
  "a collection match alone does not satisfy a combined rule",
);
assert.equal(
  matchesAutoEnrollmentScope(collectionOnly, {
    libraryID: 2,
    collectionKeys: ["A"],
    tagNames: [],
  }),
  false,
  "other libraries never match",
);
assert.equal(
  matchesAnyAutoEnrollmentScope([collectionOnly, tagOnly], {
    libraryID: 1,
    collectionKeys: ["A"],
    tagNames: ["review"],
  }),
  true,
  "separate rules form a union",
);

assert.throws(
  () =>
    validateAutoEnrollmentConfig({
      schema: 1,
      enabled: true,
      paused: false,
      scopes: [{ ...collectionOnly, wholeLibrary: true }],
    }),
  /cannot also contain/,
);

const refs = Array.from({ length: 100 }, (_, index) => ({
  libraryID: 1,
  key: `ANN${index}`,
}));
assert.equal(
  uniqueAnnotationRefs([refs[0], refs[0], refs[1]]).length,
  2,
  "overlapping selectors enqueue an annotation once",
);
assert.equal(annotationRefKey(refs[41]), "1/ANN41");

const nativeAbortController = globalThis.AbortController;
try {
  globalThis.AbortController = undefined;
  const compatibilityController = createCancellationController();
  assert.equal(compatibilityController.signal.aborted, false);
  compatibilityController.abort();
  assert.equal(compatibilityController.signal.aborted, true);
} finally {
  globalThis.AbortController = nativeAbortController;
}

const processed = new Map();
const batch = {
  id: "batch-test",
  refs,
  cursor: 0,
  status: "running",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
let persistedBatch;
const persist = async (value) => {
  persistedBatch = JSON.parse(JSON.stringify(value));
};
const cancel = createCancellationController();
assert.equal(
  await runHistoricalBatch(
    batch,
    async (ref) => {
      processed.set(ref.key, (processed.get(ref.key) ?? 0) + 1);
      if (processed.size === 37) cancel.abort();
    },
    persist,
    cancel.signal,
  ),
  "paused",
);
assert.equal(persistedBatch.cursor, 37);
assert.equal(persistedBatch.status, "paused");
const restored = validateAutoEnrollmentState(
  JSON.parse(
    JSON.stringify({
      schema: 1,
      pending: [],
      current: null,
      failed: [],
      batch: persistedBatch,
    }),
  ),
).batch;
assert.equal(restored.cursor, 37);
assert.equal(
  await runHistoricalBatch(
    restored,
    async (ref) => {
      processed.set(ref.key, (processed.get(ref.key) ?? 0) + 1);
    },
    persist,
    createCancellationController().signal,
  ),
  "completed",
);
assert.equal(
  validateAutoEnrollmentState({
    schema: 1,
    pending: [],
    current: null,
    failed: [],
    batch: persistedBatch,
  }).batch.cursor,
  100,
);
assert.equal(processed.size, 100);
assert.ok([...processed.values()].every((count) => count === 1));

const retryBatch = {
  id: "batch-retry-test",
  refs: refs.slice(0, 10),
  cursor: 0,
  status: "ready",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
let failOnce = true;
const retryWrites = new Map();
assert.equal(
  await runHistoricalBatch(
    retryBatch,
    async (ref) => {
      if (ref.key === "ANN5" && failOnce) {
        failOnce = false;
        throw new Error("simulated temporary failure");
      }
      retryWrites.set(ref.key, (retryWrites.get(ref.key) ?? 0) + 1);
    },
    persist,
    createCancellationController().signal,
  ),
  "paused",
);
assert.equal(persistedBatch.cursor, 5);
assert.match(persistedBatch.lastError, /1\/ANN5/);
assert.equal(
  await runHistoricalBatch(
    persistedBatch,
    async (ref) => {
      retryWrites.set(ref.key, (retryWrites.get(ref.key) ?? 0) + 1);
    },
    persist,
    createCancellationController().signal,
  ),
  "completed",
);
assert.equal(retryWrites.size, 10);
assert.ok([...retryWrites.values()].every((count) => count === 1));
