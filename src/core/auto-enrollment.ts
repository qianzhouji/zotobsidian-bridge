import type { CancellationSignal } from "./cancellation.ts";

export interface AutoEnrollmentScope {
  libraryID: number;
  wholeLibrary: boolean;
  collectionKeys: string[];
  tagNames: string[];
  includeSubcollections: boolean;
}

export interface AutoEnrollmentConfig {
  schema: 1;
  enabled: boolean;
  paused: boolean;
  scopes: AutoEnrollmentScope[];
}

export interface AutoEnrollmentFacts {
  libraryID: number;
  collectionKeys: string[];
  tagNames: string[];
}

export interface AnnotationRef {
  libraryID: number;
  key: string;
}

export interface FailedAnnotationRef extends AnnotationRef {
  error: string;
  failedAt: string;
}

export interface HistoricalBatch {
  id: string;
  refs: AnnotationRef[];
  cursor: number;
  status: "ready" | "running" | "paused" | "completed";
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface AutoEnrollmentState {
  schema: 1;
  pending: AnnotationRef[];
  current: AnnotationRef | null;
  failed: FailedAnnotationRef[];
  batch: HistoricalBatch | null;
}

export type HistoricalBatchResult = "paused" | "completed";

export const DEFAULT_AUTO_ENROLLMENT_CONFIG: AutoEnrollmentConfig = {
  schema: 1,
  enabled: false,
  paused: false,
  scopes: [],
};

export const EMPTY_AUTO_ENROLLMENT_STATE: AutoEnrollmentState = {
  schema: 1,
  pending: [],
  current: null,
  failed: [],
  batch: null,
};

export function validateAutoEnrollmentConfig(
  value: unknown,
): AutoEnrollmentConfig {
  if (
    !value ||
    typeof value !== "object" ||
    (value as AutoEnrollmentConfig).schema !== 1 ||
    typeof (value as AutoEnrollmentConfig).enabled !== "boolean" ||
    typeof (value as AutoEnrollmentConfig).paused !== "boolean" ||
    !Array.isArray((value as AutoEnrollmentConfig).scopes)
  ) {
    throw new Error("Automatic enrollment settings are malformed.");
  }
  const config = value as AutoEnrollmentConfig;
  for (const scope of config.scopes) {
    if (
      !scope ||
      !Number.isSafeInteger(scope.libraryID) ||
      scope.libraryID <= 0 ||
      typeof scope.wholeLibrary !== "boolean" ||
      !Array.isArray(scope.collectionKeys) ||
      !scope.collectionKeys.every(
        (key) => typeof key === "string" && key.length > 0,
      ) ||
      !Array.isArray(scope.tagNames) ||
      !scope.tagNames.every(
        (tag) => typeof tag === "string" && tag.length > 0,
      ) ||
      typeof scope.includeSubcollections !== "boolean"
    ) {
      throw new Error("Automatic enrollment contains an invalid scope.");
    }
    if (
      !scope.wholeLibrary &&
      scope.collectionKeys.length === 0 &&
      scope.tagNames.length === 0
    ) {
      throw new Error("An automatic enrollment scope has no selection.");
    }
    if (
      scope.wholeLibrary &&
      (scope.collectionKeys.length || scope.tagNames.length)
    ) {
      throw new Error(
        "Whole-library scopes cannot also contain collection or tag rules.",
      );
    }
  }
  return config;
}

export function validateAutoEnrollmentState(
  value: unknown,
): AutoEnrollmentState {
  if (
    !value ||
    typeof value !== "object" ||
    (value as AutoEnrollmentState).schema !== 1 ||
    !Array.isArray((value as AutoEnrollmentState).pending) ||
    !Array.isArray((value as AutoEnrollmentState).failed) ||
    !("current" in value) ||
    !("batch" in value)
  ) {
    throw new Error("Automatic enrollment task state is malformed.");
  }
  const state = value as AutoEnrollmentState;
  const validRef = (ref: AnnotationRef) =>
    !!ref &&
    Number.isSafeInteger(ref.libraryID) &&
    ref.libraryID > 0 &&
    typeof ref.key === "string" &&
    ref.key.length > 0 &&
    !ref.key.includes("/");
  if (
    !state.pending.every(validRef) ||
    (state.current !== null && !validRef(state.current)) ||
    !state.failed.every(
      (ref) =>
        validRef(ref) &&
        typeof ref.error === "string" &&
        typeof ref.failedAt === "string",
    )
  ) {
    throw new Error("Automatic enrollment task state contains invalid items.");
  }
  if (state.batch !== null) {
    const batch = state.batch;
    if (
      typeof batch.id !== "string" ||
      !Array.isArray(batch.refs) ||
      !batch.refs.every(validRef) ||
      !Number.isSafeInteger(batch.cursor) ||
      batch.cursor < 0 ||
      batch.cursor > batch.refs.length ||
      !["ready", "running", "paused", "completed"].includes(batch.status) ||
      typeof batch.createdAt !== "string" ||
      typeof batch.updatedAt !== "string" ||
      (batch.lastError !== undefined && typeof batch.lastError !== "string")
    ) {
      throw new Error("Historical import batch state is invalid.");
    }
  }
  return state;
}

export function annotationRefKey(ref: AnnotationRef): string {
  return `${ref.libraryID}/${ref.key}`;
}

export function matchesAutoEnrollmentScope(
  scope: AutoEnrollmentScope,
  facts: AutoEnrollmentFacts,
): boolean {
  if (scope.libraryID !== facts.libraryID) return false;
  if (scope.wholeLibrary) return true;

  const collectionSelected =
    scope.collectionKeys.length > 0 &&
    facts.collectionKeys.some((key) => scope.collectionKeys.includes(key));
  const tagSelected =
    scope.tagNames.length > 0 &&
    facts.tagNames.some((tag) => scope.tagNames.includes(tag));
  if (scope.collectionKeys.length > 0 && scope.tagNames.length > 0) {
    return collectionSelected && tagSelected;
  }
  return collectionSelected || tagSelected;
}

export function matchesAnyAutoEnrollmentScope(
  scopes: AutoEnrollmentScope[],
  facts: AutoEnrollmentFacts,
): boolean {
  return scopes.some((scope) => matchesAutoEnrollmentScope(scope, facts));
}

export function uniqueAnnotationRefs(refs: AnnotationRef[]): AnnotationRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = annotationRefKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function runHistoricalBatch(
  batch: HistoricalBatch,
  processRef: (ref: AnnotationRef) => Promise<void>,
  persist: (batch: HistoricalBatch) => Promise<void>,
  signal: CancellationSignal,
): Promise<HistoricalBatchResult> {
  batch.status = "running";
  batch.updatedAt = new Date().toISOString();
  batch.lastError = undefined;
  await persist(batch);

  while (batch.cursor < batch.refs.length) {
    if (signal.aborted) {
      batch.status = "paused";
      batch.updatedAt = new Date().toISOString();
      await persist(batch);
      return "paused";
    }

    const ref = batch.refs[batch.cursor];
    try {
      await processRef(ref);
    } catch (error) {
      batch.status = "paused";
      batch.lastError = `${annotationRefKey(ref)}: ${String(error)}`;
      batch.updatedAt = new Date().toISOString();
      await persist(batch);
      return "paused";
    }

    batch.cursor++;
    batch.updatedAt = new Date().toISOString();
    await persist(batch);
  }

  batch.status = "completed";
  batch.updatedAt = new Date().toISOString();
  batch.lastError = undefined;
  await persist(batch);
  return "completed";
}
