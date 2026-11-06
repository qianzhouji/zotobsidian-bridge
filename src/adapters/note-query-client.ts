import {
  NOTE_QUERY_LIMITS as L,
  validateNoteQueryCapabilities,
  validateNoteQueryRequest,
  validateNoteQueryResponse,
  type NoteQueryInputMap,
  type NoteQueryOperation,
  type NoteQueryResponse,
  type NoteQueryStatus,
} from "../core/note-query-protocol.ts";

export interface NoteQueryTransport {
  read(relative: string, maxBytes: number): Promise<unknown | null>;
  publish(relative: string, value: unknown): Promise<void>;
  remove(relative: string): Promise<void>;
}
export class NoteQueryError extends Error {
  status: NoteQueryStatus | "cancelled";
  constructor(status: NoteQueryStatus | "cancelled") {
    super(`Linked note: ${status}`);
    this.status = status;
  }
}
export class NoteQueryClient {
  private readonly sessionId = crypto.randomUUID();
  private generation = 0;
  private closed = false;
  private epoch = "";
  private pending = new Set<AbortController>();
  private channels = new Map<string, AbortController>();
  private transport: NoteQueryTransport;
  private vaultId: string;
  private createAbortController: () => AbortController;

  constructor(
    transport: NoteQueryTransport,
    vaultId: string,
    createAbortController = () => new AbortController(),
  ) {
    this.transport = transport;
    this.vaultId = vaultId;
    this.createAbortController = createAbortController;
  }
  get inFlight(): number {
    return this.pending.size;
  }
  cancel(channel: string): void {
    this.channels.get(channel)?.abort();
  }
  /** Permission identity for bounded, process-local read caches. */
  async scope(): Promise<string> {
    if (this.closed) throw new NoteQueryError("cancelled");
    const raw = await this.transport.read(
      "capabilities.json",
      L.maxRequestBytes,
    );
    if (!raw) throw new NoteQueryError("offline");
    // Revocation must invalidate cached content even after the lease expires.
    const value = raw as Partial<
      import("../core/note-query-protocol.ts").NoteQueryCapabilities
    >;
    if (!value.enabled || value.targetVaultId !== this.vaultId)
      throw new NoteQueryError("forbidden");
    let caps;
    try {
      caps = validateNoteQueryCapabilities(raw);
    } catch {
      throw new NoteQueryError("offline");
    }
    return JSON.stringify([
      caps.targetVaultId,
      caps.pairingEpoch,
      caps.readFolders,
    ]);
  }
  close(): void {
    this.closed = true;
    for (const pending of this.pending) pending.abort();
    for (const pending of this.channels.values()) pending.abort();
    this.channels.clear();
  }
  async query<K extends NoteQueryOperation>(
    operation: K,
    input: NoteQueryInputMap[K],
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      channel?: string;
      debounceMs?: number;
    } = {},
  ): Promise<Extract<NoteQueryResponse, { operation: K }>> {
    if (this.closed) throw new NoteQueryError("cancelled");
    const controller = this.createAbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.channel) {
      this.channels.get(options.channel)?.abort();
      this.channels.set(options.channel, controller);
    }
    const id = crypto.randomUUID();
    let published = false;
    const check = () => {
      if (this.closed || controller.signal.aborted)
        throw new NoteQueryError("cancelled");
    };
    try {
      check();
      if (options.debounceMs)
        await delay(Math.min(options.debounceMs, 1000), controller.signal);
      check();
      if (this.pending.size >= L.maxConcurrent)
        throw new NoteQueryError("busy");
      this.pending.add(controller);
      let caps;
      const raw = await this.transport.read(
        "capabilities.json",
        L.maxRequestBytes,
      );
      check();
      if (!raw) throw new NoteQueryError("unsupported");
      try {
        caps = validateNoteQueryCapabilities(raw);
      } catch {
        throw new NoteQueryError("offline");
      }
      if (caps.targetVaultId !== this.vaultId)
        throw new NoteQueryError("forbidden");
      if (!caps.enabled) throw new NoteQueryError("forbidden");
      if (!caps.ready) throw new NoteQueryError("indexing");
      if (this.epoch && this.epoch !== caps.pairingEpoch) {
        for (const other of this.pending)
          if (other !== controller) other.abort();
      }
      this.epoch = caps.pairingEpoch;
      const now = Date.now();
      const safeInput =
        operation === "search-notes" &&
        (input as NoteQueryInputMap["search-notes"]).sourcePath ===
          "pending.md" &&
        caps.readFolders.length
          ? {
              ...(input as NoteQueryInputMap["search-notes"]),
              sourcePath: `${caps.readFolders[0]}/.zob-pending-source.md`,
            }
          : input;
      const request = validateNoteQueryRequest({
        readProtocolVersion: 1,
        requestId: id,
        targetVaultId: this.vaultId,
        pairingEpoch: caps.pairingEpoch,
        clientSessionId: this.sessionId,
        generation: ++this.generation,
        operation,
        input: safeInput,
        issuedAt: now,
        expiresAt:
          now + Math.min(L.maxTTL, Math.max(20, options.timeoutMs ?? 3000)),
      });
      check();
      await this.transport.publish(`requests/${id}.json`, request);
      published = true;
      while (Date.now() < request.expiresAt) {
        check();
        const value = await this.transport.read(
          `responses/${id}.json`,
          L.maxResponseBytes,
        );
        check();
        if (value) {
          const response = validateNoteQueryResponse(value);
          for (const key of [
            "requestId",
            "targetVaultId",
            "pairingEpoch",
            "clientSessionId",
            "generation",
            "operation",
            "issuedAt",
            "expiresAt",
          ] as const) {
            if (response[key] !== request[key])
              throw new NoteQueryError("stale");
          }
          // Re-check permission/epoch before accepting any body from an in-flight request.
          const latest = validateNoteQueryCapabilities(
            await this.transport.read("capabilities.json", L.maxRequestBytes),
          );
          check();
          if (
            !latest.enabled ||
            latest.pairingEpoch !== request.pairingEpoch ||
            latest.targetVaultId !== this.vaultId
          )
            throw new NoteQueryError("stale");
          return response as Extract<NoteQueryResponse, { operation: K }>;
        }
        await delay(
          Math.min(40, request.expiresAt - Date.now()),
          controller.signal,
        );
      }
      throw new NoteQueryError("timeout");
    } finally {
      this.pending.delete(controller);
      options.signal?.removeEventListener("abort", abort);
      if (options.channel && this.channels.get(options.channel) === controller)
        this.channels.delete(options.channel);
      if (published) {
        await this.transport.remove(`requests/${id}.json`).catch(() => {});
        await this.transport.remove(`responses/${id}.json`).catch(() => {});
      }
    }
  }
  search(input: NoteQueryInputMap["search-notes"], signal?: AbortSignal) {
    return this.query("search-notes", input, {
      signal,
      channel: "search",
      debounceMs: 120,
    });
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new NoteQueryError("cancelled"));
    };
    const timer = setTimeout(
      () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
      Math.max(0, ms),
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Transport never reads the Vault or enters the persistent write/ACK namespace. */
export function createZoteroNoteQueryClient(): NoteQueryClient {
  const host = Zotero.getMainWindow() as unknown as {
    AbortController: typeof AbortController;
    TextDecoder: typeof TextDecoder;
  };
  const prefix = "extensions.zotero.zoteroobsidianbridge";
  const queue = String(
    Zotero.Prefs.get(`${prefix}.companionQueuePath`, true) ?? "",
  );
  const vaultId = String(
    Zotero.Prefs.get(`${prefix}.companionVaultId`, true) ?? "",
  );
  if (!queue || !PathUtils.isAbsolute(queue) || !vaultId)
    throw new NoteQueryError("offline");
  const root = PathUtils.join(PathUtils.normalize(queue), "note-query");
  async function checked(relative: string): Promise<string> {
    if (
      !/^(capabilities\.json|(?:requests|responses)\/[0-9a-f-]{36}\.json)$/.test(
        relative,
      )
    )
      throw new NoteQueryError("forbidden");
    const target = PathUtils.join(root, ...relative.split("/"));
    let cursor: string | null = target;
    while (cursor) {
      if (await IOUtils.exists(cursor)) {
        if (Zotero.File.pathToFile(cursor).isSymlink())
          throw new NoteQueryError("forbidden");
      }
      const parent = PathUtils.parent(cursor);
      if (!parent || parent === cursor) break;
      cursor = parent;
    }
    return target;
  }
  return new NoteQueryClient(
    {
      async read(relative, max) {
        const target = await checked(relative);
        if (!(await IOUtils.exists(target))) return null;
        if (((await IOUtils.stat(target)).size ?? max + 1) > max)
          throw new NoteQueryError("too-large");
        const bytes = await IOUtils.read(target, { maxBytes: max + 1 });
        if (bytes.length > max) throw new NoteQueryError("too-large");
        return JSON.parse(new host.TextDecoder().decode(bytes));
      },
      async publish(relative, value) {
        const target = await checked(relative);
        const tmp = `${target}.${crypto.randomUUID()}.tmp`;
        try {
          await IOUtils.writeUTF8(tmp, JSON.stringify(value), {
            mode: "create",
          });
          await IOUtils.move(tmp, target, { noOverwrite: true });
        } finally {
          await IOUtils.remove(tmp, { ignoreAbsent: true }).catch(() => {});
        }
      },
      async remove(relative) {
        await IOUtils.remove(await checked(relative), { ignoreAbsent: true });
      },
    },
    vaultId,
    () => new host.AbortController(),
  );
}
