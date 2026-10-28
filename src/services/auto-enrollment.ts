import {
  annotationRefKey,
  DEFAULT_AUTO_ENROLLMENT_CONFIG,
  EMPTY_AUTO_ENROLLMENT_STATE,
  matchesAutoEnrollmentScope,
  runHistoricalBatch,
  uniqueAnnotationRefs,
  validateAutoEnrollmentConfig,
  validateAutoEnrollmentState,
  type AnnotationRef,
  type AutoEnrollmentConfig,
  type AutoEnrollmentFacts,
  type AutoEnrollmentScope,
  type AutoEnrollmentState,
  type HistoricalBatch,
} from "../core/auto-enrollment.ts";
import {
  createCancellationController,
  type CancellationController,
} from "../core/cancellation.ts";
import {
  getLibraryIdentity,
  getIndexPath,
  ensureAnnotationCardItem,
} from "./annotation-card.ts";
import { readCardIndex } from "../adapters/vault-storage.ts";
import { annotationSourceID } from "../core/models.ts";
import { CompanionPendingError } from "../adapters/companion-queue.ts";
import { showPendingCompanionRequest } from "./companion-pending-window.ts";

const preferenceKey = "extensions.zotero.zoteroobsidianbridge.autoEnrollment";
const stateFileName = "auto-enrollment-state.json";
let stateQueue: Promise<void> = Promise.resolve();
let autoWorker: Promise<void> | null = null;
let historicalController: CancellationController | null = null;

export interface AutoEnrollmentPreview {
  annotations: number;
  alreadyLinked: number;
  estimatedNew: number;
}

function statePath(): string {
  const root = Zotero.DataDirectory.dir;
  if (!root || !PathUtils.isAbsolute(root)) {
    throw new Error("Zotero's data directory is unavailable.");
  }
  return PathUtils.join(
    root,
    "storage",
    "zotero-obsidian-bridge",
    stateFileName,
  );
}

async function readState(): Promise<AutoEnrollmentState> {
  const path = statePath();
  if (!(await IOUtils.exists(path))) {
    return {
      schema: EMPTY_AUTO_ENROLLMENT_STATE.schema,
      pending: [],
      current: null,
      failed: [],
      batch: null,
    };
  }
  return validateAutoEnrollmentState(await IOUtils.readJSON(path));
}

async function writeState(state: AutoEnrollmentState): Promise<void> {
  const path = statePath();
  const directory = PathUtils.parent(path);
  if (!directory) throw new Error("Could not resolve enrollment state path.");
  await IOUtils.makeDirectory(directory, {
    createAncestors: true,
    ignoreExisting: true,
  });
  await IOUtils.writeJSON(path, validateAutoEnrollmentState(state), {
    mode: "overwrite",
    tmpPath: `${path}.${crypto.randomUUID()}.tmp`,
    backupFile: `${path}.${crypto.randomUUID()}.bak`,
    flush: true,
  });
}

