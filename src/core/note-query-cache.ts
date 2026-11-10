import {
  NOTE_QUERY_LIMITS,
  type NoteQueryResultMap,
} from "./note-query-protocol.ts";

export interface NoteQueryCacheScope {
  vaultId: string;
  pairingEpoch: string;
  readFolders: string[];
}

type SavedNote = NoteQueryResultMap["read-note"];
type ResolvedNote = NoteQueryResultMap["resolve-link"];
type Resource = NoteQueryResultMap["read-note-resource"];

interface NoteRecord {
  kind: "note";
  partition: string;
  scopeKey: string;
  path: string;
  revision: string;
  note?: SavedNote;
  resources: Map<string, Resource>;
  bytes: number;
  expiresAt: number;
}

interface ResolutionRecord {
  kind: "resolution";
  partition: string;
  scopeKey: string;
  sourcePath: string;
  linkpath: string;
  resolved: ResolvedNote;
  bytes: number;
  expiresAt: number;
}

type CacheRecord = NoteRecord | ResolutionRecord;

export interface CachedNoteResolution {
  resolved: ResolvedNote;
  note: SavedNote;
  staleRevision: boolean;
}

export const NOTE_QUERY_CACHE_LIMITS = {
  maxBytes: 32 * 1024 * 1024,
  maxRecords: 512,
  maxPartitions: 128,
  maxResourcesPerNote: 10 * 1024 * 1024,
  ttlMs: 30 * 60 * 1000,
} as const;

export interface NoteQueryCacheLimits {
  maxBytes: number;
  maxRecords: number;
  maxPartitions: number;
  maxResourcesPerNote: number;
  ttlMs: number;
}

export interface NoteQueryCacheGeneration {
  global: object;
  partition: object;
}

/** Process-local, bounded cache. It never persists note content to disk. */
export class NoteQueryMemoryCache {
  private records = new Map<string, CacheRecord>();
  private activeScopes = new Map<string, NoteQueryCacheScope>();
  private globalGeneration: object = {};
  private partitionGenerations = new Map<string, object>();
  private usedBytes = 0;
  private readonly now: () => number;
  private readonly limits: NoteQueryCacheLimits;

  constructor(
    now: () => number = () => Date.now(),
    limits: NoteQueryCacheLimits = NOTE_QUERY_CACHE_LIMITS,
  ) {
    this.now = now;
    this.limits = limits;
  }

  get bytesUsed(): number {
    return this.usedBytes;
  }

  get recordCount(): number {
    return this.records.size;
  }

  activateScope(partition: string, scope: NoteQueryCacheScope): void {
    const next = scopeKey(scope);
    const previous = this.activeScopes.get(partition);
    if (previous && scopeKey(previous) !== next) {
      this.rotatePartitionGeneration(partition);
      this.removePartition(partition);
      notifyInvalidation(partition);
    }
    this.activeScopes.delete(partition);
    this.activeScopes.set(partition, {
      ...scope,
      readFolders: [...scope.readFolders].sort(),
    });
    while (this.activeScopes.size > this.limits.maxPartitions) {
      const oldest = this.activeScopes.keys().next().value as
        | string
        | undefined;
      if (!oldest) break;
      this.activeScopes.delete(oldest);
      this.removePartition(oldest);
      this.rotatePartitionGeneration(oldest);
      notifyInvalidation(oldest);
    }
  }

  activeScope(partition: string): NoteQueryCacheScope | undefined {
    const scope = this.activeScopes.get(partition);
    if (!scope) return undefined;
    this.activeScopes.delete(partition);
    this.activeScopes.set(partition, scope);
    return { ...scope, readFolders: [...scope.readFolders] };
  }

  captureGeneration(partition: string): NoteQueryCacheGeneration {
    let generation = this.partitionGenerations.get(partition);
    if (!generation) {
      generation = {};
      this.partitionGenerations.set(partition, generation);
      this.enforcePartitionLimit();
    }
    this.partitionGenerations.delete(partition);
    this.partitionGenerations.set(partition, generation);
    return { global: this.globalGeneration, partition: generation };
  }

  isGenerationCurrent(
    partition: string,
    generation: NoteQueryCacheGeneration,
  ): boolean {
    return (
      generation.global === this.globalGeneration &&
      generation.partition === this.partitionGenerations.get(partition)
    );
  }

  putResolved(
    partition: string,
    scope: NoteQueryCacheScope,
    sourcePath: string,
    linkpath: string,
    resolved: ResolvedNote,
  ): void {
    this.activateScope(partition, scope);
    const key = resolutionKey(partition, scope, sourcePath, linkpath);
    const value: ResolutionRecord = {
      kind: "resolution",
      partition,
      scopeKey: scopeKey(scope),
      sourcePath,
      linkpath,
      resolved,
      bytes:
        estimate(resolved) + (sourcePath.length + linkpath.length) * 2 + 256,
      expiresAt: this.now() + this.limits.ttlMs,
    };
    this.set(key, value);
  }

