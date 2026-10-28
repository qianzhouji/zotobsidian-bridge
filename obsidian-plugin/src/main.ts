import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  App,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
} from "obsidian";
import {
  assertAllowedCompanionPath,
  assertCompanionVaultPairing,
  COMPANION_PROTOCOL_VERSION,
  MAX_COMPANION_RESOURCE_BYTES,
  type CompanionWriteRequest,
  type CompanionWriteResponse,
  normalizeVaultRelativePath,
  validateCompanionAck,
  validateCompanionRequest,
} from "../../src/adapters/companion-protocol.ts";
import {
  assertImageDecodable,
  detectImageFormat,
} from "../../src/core/image-resource.ts";
import { readFrontmatterValue } from "../../src/core/markdown.ts";
import {
  assertQueueOutsideVault,
  assertVaultPathContained,
} from "./path-safety.ts";
import {
  acquireQueueOwnership,
  QueueOwnershipError,
  type QueueOwnership,
} from "./queue-ownership.ts";
import { isRetryableFileError, retryDelayMs } from "./retry-policy.ts";

interface BridgeSettings {
  queueDirectory: string;
  outputFolder: string;
  vaultId: string;
}

const DEFAULT_SETTINGS: BridgeSettings = {
  queueDirectory: "",
  outputFolder: "Zotero Literature",
  vaultId: "",
};
const pollIntervalMs = 200;

class DeferredWriteError extends Error {}
class WriteConflictError extends Error {}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeIdentity(markdown: string): { cardId: string; sourceId: string } {
  const cardId =
    readFrontmatterValue(markdown, "bridge_card_id") ??
    readFrontmatterValue(markdown, "bridge_paper_id");
  const sourceId = readFrontmatterValue(markdown, "bridge_source_id");
  if (
    typeof cardId !== "string" ||
    typeof sourceId !== "string" ||
    !cardId ||
    !sourceId
  ) {
    throw new WriteConflictError(
      "Markdown is missing bridge identity metadata.",
    );
  }
  return { cardId, sourceId };
}

function existingMatchesRequest(
  markdown: string,
  request: CompanionWriteRequest,
): boolean {
  try {
    const identity = writeIdentity(markdown);
    return (
      identity.cardId === request.cardId &&
      identity.sourceId === request.sourceId
    );
  } catch {
    const type = readFrontmatterValue(markdown, "type");
    const library = readFrontmatterValue(markdown, "zotero_library");
    const itemKey = readFrontmatterValue(markdown, "zotero_item_key");
    return (
      type === "zotero-paper" &&
      typeof library === "string" &&
      typeof itemKey === "string" &&
      request.sourceId === `${library}/paper/${itemKey}` &&
      request.cardId === request.sourceId
    );
  }
}

function hasSameContentExceptUpdatedAt(
  current: string,
  requested: string,
): boolean {
  const normalize = (markdown: string): string => {
    if (!markdown.startsWith("---")) return markdown;
    const openingEnd = markdown.indexOf("\n");
    if (openingEnd < 0) return markdown;
    const closingStart = markdown.indexOf("\n---", openingEnd + 1);
    if (closingStart < 0) return markdown;
    const frontmatter = markdown.slice(openingEnd + 1, closingStart);
    const normalizedFrontmatter = frontmatter.replace(
      /^bridge_updated_at:[^\r\n]*/m,
      "bridge_updated_at: <volatile>",
    );
    return (
      markdown.slice(0, openingEnd + 1) +
      normalizedFrontmatter +
      markdown.slice(closingStart)
    );
  };
  return normalize(current) === normalize(requested);
}

function isInsideActiveEditor(app: App, pathValue: string): boolean {
  return app.workspace.getLeavesOfType("markdown").some((leaf) => {
    const view = leaf.view;
    return view instanceof MarkdownView && view.file?.path === pathValue;
  });
}

