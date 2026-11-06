import type { EditorDraft } from "../adapters/editor-drafts.ts";
import type { UserNoteContent } from "../core/note-content.ts";

export interface EditorSessionIdentity {
  vaultPath: string;
  cardID: string;
  sourceID: string;
  relativePath: string;
}

export interface EditorSessionDiskVersion {
  content: UserNoteContent;
  source: string;
}

export interface EditorSessionConflict {
  baseline: UserNoteContent;
  disk: UserNoteContent;
  local: UserNoteContent;
}

export type EditorSessionSaveResult =
  | { status: "saved" }
  | { status: "pending"; requestId: string }
  | { status: "conflict"; current: UserNoteContent }
  | { status: "error"; message: string };

export type EditorSessionSaveOutcome =
  | { status: "pending" }
  | { status: "applied"; revision: string }
  | { status: "conflict"; message: string }
  | { status: "completed" };

export interface EditorSessionAdapter {
  readDisk(): Promise<EditorSessionDiskVersion>;
  readDraft(cardID: string): Promise<EditorDraft | null>;
  writeDraft(draft: EditorDraft): Promise<void>;
  deleteDraft(cardID: string): Promise<void>;
  save(
    baseline: UserNoteContent,
    next: UserNoteContent,
    force?: boolean,
  ): Promise<EditorSessionSaveResult>;
  getSaveOutcome?(requestId: string): Promise<EditorSessionSaveOutcome>;
}

export interface EditorSessionSnapshot {
  baseline: UserNoteContent;
  content: UserNoteContent;
  source: string;
  conflict: EditorSessionConflict | null;
  vaultUnavailable: boolean;
  composing: boolean;
  compositionOwner: number | null;
  revision: number;
  status:
    | "saved"
    | "dirty"
    | "saving"
    | "pending"
    | "conflict"
    | "error"
    | "offline";
  error: string;
  draftPersisted: boolean;
}

export interface EditorSessionView {
  id: number;
  detach(): void;
}

const draftDelayMs = 300;
const saveDelayMs = 750;
const pollIntervalMs = 1600;

function cloneContent(content: UserNoteContent): UserNoteContent {
  return { title: content.title, markdown: content.markdown };
}

type PendingEditorSave = NonNullable<EditorDraft["pendingSave"]>;

function clonePendingSave(pending: PendingEditorSave): PendingEditorSave {
  return {
    requestId: pending.requestId,
    baseline: cloneContent(pending.baseline),
    snapshot: cloneContent(pending.snapshot),
  };
}

function sameContent(left: UserNoteContent, right: UserNoteContent): boolean {
  return left.title === right.title && left.markdown === right.markdown;
}

function normalizeContent(content: UserNoteContent): UserNoteContent {
  return { ...content, title: content.title.trim() };
}

function sessionKey(identity: EditorSessionIdentity): string {
  return JSON.stringify([
    identity.vaultPath,
    identity.cardID,
    identity.sourceID,
    identity.relativePath,
  ]);
}

const sessions = new Map<string, EditorSession>();

export class EditorSession {
  readonly identity: EditorSessionIdentity;
  private baseline: UserNoteContent = { title: "", markdown: "" };
  private content: UserNoteContent = { title: "", markdown: "" };
  private source = "";
  private conflict: EditorSessionConflict | null = null;
  private vaultUnavailable = false;
  private composing = false;
  private compositionOwner: number | null = null;
  private nextViewID = 1;
  private revision = 0;
  private persistedDraftRevision = 0;
  private status: EditorSessionSnapshot["status"] = "saved";
  private error = "";
  private initialized = false;
  private initialization: Promise<EditorSessionSnapshot> | null = null;
  private disposed = false;
  private retainCount = 0;
  private readonly views = new Map<
    number,
    (snapshot: EditorSessionSnapshot) => void
  >();
  private draftTimer: ReturnType<typeof setTimeout> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private draftTail: Promise<void> = Promise.resolve();
  private saveTail: Promise<void> = Promise.resolve();
  private saveRequested = false;
  private pollInFlight = false;
  private saveBlocked = false;
  private writing = false;
  private pendingSave: PendingEditorSave | null = null;
  private readonly adapter: EditorSessionAdapter;
  private readonly key: string;

