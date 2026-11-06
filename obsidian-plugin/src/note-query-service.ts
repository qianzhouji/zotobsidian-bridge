import { createHash, randomUUID } from "node:crypto";
import { constants, watch, type FSWatcher } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CachedMetadata, TFile } from "obsidian";
import { verifyColdNavigationCache } from "./note-query-metadata.ts";
import {
  NOTE_QUERY_CAPABILITIES_TTL,
  NOTE_QUERY_LIMITS as L,
  NOTE_QUERY_OPERATIONS,
  NOTE_QUERY_PROTOCOL_VERSION,
  validateNoteQueryPath,
  validateNoteQueryRequest,
  validateNoteQueryResponse,
  type NoteQueryCapabilities,
  type NoteQueryRequest,
  type NoteQueryResponse,
  type NoteQueryMetadata,
  type NoteQueryResultMap,
  type NoteQueryStatus,
} from "../../src/core/note-query-protocol.ts";
import { detectImageFormat } from "../../src/core/image-resource.ts";
import { assertQueueOutsideVault } from "./path-safety.ts";
import {
  acquireQueueOwnership,
  type QueueOwnership,
} from "./queue-ownership.ts";

export interface NoteQueryHost {
  vaultRoot: string;
  files(): TFile[];
  cache(file: TFile): CachedMetadata | null;
  resolve(linkpath: string, sourcePath: string): TFile | null;
  file(path: string): TFile | null;
  resolveHeading?(
    headings: NonNullable<CachedMetadata["headings"]>,
    fragment: string,
  ): number | null;
}
export interface NoteQuerySettings {
  queueDirectory: string;
  vaultId: string;
  enabled: boolean;
  readFolders: string[];
}
class QueryError extends Error {
  status: NoteQueryStatus;
  constructor(status: NoteQueryStatus) {
    super(status);
    this.status = status;
  }
}
const hash = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const excluded =
  /^(?:\.|trash$|recovery$|recovery copies$|bridge[ -]recovery$)/i;

export function allowedNotePath(
  value: string,
  folders: readonly string[],
): boolean {
  try {
    validateNoteQueryPath(value);
  } catch {
    return false;
  }
  return (
    !value.split("/").some((part) => excluded.test(part)) &&
    (!folders.length ||
      folders.some((folder) => value.startsWith(`${folder}/`)))
  );
}

// Reject symlinks in every existing component, even links pointing inside the Vault.
async function safePath(root: string, relative: string): Promise<string> {
  validateNoteQueryPath(relative);
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new QueryError("forbidden");
  }
  return current;
}
async function readBounded(file: string, max: number): Promise<Uint8Array> {
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1)
      throw new QueryError("forbidden");
    if (before.size > max) throw new QueryError("too-large");
    const bytes = new Uint8Array(before.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat();
    if (bytesRead > max) throw new QueryError("too-large");
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytesRead !== before.size
    )
      throw new QueryError("stale");
    return bytes.slice(0, bytesRead);
  } finally {
    await handle.close();
  }
}
const utf8 = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);

export class NoteQueryService {
  readonly epoch = randomUUID();
  indexGeneration = 0;
  initialBuilds = 0;
  private index = new Map<
    string,
    { path: string; basename: string; aliases: string[] }
  >();
  private metadata = new Map<
    string,
    { revision: string; cache: CachedMetadata }
  >();
  private root = "";
  private vaultRoot = "";
  private owner?: QueueOwnership;
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = true;
  private processing = false;
  private active = new Set<Promise<void>>();
  private busyIds = new Set<string>();
  private settings: NoteQuerySettings;
  private host: NoteQueryHost;