  getResolved(
    partition: string,
    scope: NoteQueryCacheScope,
    sourcePath: string,
    linkpath: string,
  ): CachedNoteResolution | undefined {
    const record = this.get<ResolutionRecord>(
      resolutionKey(partition, scope, sourcePath, linkpath),
      "resolution",
    );
    if (!record) return undefined;
    const exact = this.getNoteRecord(
      partition,
      scope,
      record.resolved.path,
      record.resolved.revision,
    );
    const noteRecord =
      exact ?? this.getLatestNoteRecord(partition, scope, record.resolved.path);
    if (!noteRecord?.note) return undefined;
    const staleRevision = noteRecord.revision !== record.resolved.revision;
    const cachedResolution: ResolvedNote = staleRevision
      ? (({ anchor: _anchor, ...withoutAnchor }) => ({
          ...withoutAnchor,
          revision: noteRecord.revision,
          anchorState: "indexing" as const,
        }))(record.resolved)
      : { ...record.resolved, revision: noteRecord.revision };
    return {
      resolved: cachedResolution,
      note: noteRecord.note,
      staleRevision,
    };
  }

  forgetResolved(
    partition: string,
    scope: NoteQueryCacheScope,
    sourcePath: string,
    linkpath: string,
  ): void {
    this.delete(resolutionKey(partition, scope, sourcePath, linkpath));
  }

  putNote(
    partition: string,
    scope: NoteQueryCacheScope,
    note: SavedNote,
  ): void {
    this.activateScope(partition, scope);
    const key = noteKey(partition, scope, note.path, note.revision);
    const previous = this.records.get(key);
    const resources =
      previous?.kind === "note" ? previous.resources : new Map();
    for (const [oldKey, oldRecord] of this.records) {
      if (
        oldKey !== key &&
        oldRecord.kind === "note" &&
        oldRecord.partition === partition &&
        oldRecord.scopeKey === scopeKey(scope) &&
        oldRecord.path === note.path
      )
        this.delete(oldKey);
    }
    const value: NoteRecord = {
      kind: "note",
      partition,
      scopeKey: scopeKey(scope),
      path: note.path,
      revision: note.revision,
      note,
      resources,
      bytes: estimate(note) + estimateResources(resources) + 256,
      expiresAt: this.now() + this.limits.ttlMs,
    };
    this.set(key, value);
  }

  getNote(
    partition: string,
    scope: NoteQueryCacheScope,
    path: string,
    revision?: string,
  ): SavedNote | undefined {
    const record = revision
      ? this.getNoteRecord(partition, scope, path, revision)
      : this.getLatestNoteRecord(partition, scope, path);
    return record?.note;
  }

  putResource(
    partition: string,
    scope: NoteQueryCacheScope,
    path: string,
    revision: string,
    linkpath: string,
    resource: Resource,
  ): void {
    const key = noteKey(partition, scope, path, revision);
    const record = this.get<NoteRecord>(key, "note");
    if (!record || resource.byteLength > NOTE_QUERY_LIMITS.maxResourceBytes)
      return;
    const previous = record.resources.get(linkpath);
    record.resources.set(linkpath, resource);
    const bytes =
      estimate(record.note) + estimateResources(record.resources) + 256;
    if (estimateResources(record.resources) > this.limits.maxResourcesPerNote) {
      if (previous) record.resources.set(linkpath, previous);
      else record.resources.delete(linkpath);
      return;
    }
    record.expiresAt = this.now() + this.limits.ttlMs;
    this.usedBytes += bytes - record.bytes;
    record.bytes = bytes;
    this.touch(key, record);
    this.enforceLimits();
  }

  getResources(
    partition: string,
    scope: NoteQueryCacheScope,
    path: string,
    revision: string,
  ): Map<string, Resource> {
    const record = this.getNoteRecord(partition, scope, path, revision);
    const result = new Map<string, Resource>();
    for (const [linkpath, resource] of record?.resources ?? [])
      result.set(`${path}\0${linkpath}`, resource);
    return result;
  }

  invalidatePath(
    partition: string,
    scope: NoteQueryCacheScope,
    path: string,
  ): void {
    const wantedScope = scopeKey(scope);
    for (const [key, record] of this.records) {
      if (
        record.partition !== partition ||
        record.scopeKey !== wantedScope ||
        (record.kind === "note"
          ? record.path !== path
          : record.resolved.path !== path && record.sourcePath !== path)
      )
        continue;
      this.delete(key);
    }
  }

  clearPartition(partition: string): void {
    this.rotatePartitionGeneration(partition);
    this.removePartition(partition);
    this.activeScopes.delete(partition);
    notifyInvalidation(partition);
  }