  constructor(
    identity: EditorSessionIdentity,
    adapter: EditorSessionAdapter,
    key: string,
  ) {
    this.identity = identity;
    this.adapter = adapter;
    this.key = key;
  }

  initialize(): Promise<EditorSessionSnapshot> {
    if (this.disposed) throw this.disposedError("initialize");
    if (this.initialized) return Promise.resolve(this.snapshot());
    if (this.initialization) return this.initialization;
    const pending = this.initializeOnce();
    this.initialization = pending;
    void pending.catch(() => {
      if (this.initialization === pending) {
        this.initialization = null;
        sessions.delete(this.key);
      }
    });
    return pending;
  }

  retain(): () => void {
    if (this.disposed) throw this.disposedError("retain");
    this.retainCount++;
    let retained = true;
    return () => {
      if (!retained) return;
      retained = false;
      this.retainCount--;
      this.collectIfIdle();
    };
  }

  private async initializeOnce(): Promise<EditorSessionSnapshot> {
    const [savedDraft, diskResult] = await Promise.all([
      this.adapter.readDraft(this.identity.cardID),
      this.adapter.readDisk().then(
        (disk) => ({ disk, error: "" }),
        (error: unknown) => ({ disk: null, error: String(error) }),
      ),
    ]);
    const disk = diskResult.disk;
    if (savedDraft) {
      if (
        savedDraft.sourceID !== this.identity.sourceID ||
        savedDraft.relativePath !== this.identity.relativePath
      ) {
        throw new Error(
          "A recovery draft exists for a different card location; it was preserved.",
        );
      }
    }
    if (!disk && !savedDraft) throw new Error(diskResult.error);

    this.baseline = cloneContent(disk?.content ?? savedDraft!.baseline);
    this.content = cloneContent(this.baseline);
    this.source = disk?.source ?? "";
    this.vaultUnavailable = !disk;

    if (savedDraft) {
      if (
        disk &&
        !savedDraft.pendingSave &&
        sameContent(savedDraft.draft, disk.content)
      ) {
        await this.adapter.deleteDraft(this.identity.cardID);
      } else {
        this.baseline = cloneContent(savedDraft.baseline);
        this.content = cloneContent(savedDraft.draft);
        this.revision = 1;
        this.persistedDraftRevision = 1;
        if (savedDraft.pendingSave) {
          this.pendingSave = clonePendingSave(savedDraft.pendingSave);
          this.status = "pending";
        } else if (disk && !sameContent(disk.content, savedDraft.baseline)) {
          this.conflict = {
            baseline: cloneContent(savedDraft.baseline),
            disk: cloneContent(disk.content),
            local: cloneContent(savedDraft.draft),
          };
        } else {
          this.status = "dirty";
        }
      }
    }
    if (this.vaultUnavailable) {
      this.status = "offline";
      this.error = diskResult.error;
    } else if (this.conflict) {
      this.status = "conflict";
    }
    this.initialized = true;
    this.publish();
    if (this.pendingSave) this.startPolling();
    if (
      savedDraft &&
      !this.pendingSave &&
      !this.conflict &&
      !this.vaultUnavailable
    ) {
      this.scheduleAutosave();
    }
    return this.snapshot();
  }

  snapshot(): EditorSessionSnapshot {
    return {
      baseline: cloneContent(this.baseline),
      content: cloneContent(this.content),
      source: this.source,
      conflict: this.conflict
        ? {
            baseline: cloneContent(this.conflict.baseline),
            disk: cloneContent(this.conflict.disk),
            local: cloneContent(this.conflict.local),
          }
        : null,
      vaultUnavailable: this.vaultUnavailable,
      composing: this.composing,
      compositionOwner: this.compositionOwner,
      revision: this.revision,
      status: this.status,
      error: this.error,
      draftPersisted:
        this.persistedDraftRevision >= this.revision && this.revision > 0,
    };
  }