export default class ZoteroObsidianBridgePlugin extends Plugin {
  settings: BridgeSettings = DEFAULT_SETTINGS;
  private processing = false;
  private unloading = false;
  private status: HTMLElement | null = null;
  private queueOwnership: QueueOwnership | null = null;
  private readonly deferredRequests = new Set<string>();
  private readonly retryState = new Map<
    string,
    { attempts: number; nextAttemptAt: number }
  >();
  private heartbeatWriting = false;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
    if (!this.settings.vaultId) {
      this.settings.vaultId = crypto.randomUUID();
      await this.saveData(this.settings);
    }
    this.status = this.addStatusBarItem();
    this.status.setText("Zotero Bridge: queue not configured");
    this.addSettingTab(new BridgeSettingTab(this.app, this));
    void this.writeStatusHeartbeat();
    this.registerInterval(
      window.setInterval(() => void this.writeStatusHeartbeat(), 5000),
    );
    this.addCommand({
      id: "process-zotero-bridge-queue",
      name: "Process Zotero Bridge queue",
      callback: () => {
        this.retryState.clear();
        void this.processQueue();
      },
    });
    this.addCommand({
      id: "copy-zotero-bridge-vault-id",
      name: "Copy Zotero Bridge Vault pairing ID",
      callback: async () => {
        await navigator.clipboard.writeText(this.settings.vaultId);
        new Notice("Vault pairing ID copied.");
      },
    });
    this.registerInterval(
      window.setInterval(() => void this.processQueue(), pollIntervalMs),
    );
    void this.processQueue();
  }

  onunload(): void {
    this.unloading = true;
    if (!this.processing) void this.releaseQueueOwnership();
  }

  async saveSettings(): Promise<void> {
    const persisted = (await this.loadData()) as Partial<BridgeSettings> | null;
    const oldQueue = persisted?.queueDirectory?.trim() || "";
    const changedPairing =
      oldQueue !== this.settings.queueDirectory.trim() ||
      (persisted?.outputFolder ?? DEFAULT_SETTINGS.outputFolder) !==
        this.settings.outputFolder.trim();
    if (oldQueue && changedPairing) await this.assertQueueEmpty(oldQueue);
    this.settings.outputFolder = normalizeVaultRelativePath(
      this.settings.outputFolder || DEFAULT_SETTINGS.outputFolder,
    );
    if (this.settings.queueDirectory.trim()) {
      if (!path.isAbsolute(this.settings.queueDirectory.trim())) {
        throw new Error("The companion queue folder must be an absolute path.");
      }
      const queuePath = path.resolve(this.settings.queueDirectory);
      await this.assertQueueOutsideVaultRealPath(queuePath);
    }
    if (
      this.queueOwnership &&
      path.dirname(this.queueOwnership.lockPath) !==
        path.resolve(this.settings.queueDirectory)
    ) {
      await this.releaseQueueOwnership();
    }
    await this.saveData(this.settings);
    await this.writeStatusHeartbeat();
    void this.processQueue();
  }

  async testVaultWriteAccess(): Promise<void> {
    const folder = normalizeVaultRelativePath(
      this.settings.outputFolder || DEFAULT_SETTINGS.outputFolder,
    );
    const relativePath = `${folder}/Zotero Bridge Write Check ${crypto.randomUUID()}.md`;
    const content = `Zotero Bridge write check ${new Date().toISOString()}`;
    let created: TFile | null = null;
    let phase = "prepare output folder";
    try {
      await this.ensureFolder(folder);
      phase = "validate target path";
      await this.assertVaultPathContained(relativePath);
      if (this.app.vault.getAbstractFileByPath(relativePath)) {
        throw new Error(
          "The temporary check path unexpectedly already exists.",
        );
      }
      phase = "create temporary note";
      created = await this.app.vault.create(relativePath, content);
      phase = "read back temporary note";
      if ((await this.app.vault.read(created)) !== content) {
        throw new Error("The temporary Vault write did not round-trip.");
      }
      phase = "remove temporary note";
      try {
        await this.app.vault.delete(created);
      } catch {
        const adapter = this.app.vault.adapter;
        if (await adapter.exists(relativePath)) {
          await adapter.remove(relativePath);
        }
      }
      if (await this.app.vault.adapter.exists(relativePath)) {
        throw new Error("The temporary check note could not be removed.");
      }
      created = null;
      this.lastVaultWriteCheck = {
        at: new Date().toISOString(),
        success: true,
      };
      new Notice("Vault write check passed; temporary file was removed.");
    } catch (error) {
      this.lastVaultWriteCheck = {
        at: new Date().toISOString(),
        success: false,
        errorType: error instanceof Error ? error.name : "Error",
      };
      const adapter = this.app.vault.adapter;
      if (await adapter.exists(relativePath).catch(() => false)) {
        await adapter.remove(relativePath).catch(() => {});
      }
      new Notice(`Vault write check failed during ${phase}: ${String(error)}`);
      throw error;
    } finally {
      await this.writeStatusHeartbeat();
    }
  }

  private lastVaultWriteCheck:
    | { at: string; success: boolean; errorType?: string }
    | undefined;

  private async writeStatusHeartbeat(): Promise<void> {
    const configured = this.settings.queueDirectory.trim();
    if (!configured || !path.isAbsolute(configured) || this.heartbeatWriting)
      return;
    const root = path.resolve(configured);
    const statusPath = path.join(root, "bridge-status.json");
    const temporaryPath = `${statusPath}.${crypto.randomUUID()}.tmp`;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    const vaultPath = adapter.getBasePath();
    const status = {
      schema: 1,
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      vaultId: this.settings.vaultId,
      outputFolder: normalizeVaultRelativePath(
        this.settings.outputFolder || DEFAULT_SETTINGS.outputFolder,
      ),
      vaultPathHash: sha256(path.resolve(vaultPath)),
      lastSeenAt: new Date().toISOString(),
      lastVaultWriteCheck: this.lastVaultWriteCheck,
    };
    this.heartbeatWriting = true;
    try {
      await this.assertQueueOutsideVaultRealPath(root);
      if (!(await fs.stat(root)).isDirectory()) return;
      await fs.writeFile(temporaryPath, JSON.stringify(status), {
        encoding: "utf8",
        mode: 0o600,
      });
      await fs.rename(temporaryPath, statusPath);
    } catch {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    } finally {
      this.heartbeatWriting = false;
    }
  }

  private async assertQueueEmpty(queueDirectory: string): Promise<void> {
    for (const name of ["requests", "responses", "acks", "payloads"]) {
      try {
        const entries = await fs.readdir(path.join(queueDirectory, name));
        const hasPendingEntry = entries.some((entry) =>
          name === "payloads"
            ? /^[0-9a-f-]{36}\.bin$/i.test(entry)
            : /^[0-9a-f-]{36}\.json$/i.test(entry),
        );
        if (hasPendingEntry) {
          throw new Error(
            "Process and acknowledge all companion queue entries before changing the queue folder or output folder.",
          );
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private async queuePaths(): Promise<{
    requests: string;
    responses: string;
    acks: string;
    payloads: string;
  }> {
    const configured = this.settings.queueDirectory.trim();
    if (!configured || !path.isAbsolute(configured)) {
      throw new Error("Configure an absolute shared queue folder first.");
    }
    const root = path.resolve(configured);
    await this.assertQueueOutsideVaultRealPath(root);
    return {
      requests: path.join(root, "requests"),
      responses: path.join(root, "responses"),
      acks: path.join(root, "acks"),
      payloads: path.join(root, "payloads"),
    };
  }

  private async assertQueueOutsideVaultRealPath(
    queuePath: string,
  ): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    await assertQueueOutsideVault(adapter.getBasePath(), queuePath);
  }

  private async assertVaultPathContained(relativePath: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    try {
      await assertVaultPathContained(adapter.getBasePath(), relativePath);
    } catch (error) {
      throw new WriteConflictError(String(error));
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.unloading) return;
    const queueRetry = this.retryState.get("$queue");
    if (queueRetry && queueRetry.nextAttemptAt > Date.now()) {
      this.setStatus("Zotero Bridge: waiting to retry queue access");
      return;
    }
    this.processing = true;
    try {
      const directories = await this.queuePaths();
      await fs.mkdir(directories.requests, { recursive: true });
      await fs.mkdir(directories.responses, { recursive: true });
      await fs.mkdir(directories.acks, { recursive: true });
      await fs.mkdir(directories.payloads, { recursive: true });
      try {
        await this.claimQueueOwnership();
      } catch (error) {
        if (error instanceof QueueOwnershipError) {
          this.setStatus(
            "Zotero Bridge: queue owned by another instance",
            error.message,
          );
          return;
        }
        throw error;
      }
      this.retryState.delete("$queue");
      await this.collectAcknowledged(directories);
      const names = (await fs.readdir(directories.requests))
        .filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name))
        .map(async (name) => {
          let createdAt = "";
          try {
            const request = JSON.parse(
              await fs.readFile(path.join(directories.requests, name), "utf8"),
            ) as Partial<CompanionWriteRequest>;
            if (typeof request.createdAt === "string") {
              createdAt = request.createdAt;
            }
          } catch {
            createdAt = "";
          }
          return { name, createdAt };
        });
      const orderedRequests = (await Promise.all(names)).sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.name.localeCompare(right.name),
      );
      for (const { name } of orderedRequests) {
        const requestId = name.slice(0, -5);
        const retry = this.retryState.get(requestId);
        if (retry && retry.nextAttemptAt > Date.now()) continue;
        const requestPath = path.join(directories.requests, name);
        const responsePath = path.join(directories.responses, name);
        const ackPath = path.join(directories.acks, name);
        if (await this.exists(ackPath)) {
          this.deferredRequests.delete(requestId);
          continue;
        }
        if (await this.exists(responsePath)) {
          this.deferredRequests.delete(requestId);
          continue;
        }
        try {
          const request = validateCompanionRequest(
            JSON.parse(await fs.readFile(requestPath, "utf8")),
            this.settings.outputFolder,
          );
          if (request.requestId !== requestId) {
            throw new WriteConflictError("Request filename and ID differ.");
          }
          const result = await this.applyRequest(request);
          if (result === "deferred") {
            this.scheduleRetry(requestId);
            this.deferredRequests.add(requestId);
            continue;
          }
          const response: CompanionWriteResponse = {
            protocolVersion: COMPANION_PROTOCOL_VERSION,
            requestId,
            status: "applied",
            revision: result,
            completedAt: new Date().toISOString(),
          };
          await this.writeReceipt(responsePath, response);
          this.retryState.delete(requestId);
          this.deferredRequests.delete(requestId);
        } catch (error) {
          if (error instanceof DeferredWriteError) {
            this.scheduleRetry(requestId);
            this.deferredRequests.add(requestId);
            continue;
          }
          if (isRetryableFileError(error)) {
            this.scheduleRetry(requestId);
            this.deferredRequests.delete(requestId);
            this.setStatus("Zotero Bridge: waiting to retry file access");
            continue;
          }
          const response: CompanionWriteResponse = {
            protocolVersion: COMPANION_PROTOCOL_VERSION,
            requestId,
            status: "conflict",
            message: String(error),
            completedAt: new Date().toISOString(),
          };
          await this.writeReceipt(responsePath, response);
          this.retryState.delete(requestId);
          this.deferredRequests.delete(requestId);
        }
      }
      await this.refreshStatus(directories);
    } catch (error) {
      if (String(error).includes("Configure an absolute shared queue folder")) {
        this.status?.setText("Zotero Bridge: queue not configured");
        return;
      }
      if (isRetryableFileError(error)) {
        this.scheduleRetry("$queue");
        this.status?.setText("Zotero Bridge: waiting to retry queue access");
        return;
      }
      this.status?.setText("Zotero Bridge: queue error");
      new Notice(`Zotero Bridge queue error: ${String(error)}`);
    } finally {
      this.processing = false;
      if (this.unloading) await this.releaseQueueOwnership();
    }
  }

  private async claimQueueOwnership(): Promise<void> {
    const queueRoot = path.resolve(this.settings.queueDirectory);
    if (
      this.queueOwnership &&
      path.dirname(this.queueOwnership.lockPath) === queueRoot
    ) {
      return;
    }
    await this.releaseQueueOwnership();
    this.queueOwnership = await acquireQueueOwnership(
      queueRoot,
      this.settings.vaultId,
    );
  }

  private async releaseQueueOwnership(): Promise<void> {
    const ownership = this.queueOwnership;
    this.queueOwnership = null;
    if (ownership) await ownership.release();
  }

  private setStatus(message: string, detail = message): void {
    this.status?.setText(message);
    this.status?.setAttribute("title", detail);
    this.status?.setAttribute("aria-label", detail);
  }

  private async refreshStatus(
    directories: Awaited<ReturnType<typeof this.queuePaths>>,
  ): Promise<void> {
    const requestNames = (await fs.readdir(directories.requests)).filter(
      (name) => /^[0-9a-f-]{36}\.json$/i.test(name),
    );
    const responseNames = (await fs.readdir(directories.responses)).filter(
      (name) => /^[0-9a-f-]{36}\.json$/i.test(name),
    );
    const responseSet = new Set(responseNames);
    const pendingCount = requestNames.filter(
      (name) => !responseSet.has(name),
    ).length;
    const deferredCount = requestNames.filter((name) =>
      this.deferredRequests.has(name.slice(0, -5)),
    ).length;
    let conflictCount = 0;
    let conflictDetail = "";
    for (const name of responseNames) {
      try {
        const response = JSON.parse(
          await fs.readFile(path.join(directories.responses, name), "utf8"),
        ) as Partial<CompanionWriteResponse>;
        if (response.status === "conflict") {
          conflictCount += 1;
          conflictDetail ||=
            response.message || "A companion request conflicted.";
        }
      } catch {
        continue;
      }
    }
    if (conflictCount) {
      this.setStatus(
        `Zotero Bridge: conflict (${conflictCount})`,
        conflictDetail,
      );
    } else if (deferredCount) {
      this.setStatus(
        `Zotero Bridge: waiting for editor (${deferredCount})`,
        "Close the active Markdown note to let the pending source update continue.",
      );
    } else if (pendingCount > 0 && responseNames.length > 0) {
      this.setStatus(
        `Zotero Bridge: waiting (${pendingCount}), awaiting ACK (${responseNames.length})`,
      );
    } else if (responseNames.length > 0) {
      this.setStatus(
        `Zotero Bridge: awaiting Zotero acknowledgement (${responseNames.length})`,
      );
    } else if (pendingCount > 0) {
      this.setStatus(`Zotero Bridge: waiting (${pendingCount})`);
    } else {
      this.setStatus("Zotero Bridge: connected");
    }
  }

  private scheduleRetry(requestId: string): void {
    const attempts = (this.retryState.get(requestId)?.attempts ?? 0) + 1;
    this.retryState.set(requestId, {
      attempts,
      nextAttemptAt: Date.now() + retryDelayMs(attempts),
    });
  }

  private async applyRequest(request: CompanionWriteRequest): Promise<string> {
    try {
      assertCompanionVaultPairing(request.targetVaultId, this.settings.vaultId);
    } catch (error) {
      throw new WriteConflictError(String(error));
    }
    const relativePath = assertAllowedCompanionPath(
      request.relativePath,
      this.settings.outputFolder,
    );
    await this.assertVaultPathContained(relativePath);
    if (request.operation === "create-resource") {
      return this.applyResourceRequest(request, relativePath);
    }

    const nextIdentity = writeIdentity(request.content);
    if (
      nextIdentity.cardId !== request.cardId ||
      nextIdentity.sourceId !== request.sourceId
    ) {
      throw new WriteConflictError(
        "Request content identity does not match its envelope.",
      );
    }
    const existing = this.app.vault.getAbstractFileByPath(relativePath);
    if (request.operation === "create") {
      if (existing) {
        if (!(existing instanceof TFile)) {
          throw new WriteConflictError(
            "A folder already occupies the target path.",
          );
        }
        const current = await this.app.vault.read(existing);
        const identity = writeIdentity(current);
        if (
          identity.cardId !== request.cardId ||
          identity.sourceId !== request.sourceId ||
          current !== request.content
        ) {
          throw new WriteConflictError(
            "Target already exists with different content or identity.",
          );
        }
        return sha256(current);
      }
      await this.ensureFolder(path.posix.dirname(relativePath));
      await this.assertVaultPathContained(relativePath);
      const file = await this.app.vault.create(relativePath, request.content);
      return sha256(await this.app.vault.read(file));
    }

    if (!(existing instanceof TFile)) {
      throw new WriteConflictError("Target file is missing or is not a file.");
    }
    if (isInsideActiveEditor(this.app, relativePath)) {
      return "deferred";
    }

    const beforeWrite = await this.app.vault.read(existing);
    if (!existingMatchesRequest(beforeWrite, request)) {
      throw new WriteConflictError("Target identity changed.");
    }
    if (
      beforeWrite === request.content ||
      hasSameContentExceptUpdatedAt(beforeWrite, request.content)
    ) {
      return sha256(beforeWrite);
    }
    if (sha256(beforeWrite) !== request.baseRevision) {
      throw new WriteConflictError(
        "Base revision changed; user edits were preserved.",
      );
    }

    if (request.recoveryRelativePath && request.recoveryContent !== undefined) {
      const recoveryPath = assertAllowedCompanionPath(
        request.recoveryRelativePath,
        this.settings.outputFolder,
      );
      await this.assertVaultPathContained(recoveryPath);
      if (this.app.vault.getAbstractFileByPath(recoveryPath)) {
        const recoveryFile = this.app.vault.getAbstractFileByPath(recoveryPath);
        if (!(recoveryFile instanceof TFile)) {
          throw new WriteConflictError("Recovery path is not a file.");
        }
        if (
          (await this.app.vault.read(recoveryFile)) !== request.recoveryContent
        ) {
          throw new WriteConflictError(
            "Recovery file already contains different data.",
          );
        }
      } else {
        await this.ensureFolder(path.posix.dirname(recoveryPath));
        await this.assertVaultPathContained(recoveryPath);
        await this.app.vault.create(recoveryPath, request.recoveryContent);
      }
    }

    let newRevision = "";
    await this.app.vault.process(existing, (current) => {
      if (isInsideActiveEditor(this.app, relativePath)) {
        throw new DeferredWriteError("File became active in the editor.");
      }
      if (sha256(current) !== request.baseRevision) {
        throw new WriteConflictError(
          "Base revision changed; user edits were preserved.",
        );
      }
      if (!existingMatchesRequest(current, request)) {
        throw new WriteConflictError("Target identity changed.");
      }
      newRevision = sha256(request.content);
      return request.content;
    });
    if (!newRevision) return "deferred";
    return newRevision;
  }

  private async applyResourceRequest(
    request: Extract<CompanionWriteRequest, { operation: "create-resource" }>,
    relativePath: string,
  ): Promise<string> {
    const payloadPath = path.join(
      (await this.queuePaths()).payloads,
      `${request.requestId}.bin`,
    );
    const payload = await fs.readFile(payloadPath);
    if (
      payload.byteLength !== request.resourceSizeBytes ||
      payload.byteLength > MAX_COMPANION_RESOURCE_BYTES
    ) {
      throw new WriteConflictError("Image resource payload size is invalid.");
    }
    let format;
    try {
      format = detectImageFormat(
        new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength),
      );
      await assertImageDecodable(
        new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength),
        format,
        this.app.workspace.containerEl.ownerDocument.defaultView ?? undefined,
      );
    } catch (error) {
      throw new WriteConflictError(String(error));
    }
    const bytes = new Uint8Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength,
    );
    if (
      format.mimeType !== request.resourceMimeType ||
      !relativePath.endsWith(
        `-${request.resourceSha256}.${format.extension}`,
      ) ||
      sha256Bytes(bytes) !== request.resourceSha256
    ) {
      throw new WriteConflictError("Image resource content failed validation.");
    }

    const existing = this.app.vault.getAbstractFileByPath(relativePath);
    if (existing) {
      if (!(existing instanceof TFile)) {
        throw new WriteConflictError(
          "A folder occupies the image resource path.",
        );
      }
      const current = new Uint8Array(await this.app.vault.readBinary(existing));
      if (sha256Bytes(current) !== request.resourceSha256) {
        throw new WriteConflictError(
          "Image resource path already contains different data.",
        );
      }
      return request.resourceSha256;
    }

    await this.ensureFolder(path.posix.dirname(relativePath));
    await this.assertVaultPathContained(relativePath);
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    try {
      await this.app.vault.createBinary(relativePath, arrayBuffer);
    } catch (error) {
      const raced = this.app.vault.getAbstractFileByPath(relativePath);
      if (!(raced instanceof TFile)) throw error;
      const current = new Uint8Array(await this.app.vault.readBinary(raced));
      if (sha256Bytes(current) !== request.resourceSha256) throw error;
    }
    const written = this.app.vault.getAbstractFileByPath(relativePath);
    if (!(written instanceof TFile)) {
      throw new WriteConflictError(
        "Image resource was not created in the Vault.",
      );
    }
    const persisted = new Uint8Array(await this.app.vault.readBinary(written));
    if (sha256Bytes(persisted) !== request.resourceSha256) {
      throw new WriteConflictError(
        "Image resource verification failed after write.",
      );
    }
    return request.resourceSha256;
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    if (!folderPath || folderPath === ".") return;
    const existing: TAbstractFile | null =
      this.app.vault.getAbstractFileByPath(folderPath);
    if (existing instanceof TFolder) return;
    if (existing)
      throw new WriteConflictError("A file blocks the target folder.");
    const parent = path.posix.dirname(folderPath);
    if (parent !== folderPath && parent !== ".")
      await this.ensureFolder(parent);
    await this.app.vault.createFolder(folderPath);
  }

  private async writeReceipt(
    responsePath: string,
    response: CompanionWriteResponse,
  ): Promise<void> {
    const temporary = `${responsePath}.${response.requestId}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(response), { flag: "w" });
    await fs.rename(temporary, responsePath);
  }

  private async collectAcknowledged(
    directories: Awaited<ReturnType<typeof this.queuePaths>>,
  ): Promise<void> {
    for (const name of await fs.readdir(directories.acks)) {
      if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
      const requestId = name.slice(0, -5);
      try {
        validateCompanionAck(
          JSON.parse(
            await fs.readFile(path.join(directories.acks, name), "utf8"),
          ),
          requestId,
        );
      } catch {
        continue;
      }
      this.deferredRequests.delete(requestId);
      await Promise.all([
        fs.rm(path.join(directories.requests, name), { force: true }),
        fs.rm(path.join(directories.responses, name), { force: true }),
        fs.rm(path.join(directories.acks, name), { force: true }),
        fs.rm(path.join(directories.payloads, `${requestId}.bin`), {
          force: true,
        }),
      ]);
    }
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

class BridgeSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ZoteroObsidianBridgePlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Vault pairing ID")
      .setDesc("Enter this ID in the Zotero companion settings.")
      .addText((text) =>
        text.setValue(this.plugin.settings.vaultId).setDisabled(true),
      );
    new Setting(containerEl)
      .setName("Local request queue folder")
      .setDesc(
        "Use the same absolute folder configured in Zotero. Change it only while Zotero uses direct mode.",
      )
      .addText((text) => {
        text
          .setPlaceholder(
            "/Users/name/Library/Application Support/Zotero Bridge Queue",
          )
          .setValue(this.plugin.settings.queueDirectory);
        this.commitOnBlur(text, "queueDirectory");
      });
    new Setting(containerEl)
      .setName("Allowed output folder")
      .setDesc("Only writes below this Vault-relative folder are accepted.")
      .addText((text) => {
        text.setValue(this.plugin.settings.outputFolder);
        this.commitOnBlur(text, "outputFolder");
      });
    new Setting(containerEl)
      .setName("Vault access")
      .setDesc(
        "Create, read back, and remove a unique temporary Markdown file in the output folder.",
      )
      .addButton((button) =>
        button.setButtonText("Test Vault write access").onClick(async () => {
          try {
            await this.plugin.testVaultWriteAccess();
          } catch {
            // The Notice and heartbeat contain the actionable result.
          }
        }),
      );
  }

  private commitOnBlur(
    text: import("obsidian").TextComponent,
    key: "queueDirectory" | "outputFolder",
  ): void {
    const commit = async (): Promise<void> => {
      const previous = this.plugin.settings[key];
      const next = text.getValue().trim();
      if (next === previous) return;
      this.plugin.settings[key] = next;
      try {
        await this.plugin.saveSettings();
      } catch (error) {
        this.plugin.settings[key] = previous;
        new Notice(String(error));
        this.display();
      }
    };

    text.inputEl.addEventListener("blur", () => void commit());
    text.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") text.inputEl.blur();
    });
  }
}