  clearAll(): void {
    this.globalGeneration = {};
    this.records.clear();
    this.activeScopes.clear();
    this.partitionGenerations.clear();
    this.usedBytes = 0;
    notifyInvalidation("*");
  }

  private getNoteRecord(
    partition: string,
    scope: NoteQueryCacheScope,
    path: string,
    revision: string,
  ): NoteRecord | undefined {
    return this.get<NoteRecord>(
      noteKey(partition, scope, path, revision),
      "note",
    );
  }

  private getLatestNoteRecord(
    partition: string,
    scope: NoteQueryCacheScope,
    path: string,
  ): NoteRecord | undefined {
    const wantedScope = scopeKey(scope);
    let found: [string, NoteRecord] | undefined;
    for (const [key, value] of this.records) {
      if (value.expiresAt <= this.now()) {
        this.delete(key);
        continue;
      }
      if (
        value.kind === "note" &&
        value.partition === partition &&
        value.scopeKey === wantedScope &&
        value.path === path &&
        (!found || value.expiresAt > found[1].expiresAt)
      )
        found = [key, value];
    }
    if (!found) return undefined;
    this.touch(found[0], found[1]);
    return found[1];
  }

  private get<T extends CacheRecord>(
    key: string,
    kind: T["kind"],
  ): T | undefined {
    const record = this.records.get(key);
    if (!record) return undefined;
    if (record.expiresAt <= this.now()) {
      this.delete(key);
      return undefined;
    }
    if (record.kind !== kind) return undefined;
    this.touch(key, record);
    return record as T;
  }

  private set(key: string, record: CacheRecord): void {
    this.delete(key);
    if (record.bytes > this.limits.maxBytes) return;
    this.records.set(key, record);
    this.usedBytes += record.bytes;
    this.enforceLimits();
  }

  private touch(key: string, record: CacheRecord): void {
    this.records.delete(key);
    this.records.set(key, record);
  }

  private delete(key: string): void {
    const record = this.records.get(key);
    if (!record) return;
    this.usedBytes -= record.bytes;
    this.records.delete(key);
  }

  private removePartition(partition: string): void {
    for (const key of this.records.keys())
      if (key.startsWith(`${partition}\0`)) this.delete(key);
  }

  private rotatePartitionGeneration(partition: string): void {
    this.partitionGenerations.delete(partition);
    this.partitionGenerations.set(partition, {});
    this.enforcePartitionLimit();
  }

  private enforcePartitionLimit(): void {
    while (this.partitionGenerations.size > this.limits.maxPartitions) {
      const oldest = this.partitionGenerations.keys().next().value as
        | string
        | undefined;
      if (!oldest) break;
      this.partitionGenerations.delete(oldest);
    }
  }

  private enforceLimits(): void {
    while (
      this.usedBytes > this.limits.maxBytes ||
      this.records.size > this.limits.maxRecords
    ) {
      const oldest = this.records.keys().next().value as string | undefined;
      if (!oldest) break;
      this.delete(oldest);
    }
  }
}

export const knowledgeNoteMemoryCache = new NoteQueryMemoryCache();

type CacheInvalidationListener = (partition: string) => void;
const invalidationListeners = new Set<CacheInvalidationListener>();

export function subscribeKnowledgeNoteCacheInvalidation(
  listener: CacheInvalidationListener,
): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

export function clearKnowledgeNoteMemoryCache(partition?: string): void {
  if (partition) knowledgeNoteMemoryCache.clearPartition(partition);
  else knowledgeNoteMemoryCache.clearAll();
}

function notifyInvalidation(partition: string): void {
  for (const listener of invalidationListeners) {
    try {
      listener(partition);
    } catch {
      // Cache safety must not depend on UI teardown handlers succeeding.
    }
  }
}

export function cacheScopeKey(scope: NoteQueryCacheScope): string {
  return scopeKey(scope);
}

function scopeKey(scope: NoteQueryCacheScope): string {
  return JSON.stringify([
    scope.vaultId,
    scope.pairingEpoch,
    [...scope.readFolders].sort(),
  ]);
}

function noteKey(
  partition: string,
  scope: NoteQueryCacheScope,
  path: string,
  revision: string,
): string {
  return `${partition}\0${scopeKey(scope)}\0note\0${path}\0${revision}`;
}

function resolutionKey(
  partition: string,
  scope: NoteQueryCacheScope,
  sourcePath: string,
  linkpath: string,
): string {
  return `${partition}\0${scopeKey(scope)}\0resolution\0${sourcePath}\0${linkpath}`;
}

function estimate(value: unknown): number {
  return JSON.stringify(value).length * 2;
}

function estimateResources(resources: Map<string, Resource>): number {
  let bytes = 0;
  for (const [path, resource] of resources)
    bytes +=
      path.length * 2 + resource.base64.length * 2 + resource.byteLength + 256;
  return bytes;
}