  attachView(
    listener: (snapshot: EditorSessionSnapshot) => void,
  ): EditorSessionView {
    if (this.disposed) throw this.disposedError("attachView");
    const id = this.nextViewID++;
    this.views.set(id, listener);
    listener(this.snapshot());
    this.startPolling();
    let attached = true;
    return {
      id,
      detach: () => {
        if (!attached) return;
        attached = false;
        this.views.delete(id);
        if (this.compositionOwner === id) {
          this.composing = false;
          this.compositionOwner = null;
          this.publish();
          this.scheduleAutosave();
        }
        if (this.views.size === 0) {
          if (!this.pendingSave) this.stopPolling();
          void this.flushDraft()
            .then(() => this.requestSave())
            .catch((error: unknown) => this.setError(String(error)));
        }
      },
    };
  }

  edit(content: UserNoteContent, viewID?: number): boolean {
    this.assertReady();
    if (this.composing && this.compositionOwner !== viewID) return false;
    this.content = cloneContent(content);
    this.saveBlocked = false;
    if (this.conflict) {
      this.conflict = { ...this.conflict, local: cloneContent(this.content) };
    }
    this.revision++;
    if (!sameContent(this.content, this.baseline)) {
      this.status = this.conflict ? "conflict" : "dirty";
    } else if (!this.conflict) {
      this.status = this.pendingSave ? "pending" : "dirty";
    }
    this.error = "";
    this.publish();
    if (!this.composing) this.scheduleAutosave();
    return true;
  }

  beginComposition(viewID: number): boolean {
    if (this.composing && this.compositionOwner !== viewID) return false;
    this.composing = true;
    this.compositionOwner = viewID;
    this.clearDebounceTimers();
    this.publish();
    return true;
  }

  endComposition(content: UserNoteContent, viewID: number): void {
    if (!this.composing || this.compositionOwner !== viewID) return;
    this.composing = false;
    this.compositionOwner = null;
    if (content) {
      this.content = cloneContent(content);
      this.revision++;
      if (this.conflict) {
        this.conflict = { ...this.conflict, local: cloneContent(this.content) };
      }
    }
    this.publish();
    this.scheduleAutosave();
  }

  async flushDraft(): Promise<void> {
    this.assertReady();
    this.clearDraftTimer();
    while (
      this.persistedDraftRevision < this.revision &&
      (!sameContent(this.content, this.baseline) ||
        this.conflict !== null ||
        this.pendingSave !== null ||
        this.writing)
    ) {
      const revision = this.revision;
      const draft = this.makeDraft(this.content, this.baseline);
      const operation = this.draftTail.then(() =>
        this.adapter.writeDraft(draft),
      );
      this.draftTail = operation.catch(() => {});
      await operation;
      this.persistedDraftRevision = Math.max(
        this.persistedDraftRevision,
        revision,
      );
    }
    if (
      sameContent(this.content, this.baseline) &&
      !this.conflict &&
      !this.pendingSave &&
      !this.writing
    ) {
      await this.deleteDraftIfCurrent(this.revision);
    }
    this.publish();
  }

  requestSave(): Promise<void> {
    this.assertReady();
    this.saveBlocked = false;
    this.clearSaveTimer();
    this.saveRequested = true;
    const operation = this.enqueueSave(() => this.processSaveQueue());
    void operation.catch((error: unknown) => this.setError(String(error)));
    return operation;
  }