async function mutateState<T>(
  mutate: (state: AutoEnrollmentState) => T,
): Promise<T> {
  const operation = stateQueue.then(async () => {
    const state = await readState();
    const result = mutate(state);
    await writeState(state);
    return result;
  });
  stateQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export function getAutoEnrollmentConfig(): AutoEnrollmentConfig {
  const raw = Zotero.Prefs.get(preferenceKey, true);
  if (typeof raw !== "string" || !raw.trim()) {
    return {
      schema: DEFAULT_AUTO_ENROLLMENT_CONFIG.schema,
      enabled: false,
      paused: false,
      scopes: [],
    };
  }
  return validateAutoEnrollmentConfig(JSON.parse(raw));
}

export async function saveAutoEnrollmentConfig(
  config: AutoEnrollmentConfig,
): Promise<void> {
  const validated = validateAutoEnrollmentConfig(config);
  Zotero.Prefs.set(preferenceKey, JSON.stringify(validated), true);
  if (validated.enabled && !validated.paused) void drainAutoQueue();
}

function annotationReference(item: Zotero.Item): AnnotationRef {
  return { libraryID: item.libraryID, key: item.key };
}

function getItemByRef(ref: AnnotationRef): Promise<Zotero.Item | false> {
  return Zotero.Items.getByLibraryAndKeyAsync(ref.libraryID, ref.key);
}

function collectionMembershipKeys(
  item: Zotero.Item,
  scope: AutoEnrollmentScope,
  collectionByID: Map<number, Zotero.Collection>,
): string[] {
  const keys: string[] = [];
  for (const id of item.getCollections()) {
    const collection = collectionByID.get(id);
    if (!collection) continue;
    keys.push(collection.key);
    if (!scope.includeSubcollections) continue;
    let parentID = collection.parentID;
    const seen = new Set<number>();
    while (parentID && !seen.has(parentID)) {
      seen.add(parentID);
      const parent = collectionByID.get(parentID);
      if (!parent) break;
      keys.push(parent.key);
      parentID = parent.parentID;
    }
  }
  return [...new Set(keys)];
}

function scopeMatchesItem(
  item: Zotero.Item,
  scopes: AutoEnrollmentScope[],
  collectionByID: Map<number, Zotero.Collection>,
): boolean {
  const libraryScopes = scopes.filter(
    (scope) => scope.libraryID === item.libraryID,
  );
  if (!libraryScopes.length) return false;
  let tags: string[] | null = null;
  return libraryScopes.some((scope) => {
    if (scope.wholeLibrary) return true;
    tags ??= item
      .getTags()
      .map(({ tag }) => tag)
      .filter(Boolean);
    const facts: AutoEnrollmentFacts = {
      libraryID: item.libraryID,
      collectionKeys: collectionMembershipKeys(item, scope, collectionByID),
      tagNames: tags,
    };
    return matchesAutoEnrollmentScope(scope, facts);
  });
}

async function annotationScopeMatches(
  annotation: Zotero.Item,
  config: AutoEnrollmentConfig,
): Promise<boolean> {
  if (!annotation.isAnnotation() || annotation.deleted) return false;
  const attachment = annotation.parentItem;
  if (!attachment || !attachment.isAttachment()) return false;
  const topLevel = attachment.parentItemID
    ? await Zotero.Items.getAsync(attachment.parentItemID)
    : attachment;
  if (!topLevel) return false;
  if (
    config.scopes.some(
      (scope) => scope.libraryID === topLevel.libraryID && scope.wholeLibrary,
    )
  ) {
    return true;
  }
  const collectionByID = new Map(
    Zotero.Collections.getByLibrary(topLevel.libraryID, true).map(
      (collection) => [collection.id, collection],
    ),
  );
  return scopeMatchesItem(topLevel, config.scopes, collectionByID);
}

async function queueRefs(refs: AnnotationRef[]): Promise<void> {
  const unique = uniqueAnnotationRefs(refs);
  if (!unique.length) return;
  await mutateState((state) => {
    const queued = new Set([
      ...state.pending.map(annotationRefKey),
      ...(state.current ? [annotationRefKey(state.current)] : []),
    ]);
    for (const ref of unique) {
      const key = annotationRefKey(ref);
      if (!queued.has(key)) {
        state.pending.push(ref);
        queued.add(key);
      }
    }
  });
  void drainAutoQueue();
}

async function processRef(ref: AnnotationRef): Promise<void> {
  const annotation = await getItemByRef(ref);
  if (!annotation || !annotation.isAnnotation() || annotation.deleted) {
    throw new Error("The Zotero annotation is unavailable or was deleted.");
  }
  if (!Zotero.Libraries.get(ref.libraryID)) {
    throw new Error("The source Zotero library is no longer available.");
  }
  await ensureAnnotationCardItem(annotation);
}

async function drainAutoQueue(): Promise<void> {
  if (autoWorker) return autoWorker;
  autoWorker = (async () => {
    while (true) {
      let ref: AnnotationRef | null = null;
      const config = getAutoEnrollmentConfig();
      if (!config.enabled || config.paused) return;
      await mutateState((state) => {
        if (state.current) {
          state.pending.unshift(state.current);
          state.current = null;
        }
        if (!state.pending.length) return;
        ref = state.pending.shift()!;
        state.current = ref;
      });
      if (!ref) return;
      try {
        await processRef(ref);
        await mutateState((state) => {
          state.current = null;
          state.failed = state.failed.filter(
            (failed) => annotationRefKey(failed) !== annotationRefKey(ref!),
          );
        });
      } catch (error) {
        if (error instanceof CompanionPendingError) {
          showPendingCompanionRequest(error.requestId);
        }
        await mutateState((state) => {
          state.current = null;
          state.failed = state.failed.filter(
            (failed) => annotationRefKey(failed) !== annotationRefKey(ref!),
          );
          state.failed.push({
            ...ref!,
            error: String(error),
            failedAt: new Date().toISOString(),
          });
        });
      }
    }
  })()
    .catch((error) => {
      Zotero.debug(
        `[Zotero Obsidian Bridge] Auto queue worker failed: ${String(error)}`,
      );
    })
    .finally(() => {
      autoWorker = null;
      void mutateState((state) => {
        if (!state.current) return;
        state.pending.unshift(state.current);
        state.current = null;
      })
        .then(() => getAutoEnrollmentState())
        .then((state) => {
          const config = getAutoEnrollmentConfig();
          if (state.pending.length && config.enabled && !config.paused) {
            void drainAutoQueue();
          }
        })
        .catch((error) =>
          Zotero.debug(
            `[Zotero Obsidian Bridge] Auto queue recovery failed: ${String(error)}`,
          ),
        );
    });
  return autoWorker;
}

export function handleAutoEnrollmentNotifierEvent(
  event: _ZoteroTypes.Notifier.Event,
  type: _ZoteroTypes.Notifier.Type,
  ids: string[] | number[],
): void {
  if (event !== "add" || type !== "item") return;
  let config: AutoEnrollmentConfig;
  try {
    config = getAutoEnrollmentConfig();
  } catch (error) {
    Zotero.debug(
      `[Zotero Obsidian Bridge] Invalid enrollment settings: ${String(error)}`,
    );
    return;
  }
  if (!config.enabled || config.paused || !config.scopes.length) return;
  void Promise.all(
    ids.map(async (id) => {
      try {
        const item = await Zotero.Items.getAsync(id);
        if (!item || !item.isAnnotation()) return null;
        if (!(await annotationScopeMatches(item, config))) return null;
        return annotationReference(item);
      } catch (error) {
        Zotero.debug(
          `[Zotero Obsidian Bridge] Could not inspect newly added item ${String(id)}: ${String(error)}`,
        );
        return null;
      }
    }),
  )
    .then((refs) =>
      queueRefs(refs.filter((ref): ref is AnnotationRef => !!ref)),
    )
    .catch((error) =>
      Zotero.debug(
        `[Zotero Obsidian Bridge] Auto-enrollment event failed: ${String(error)}`,
      ),
    );
}

async function scanConfiguredScopes(
  config: AutoEnrollmentConfig,
): Promise<AnnotationRef[]> {
  if (!config.scopes.length) {
    throw new Error(
      "Select at least one library, collection, or tag scope first.",
    );
  }
  const refs: AnnotationRef[] = [];
  const libraryIDs = [
    ...new Set(config.scopes.map((scope) => scope.libraryID)),
  ];
  for (const libraryID of libraryIDs) {
    const library = Zotero.Libraries.get(libraryID);
    if (!library)
      throw new Error(`Zotero library ${libraryID} is unavailable.`);
    let topLevelItems: Zotero.Item[];
    try {
      topLevelItems = await Zotero.Items.getAll(libraryID, true, false, false);
    } catch (error) {
      throw new Error(
        `Could not read ${library.name} (library ${libraryID}); no batch was created. ${String(error)}`,
      );
    }
    const scopes = config.scopes.filter(
      (scope) => scope.libraryID === libraryID,
    );
    let collectionByID: Map<number, Zotero.Collection>;
    try {
      collectionByID = new Map(
        Zotero.Collections.getByLibrary(libraryID, true).map((collection) => [
          collection.id,
          collection,
        ]),
      );
    } catch (error) {
      throw new Error(
        `Could not read collections in ${library.name} (library ${libraryID}); no batch was created. ${String(error)}`,
      );
    }
    for (let itemIndex = 0; itemIndex < topLevelItems.length; itemIndex++) {
      const item = topLevelItems[itemIndex];
      if (!scopeMatchesItem(item, scopes, collectionByID)) continue;
      const attachmentIDs = item.isAttachment()
        ? [item.id]
        : item.getAttachments();
      for (const attachmentID of attachmentIDs) {
        const attachment = await Zotero.Items.getAsync(attachmentID);
        if (!attachment) {
          throw new Error(
            `Could not access an attachment in ${library.name} (item ${attachmentID}); no historical batch was created.`,
          );
        }
        if (!attachment.isPDFAttachment()) continue;
        for (const annotation of attachment.getAnnotations(false)) {
          if (annotation.isAnnotation() && !annotation.deleted) {
            refs.push(annotationReference(annotation));
          }
        }
      }
      if ((itemIndex + 1) % 100 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }
  return uniqueAnnotationRefs(refs);
}

export async function previewAutoEnrollmentConfig(
  config: AutoEnrollmentConfig,
): Promise<AutoEnrollmentPreview> {
  const validated = validateAutoEnrollmentConfig(config);
  const refs = await scanConfiguredScopes(validated);
  const index = await readCardIndex(getIndexPath());
  let alreadyLinked = 0;
  for (const ref of refs) {
    const identity = getLibraryIdentity(ref.libraryID);
    const sourceID = annotationSourceID(identity, ref.key);
    if (index.cards[sourceID] || index.suspendedCards[sourceID])
      alreadyLinked++;
  }
  return {
    annotations: refs.length,
    alreadyLinked,
    estimatedNew: refs.length - alreadyLinked,
  };
}

export async function previewAutoEnrollmentScopes(): Promise<AutoEnrollmentPreview> {
  return previewAutoEnrollmentConfig(getAutoEnrollmentConfig());
}

export async function startHistoricalImport(): Promise<number> {
  const refs = await scanConfiguredScopes(getAutoEnrollmentConfig());
  if (!refs.length) return 0;
  const existing = await getAutoEnrollmentState();
  if (existing.batch && existing.batch.status !== "completed") {
    throw new Error("A historical import batch already needs attention.");
  }
  const now = new Date().toISOString();
  const batch: HistoricalBatch = {
    id: crypto.randomUUID(),
    refs,
    cursor: 0,
    status: "ready",
    createdAt: now,
    updatedAt: now,
  };
  await mutateState((state) => {
    state.batch = batch;
  });
  await resumeHistoricalImport();
  return refs.length;
}

export async function resumeHistoricalImport(): Promise<void> {
  if (historicalController) {
    throw new Error("A historical import batch is already running.");
  }
  const initial = await getAutoEnrollmentState();
  if (!initial.batch || initial.batch.status === "completed") {
    throw new Error("There is no resumable historical import batch.");
  }
  const controller = createCancellationController();
  historicalController = controller;
  try {
    await runHistoricalBatch(
      initial.batch,
      async (ref) => {
        try {
          await processRef(ref);
        } catch (error) {
          if (error instanceof CompanionPendingError) {
            showPendingCompanionRequest(error.requestId);
          }
          throw error;
        }
      },
      async (batch) => {
        await mutateState((state) => {
          state.batch = { ...batch, refs: [...batch.refs] };
        });
      },
      controller.signal,
    );
  } finally {
    if (historicalController === controller) historicalController = null;
  }
}

export async function cancelHistoricalImport(): Promise<boolean> {
  if (!historicalController) return false;
  historicalController.abort();
  return true;
}

export async function retryFailedAutoEnrollment(): Promise<number> {
  let count = 0;
  await mutateState((state) => {
    const queued = new Set([
      ...state.pending.map(annotationRefKey),
      ...(state.current ? [annotationRefKey(state.current)] : []),
    ]);
    for (const failed of state.failed) {
      const ref = { libraryID: failed.libraryID, key: failed.key };
      if (!queued.has(annotationRefKey(ref))) {
        state.pending.push(ref);
        queued.add(annotationRefKey(ref));
        count++;
      }
    }
    state.failed = [];
  });
  if (getAutoEnrollmentConfig().enabled && !getAutoEnrollmentConfig().paused) {
    void drainAutoQueue();
  }
  return count;
}

export async function getAutoEnrollmentState(): Promise<AutoEnrollmentState> {
  await stateQueue;
  return readState();
}

export async function initializeAutoEnrollment(): Promise<void> {
  await mutateState((state) => {
    if (state.current) {
      state.pending.unshift(state.current);
      state.current = null;
    }
    if (state.batch?.status === "running") {
      state.batch.status = "paused";
      state.batch.updatedAt = new Date().toISOString();
      state.batch.lastError = "Paused when Zotero stopped; resume to continue.";
    }
  });
  try {
    const config = getAutoEnrollmentConfig();
    if (config.enabled && !config.paused) void drainAutoQueue();
  } catch (error) {
    Zotero.debug(
      `[Zotero Obsidian Bridge] Automatic enrollment disabled due to invalid settings: ${String(error)}`,
    );
  }
}