  constructor(host: NoteQueryHost, settings: NoteQuerySettings) {
    this.host = host;
    this.settings = { ...settings, readFolders: [...settings.readFolders] };
    this.settings.readFolders.forEach(validateNoteQueryPath);
  }
  async start(): Promise<void> {
    if (!this.stopped || !this.settings.queueDirectory) return;
    this.vaultRoot = await fs.realpath(this.host.vaultRoot);
    await assertQueueOutsideVault(this.vaultRoot, this.settings.queueDirectory);
    const queue = await fs.realpath(this.settings.queueDirectory);
    this.root = path.join(queue, "note-query");
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await safePath(queue, "note-query");
    for (const folder of ["requests", "responses"]) {
      await fs.mkdir(path.join(this.root, folder), {
        recursive: true,
        mode: 0o700,
      });
      await safePath(this.root, folder);
    }
    this.owner = await acquireQueueOwnership(this.root, this.settings.vaultId);
    this.stopped = false;
    if (this.settings.enabled) {
      this.initialBuilds++;
      for (const file of this.host.files()) this.update(file);
      this.watcher = watch(
        path.join(this.root, "requests"),
        () => void this.pump(),
      );
    }
    await this.publish();
    this.timer = setInterval(() => {
      void this.publish().catch(() => {});
      void this.sweep().catch(() => {});
      if (this.settings.enabled) void this.pump();
    }, 5000);
    if (this.settings.enabled) void this.pump();
  }
  update(file: TFile, data?: string, cache?: CachedMetadata): void {
    this.index.delete(file.path);
    this.metadata.delete(file.path);
    if (
      !this.settings.enabled ||
      file.extension !== "md" ||
      !allowedNotePath(file.path, this.settings.readFolders)
    )
      return;
    const current = cache ?? this.host.cache(file);
    const raw = current?.frontmatter?.aliases ?? current?.frontmatter?.alias;
    const aliases = (
      Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
    )
      .filter(
        (item): item is string =>
          typeof item === "string" && item.length > 0 && item.length <= 1024,
      )
      .slice(0, 64);
    this.index.set(file.path, {
      path: file.path,
      basename: file.basename,
      aliases,
    });
    if (
      data !== undefined &&
      cache &&
      Buffer.byteLength(data) <= L.maxNoteBytes
    ) {
      this.metadata.set(file.path, {
        revision: hash(data),
        cache: structuredClone(cache),
      });
    }
    this.indexGeneration++;
  }
  remove(filePath: string): void {
    this.index.delete(filePath);
    this.metadata.delete(filePath);
    this.indexGeneration++;
  }
  capabilities(now = Date.now()): NoteQueryCapabilities {
    return {
      readProtocolVersion: NOTE_QUERY_PROTOCOL_VERSION,
      targetVaultId: this.settings.vaultId,
      pairingEpoch: this.epoch,
      enabled: this.settings.enabled && !this.stopped,
      ready: !this.stopped,
      operations: [...NOTE_QUERY_OPERATIONS],
      readFolders: this.settings.readFolders,
      limits: L,
      indexGeneration: this.indexGeneration,
      updatedAt: now,
      expiresAt: now + NOTE_QUERY_CAPABILITIES_TTL,
    };
  }
  private async atomic(relative: string, value: unknown): Promise<void> {
    const parent = path.posix.dirname(relative);
    if (parent !== ".") await safePath(this.root, parent);
    const target = path.join(this.root, relative);
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(value), {
        flag: "wx",
        mode: 0o600,
      });
      await fs.rename(tmp, target);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
  private async publish(): Promise<void> {
    if (!this.stopped)
      await this.atomic("capabilities.json", this.capabilities());
  }
  async stop(): Promise<void> {
    this.stopped = true;
    this.watcher?.close();
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.active]);
    if (this.owner) {
      await this.atomic("capabilities.json", this.capabilities()).catch(
        () => {},
      );
      await this.owner.release();
      this.owner = undefined;
    }
    this.index.clear();
    this.metadata.clear();
  }
  private async note(
    filePath: string,
  ): Promise<NoteQueryResultMap["read-note"]> {
    if (!allowedNotePath(filePath, this.settings.readFolders))
      throw new QueryError("forbidden");
    if (!filePath.endsWith(".md")) throw new QueryError("unsupported");
    const markdown = utf8(
      await readBounded(
        await safePath(this.vaultRoot, filePath),
        L.maxNoteBytes,
      ),
    );
    const revision = hash(markdown);
    let tracked = this.metadata.get(filePath);
    if (!tracked) {
      const file = this.host.file(filePath);
      const cache =
        file && verifyColdNavigationCache(markdown, this.host.cache(file));
      if (cache) {
        tracked = { revision, cache };
        this.metadata.set(filePath, tracked);
      }
    }
    const metadata: NoteQueryMetadata = {
      valid: false,
      headings: [],
      blocks: [],
    };
    if (tracked?.revision === revision) {
      metadata.valid = true;
      metadata.revision = revision;
      metadata.headings = (tracked.cache.headings ?? []).map(
        ({ heading, level, position }) => ({ heading, level, position }),
      );
      metadata.blocks = Object.entries(tracked.cache.blocks ?? {}).map(
        ([id, item]) => ({ id, position: item.position }),
      );
      if (
        metadata.headings.length > L.maxMetadataEntries ||
        metadata.blocks.length > L.maxMetadataEntries
      )
        throw new QueryError("too-large");
    }
    return {
      path: filePath,
      markdown,
      revision,
      metadata,
      indexGeneration: this.indexGeneration,
      readAt: Date.now(),
    };
  }
  private resolveFile(
    linkpath: string,
    sourcePath: string,
  ): { file: TFile; fragment: string } {
    if (!allowedNotePath(sourcePath, this.settings.readFolders))
      throw new QueryError("forbidden");
    const hashAt = linkpath.indexOf("#");
    const target = hashAt < 0 ? linkpath : linkpath.slice(0, hashAt);
    const fragment = hashAt < 0 ? "" : linkpath.slice(hashAt + 1);
    // Relative links are resolved by the host; only the returned canonical path is used for IO.
    const file = target
      ? this.host.resolve(target, sourcePath)
      : this.host.file(sourcePath);
    if (!file) throw new QueryError("not-found");
    if (!allowedNotePath(file.path, this.settings.readFolders))
      throw new QueryError("forbidden");
    return { file, fragment };
  }
  private async execute(request: NoteQueryRequest): Promise<unknown> {
    switch (request.operation) {
      case "search-notes": {
        const { query, sourcePath, limit = 20, cursor } = request.input;
        if (!allowedNotePath(sourcePath, this.settings.readFolders))
          throw new QueryError("forbidden");
        const q = query.toLocaleLowerCase();
        const signature = hash(JSON.stringify([query, sourcePath, limit]));
        let offset = 0;
        if (cursor) {
          const [generation, start, digest] = cursor.split(":");
          if (
            Number(generation) !== this.indexGeneration ||
            digest !== signature ||
            !Number.isSafeInteger(Number(start)) ||
            Number(start) < 0
          )
            throw new QueryError("stale");
          offset = Number(start);
        }
        const candidates = [...this.index.values()]
          .filter(
            (item) =>
              item.path.toLocaleLowerCase().includes(q) ||
              item.aliases.some((alias) =>
                alias.toLocaleLowerCase().includes(q),
              ),
          )
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        const items = [];
        let i = offset;
        for (; i < candidates.length && items.length < limit; i++) {
          const item = candidates[i];
          try {
            await safePath(this.vaultRoot, item.path);
          } catch {
            continue;
          }
          const matchedAlias = q
            ? item.aliases.find((alias) =>
                alias.toLocaleLowerCase().includes(q),
              )
            : undefined;
          items.push({
            path: item.path,
            basename: item.basename,
            title: item.basename,
            ...(matchedAlias ? { matchedAlias } : {}),
          });
        }
        return {
          items,
          indexGeneration: this.indexGeneration,
          ...(i < candidates.length
            ? { cursor: `${this.indexGeneration}:${i}:${signature}` }
            : {}),
        };
      }
      case "read-note":
        return this.note(request.input.path);
      case "resolve-link": {
        const { file, fragment } = this.resolveFile(
          request.input.linkpath,
          request.input.sourcePath,
        );
        const note = await this.note(file.path);
        const result: NoteQueryResultMap["resolve-link"] = {
          path: file.path,
          revision: note.revision,
          indexGeneration: this.indexGeneration,
          anchorState: "none",
          ...(fragment ? { fragment } : {}),
        };
        if (!fragment) return result;
        if (!note.metadata.valid) {
          result.anchorState = "indexing";
          return result;
        }
        const isBlock = fragment.startsWith("^");
        const matches = isBlock
          ? note.metadata.blocks.filter(
              (block) => block.id === fragment.slice(1),
            )
          : matchingHeadings(note.metadata, fragment, this.host.resolveHeading);
        result.anchorState = !matches.length
          ? "missing"
          : matches.length > 1
            ? "ambiguous"
            : "found";
        if (matches.length === 1)
          result.anchor = {
            kind: isBlock ? "block" : "heading",
            id: fragment,
            position: matches[0].position,
          };
        return result;
      }
      case "read-note-resource": {
        const { file, fragment } = this.resolveFile(
          request.input.linkpath,
          request.input.sourcePath,
        );
        if (fragment || !/\.(png|jpe?g|gif|webp)$/i.test(file.path))
          throw new QueryError("unsupported");
        const bytes = await readBounded(
          await safePath(this.vaultRoot, file.path),
          L.maxResourceBytes,
        );
        const format = detectImageFormat(bytes);
        if (
          !format ||
          !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
            format.mimeType,
          )
        )
          throw new QueryError("unsupported");
        return {
          path: file.path,
          mimeType: format.mimeType,
          base64: Buffer.from(bytes).toString("base64"),
          byteLength: bytes.length,
          revision: hash(bytes),
          readAt: Date.now(),
        };
      }
    }
  }
  async handle(raw: unknown): Promise<NoteQueryResponse> {
    const request = validateNoteQueryRequest(raw);
    const { input: _input, ...envelope } = request;
    let body: unknown;
    try {
      if (this.stopped || !this.settings.enabled)
        throw new QueryError("forbidden");
      if (
        request.targetVaultId !== this.settings.vaultId ||
        request.pairingEpoch !== this.epoch
      )
        throw new QueryError("forbidden");
      const result = await this.execute(request);
      if (this.stopped) throw new QueryError("stale");
      body = { status: "ok", result };
    } catch (error) {
      const status =
        error instanceof QueryError
          ? error.status
          : (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "not-found"
            : "forbidden";
      body = { status };
    }
    return validateNoteQueryResponse({
      ...envelope,
      ...(body as object),
      respondedAt: Date.now(),
    });
  }
  async pump(): Promise<void> {
    if (this.stopped || this.processing || !this.settings.enabled) return;
    this.processing = true;
    try {
      const directory = await safePath(this.root, "requests");
      for (const name of (await fs.readdir(directory)).slice(0, 1024)) {
        if (this.active.size >= L.maxConcurrent) break;
        if (
          !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json$/.test(name) ||
          this.busyIds.has(name)
        )
          continue;
        this.busyIds.add(name);
        const task = this.processFile(name).finally(() => {
          this.active.delete(task);
          this.busyIds.delete(name);
          if (!this.stopped) void this.pump();
        });
        this.active.add(task);
      }
    } catch {
      /* A transient/moved queue is retried by the bounded heartbeat. */
    } finally {
      this.processing = false;
    }
  }
  private async processFile(name: string): Promise<void> {
    try {
      const file = await safePath(this.root, `requests/${name}`);
      const raw = JSON.parse(utf8(await readBounded(file, L.maxRequestBytes)));
      const request = validateNoteQueryRequest(raw);
      if (name !== `${request.requestId}.json`) return;
      const response = await this.handle(request);
      if (this.stopped) return;
      // Cancellation removes the request. A late response is never a write ACK.
      await safePath(this.root, `requests/${name}`);
      await this.atomic(`responses/${name}`, response);
    } catch {
      /* Invalid, cancelled, expired and oversized inputs never execute writes. */
    } finally {
      await fs.unlink(path.join(this.root, "requests", name)).catch(() => {});
    }
  }
  async sweep(now = Date.now()): Promise<void> {
    for (const folder of ["requests", "responses"]) {
      const directory = await safePath(this.root, folder);
      for (const name of (await fs.readdir(directory)).slice(0, 4096)) {
        if (
          !/^[A-Za-z0-9_.-]+\.(json|tmp)$/.test(name) ||
          this.busyIds.has(name)
        )
          continue;
        const file = path.join(directory, name);
        const stat = await fs.lstat(file);
        if (
          !stat.isSymbolicLink() &&
          stat.isFile() &&
          now - stat.mtimeMs > L.maxTTL
        )
          await fs.unlink(file).catch(() => {});
      }
    }
  }
}

function matchingHeadings(
  metadata: NoteQueryMetadata,
  fragment: string,
  resolve?: NoteQueryHost["resolveHeading"],
) {
  const parts = fragment.split("#");
  const ancestry: NoteQueryMetadata["headings"] = [];
  return metadata.headings.filter((heading) => {
    while (
      ancestry.length &&
      ancestry[ancestry.length - 1].level >= heading.level
    )
      ancestry.pop();
    ancestry.push(heading);
    if (resolve)
      return resolve(ancestry, fragment) === heading.position.start.offset;
    const names = ancestry.map((item) => item.heading);
    return (
      parts.length <= names.length &&
      parts.every(
        (part, index) => part === names[names.length - parts.length + index],
      )
    );
  });
}