  async poll(): Promise<void> {
    if (
      !this.initialized ||
      this.disposed ||
      this.composing ||
      this.pollInFlight
    )
      return;
    this.pollInFlight = true;
    let needsSave = false;
    try {
      await this.enqueueSave(async () => {
        if (this.disposed || this.composing) return;
        if (this.pendingSave) {
          const pending = this.pendingSave;
          const outcome = await this.adapter.getSaveOutcome?.(
            pending.requestId,
          );
          if (!outcome || outcome.status === "pending") {
            this.status = "pending";
            this.publish();
            return;
          }

          const disk = await this.adapter.readDisk();
          this.pendingSave = null;
          this.source = disk.source;
          this.vaultUnavailable = false;
          if (sameContent(disk.content, pending.snapshot)) {
            this.baseline = cloneContent(pending.snapshot);
            this.error = "";
            if (sameContent(this.content, this.baseline)) {
              this.saveRequested = false;
              this.status = "saved";
              await this.deleteDraftIfCurrent(this.revision);
            } else {
              this.saveRequested = false;
              this.status = "dirty";
              needsSave = true;
              await this.writeDraftSnapshot(
                this.content,
                this.baseline,
                this.revision,
              );
            }
            this.publish();
            return;
          }

          if (outcome.status === "completed") {
            if (sameContent(disk.content, pending.baseline)) {
              this.saveBlocked = true;
              this.saveRequested = false;
              this.status = "error";
              this.error =
                "The pending request was removed without a saved result; the local draft is preserved. Click Save to retry.";
              this.publish();
              return;
            }
          }

          this.clearDebounceTimers();
          this.conflict = {
            baseline: cloneContent(pending.baseline),
            disk: cloneContent(disk.content),
            local: cloneContent(this.content),
          };
          this.status = "conflict";
          await this.flushDraft();
          this.publish();
          return;
        }
        const disk = await this.adapter.readDisk();
        this.source = disk.source;
        this.vaultUnavailable = false;
        if (sameContent(disk.content, this.baseline)) {
          if (
            !this.saveBlocked &&
            !this.conflict &&
            !sameContent(this.content, this.baseline)
          ) {
            needsSave = true;
          }
          if (this.status === "offline") this.status = "dirty";
          if (!this.saveBlocked) this.error = "";
          this.publish();
          return;
        }
        if (!this.conflict && sameContent(this.content, this.baseline)) {
          this.baseline = cloneContent(disk.content);
          this.content = cloneContent(disk.content);
          this.revision++;
          this.status = "saved";
          this.error = "";
        } else {
          this.clearDebounceTimers();
          this.conflict = {
            baseline: cloneContent(this.baseline),
            disk: cloneContent(disk.content),
            local: cloneContent(this.content),
          };
          this.status = "conflict";
          await this.flushDraft();
        }
        this.publish();
      });
      if (needsSave) void this.requestSave();
    } catch (error) {
      this.vaultUnavailable = true;
      this.status = "offline";
      this.error = String(error);
      this.publish();
    } finally {
      this.pollInFlight = false;
      this.collectIfIdle();
    }
  }

  async useDisk(
    content: UserNoteContent,
    source = this.source,
    expectedRevision = this.revision,
  ): Promise<void> {
    await this.enqueueSave(async () => {
      await this.draftTail;
      if (this.revision !== expectedRevision) {
        throw new Error("Editor changed while resolving the conflict; retry.");
      }
      this.baseline = cloneContent(content);
      this.content = cloneContent(content);
      this.source = source;
      this.conflict = null;
      this.saveRequested = false;
      this.clearDebounceTimers();
      this.vaultUnavailable = false;
      this.revision++;
      this.status = "saved";
      this.error = "";
      await this.deleteDraftIfCurrent(this.revision);
      this.publish();
    });
  }

  async keepLocal(
    disk: UserNoteContent,
    local: UserNoteContent = this.content,
    expectedRevision = this.revision,
  ): Promise<EditorSessionSaveResult> {
    return this.enqueueSave(async () => {
      await this.flushDraft();
      if (this.revision !== expectedRevision) {
        throw new Error("Editor changed while resolving the conflict; retry.");
      }
      const result = await this.adapter.save(disk, local, true);
      if (result.status === "pending") {
        this.conflict = null;
        this.saveRequested = false;
        await this.recordPendingSave(result.requestId, disk, local);
      } else if (result.status === "saved") {
        this.baseline = normalizeContent(local);
        this.conflict = null;
        this.saveRequested = false;
        this.clearDebounceTimers();
        this.error = "";
        if (this.revision === expectedRevision) {
          this.content = normalizeContent(local);
          this.revision++;
          this.status = "saved";
          await this.deleteDraftIfCurrent(this.revision);
        } else {
          this.saveRequested = true;
          this.status = "dirty";
          this.scheduleAutosave();
        }
        this.publish();
      } else if (result.status === "conflict") {
        this.conflict = {
          baseline: cloneContent(disk),
          disk: cloneContent(result.current),
          local: cloneContent(this.content),
        };
        this.status = "conflict";
        this.publish();
      }
      return result;
    });
  }

  async restore(
    baseline: UserNoteContent,
    restored: UserNoteContent,
    expectedRevision = this.revision,
  ): Promise<EditorSessionSaveResult> {
    return this.enqueueSave(async () => {
      await this.flushDraft();
      if (this.revision !== expectedRevision) {
        throw new Error("Editor changed while restoring a copy; retry.");
      }
      const result = await this.adapter.save(baseline, restored);
      if (result.status === "pending") {
        this.conflict = null;
        this.saveRequested = false;
        if (this.revision === expectedRevision) {
          this.content = normalizeContent(restored);
          this.revision++;
        }
        await this.recordPendingSave(result.requestId, baseline, restored);
      } else if (result.status === "saved") {
        this.baseline = normalizeContent(restored);
        this.conflict = null;
        this.saveRequested = false;
        this.clearDebounceTimers();
        this.error = "";
        if (this.revision === expectedRevision) {
          this.content = normalizeContent(restored);
          this.revision++;
          this.status = "saved";
          await this.deleteDraftIfCurrent(this.revision);
        } else {
          this.saveRequested = true;
          this.status = "dirty";
          this.scheduleAutosave();
        }
        this.publish();
      } else if (result.status === "conflict") {
        this.conflict = {
          baseline: cloneContent(baseline),
          disk: cloneContent(result.current),
          local: cloneContent(this.content),
        };
        this.status = "conflict";
        this.publish();
      }
      return result;
    });
  }

  private scheduleAutosave(): void {
    this.clearDebounceTimers();
    if (this.conflict || this.composing) return;
    this.draftTimer = setTimeout(() => {
      void this.flushDraft().catch((error: unknown) =>
        this.setError(String(error)),
      );
    }, draftDelayMs);
    this.saveTimer = setTimeout(() => {
      void this.requestSave().catch((error: unknown) =>
        this.setError(String(error)),
      );
    }, saveDelayMs);
  }

  private async processSaveQueue(): Promise<void> {
    while (this.saveRequested && !this.conflict && !this.composing) {
      if (this.pendingSave) {
        this.status = "pending";
        this.publish();
        return;
      }
      this.saveRequested = false;
      const revision = this.revision;
      const snapshot = cloneContent(this.content);
      if (sameContent(snapshot, this.baseline)) {
        await this.deleteDraftIfCurrent(revision);
        if (this.revision === revision) {
          this.status = "saved";
        } else {
          this.saveRequested = true;
          this.status = "dirty";
        }
        this.publish();
        continue;
      }
      this.status = "saving";
      this.error = "";
      this.publish();
      await this.writeDraftSnapshot(snapshot, this.baseline, revision);
      this.writing = true;
      let result: EditorSessionSaveResult;
      try {
        result = await this.adapter.save(this.baseline, snapshot);
      } finally {
        this.writing = false;
      }
      if (result.status === "pending") {
        await this.recordPendingSave(result.requestId, this.baseline, snapshot);
        return;
      }
      if (result.status === "error") throw new Error(result.message);
      if (result.status === "conflict") {
        this.clearDebounceTimers();
        this.conflict = {
          baseline: cloneContent(this.baseline),
          disk: cloneContent(result.current),
          local: cloneContent(this.content),
        };
        this.status = "conflict";
        await this.flushDraft();
        this.publish();
        return;
      }
      this.baseline = normalizeContent(snapshot);
      this.vaultUnavailable = false;
      if (revision === this.revision) {
        this.content = normalizeContent(snapshot);
        this.revision++;
        await this.deleteDraftIfCurrent(this.revision);
        if (sameContent(this.content, this.baseline)) {
          this.status = "saved";
        } else {
          this.saveRequested = true;
          this.status = "dirty";
        }
      } else {
        this.saveRequested = true;
        this.status = "dirty";
      }
      this.publish();
    }
    this.collectIfIdle();
  }

  private async writeDraftSnapshot(
    content: UserNoteContent,
    baseline: UserNoteContent,
    revision: number,
  ): Promise<void> {
    const draft = this.makeDraft(content, baseline);
    const operation = this.draftTail.then(() => this.adapter.writeDraft(draft));
    this.draftTail = operation.catch(() => {});
    await operation;
    this.persistedDraftRevision = Math.max(
      this.persistedDraftRevision,
      revision,
    );
    if (this.revision > revision) await this.flushDraft();
  }

  private async deleteDraftIfCurrent(revision: number): Promise<void> {
    const operation = this.draftTail.then(async () => {
      if (
        this.revision === revision &&
        !this.pendingSave &&
        !this.writing &&
        sameContent(this.content, this.baseline)
      ) {
        await this.adapter.deleteDraft(this.identity.cardID);
        this.persistedDraftRevision = revision;
      }
    });
    this.draftTail = operation.catch(() => {});
    await operation;
  }

  private makeDraft(
    content: UserNoteContent,
    baseline: UserNoteContent,
  ): EditorDraft {
    return {
      schema: 1,
      cardID: this.identity.cardID,
      sourceID: this.identity.sourceID,
      relativePath: this.identity.relativePath,
      baseline: cloneContent(baseline),
      draft: cloneContent(content),
      updatedAt: new Date().toISOString(),
      ...(this.pendingSave
        ? { pendingSave: clonePendingSave(this.pendingSave) }
        : {}),
    };
  }

  private clearDraftTimer(): void {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
  }

  private clearSaveTimer(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
  }

  private clearDebounceTimers(): void {
    this.clearDraftTimer();
    this.clearSaveTimer();
  }

  private setError(message: string): void {
    this.status = "error";
    this.saveBlocked = true;
    this.error = message;
    this.publish();
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.views.values()) listener(snapshot);
  }

  private enqueueSave<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.saveTail.then(operation);
    this.saveTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertReady(): void {
    if (!this.initialized || this.disposed) {
      throw new Error("Editor session is not available.");
    }
  }

  private collectIfIdle(): void {
    if (
      this.retainCount === 0 &&
      this.views.size === 0 &&
      this.status === "saved" &&
      !this.conflict &&
      !this.pendingSave &&
      !this.saveRequested
    ) {
      this.disposed = true;
      this.clearDebounceTimers();
      this.stopPolling();
      if (sessions.get(this.key) === this) sessions.delete(this.key);
    }
  }

  private disposedError(operation: string): Error {
    return new Error(
      `Editor session is disposed during ${operation} (retains=${this.retainCount}, views=${this.views.size}, initialized=${this.initialized})`,
    );
  }

  private async recordPendingSave(
    requestId: string,
    baseline: UserNoteContent,
    snapshot: UserNoteContent,
  ): Promise<void> {
    this.pendingSave = {
      requestId,
      baseline: cloneContent(baseline),
      snapshot: normalizeContent(snapshot),
    };
    this.status = "pending";
    this.error = "";
    this.startPolling();
    await this.writeDraftSnapshot(this.content, this.baseline, this.revision);
    this.publish();
  }

  private startPolling(): void {
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => void this.poll(), pollIntervalMs);
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }
}

export function acquireEditorSession(
  identity: EditorSessionIdentity,
  adapter: EditorSessionAdapter,
): EditorSession {
  const key = sessionKey(identity);
  const existing = sessions.get(key);
  if (existing) return existing;
  const session = new EditorSession(identity, adapter, key);
  sessions.set(key, session);
  return session;
}

export function activeEditorSessionCount(): number {
  return sessions.size;
}

export async function checkpointEditorSessions(): Promise<void> {
  const results = await Promise.allSettled(
    [...sessions.values()].map(async (session) => {
      await session.initialize();
      await session.flushDraft();
    }),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    throw new Error(`${failures.length} editor draft checkpoint(s) failed.`);
  }
}
