import { readFrontmatterValue } from "../core/markdown.ts";
import { sha256Bytes } from "../core/image-resource.ts";
import type {
  CardIndex,
  CardIndexEntry,
  SyncTaskLog,
  SyncTaskStatus,
} from "../core/models.ts";
import {
  submitCompanionResource,
  submitCompanionWrite,
} from "./companion-queue.ts";
import {
  isValidCompanionVaultId,
  type CompanionImageMimeType,
} from "./companion-protocol.ts";

function normalize(path: string): string {
  return PathUtils.normalize(path);
}

let activeVaultWrites = 0;
const vaultWriteWaiters = new Set<() => void>();

function currentWriterMode(): "direct" | "companion" {
  const value = Zotero.Prefs.get(
    "extensions.zotero.zoteroobsidianbridge.writerMode",
    true,
  );
  if (value === "transition") {
    throw new Error(
      "Vault writer mode is changing; retry this operation shortly.",
    );
  }
  if (value === undefined || value === null || value === "direct") {
    return "direct";
  }
  if (value === "companion") return "companion";
  throw new Error("Unknown Vault writer mode; refusing to write.");
}

function trackVaultWrite<T>(operation: () => Promise<T>): Promise<T> {
  activeVaultWrites++;
  return operation().finally(() => {
    activeVaultWrites--;
    if (activeVaultWrites === 0) {
      for (const resolve of vaultWriteWaiters) resolve();
      vaultWriteWaiters.clear();
    }
  });
}

export async function waitForVaultWrites(): Promise<void> {
  if (activeVaultWrites === 0) return;
  await new Promise<void>((resolve) => vaultWriteWaiters.add(resolve));
}

function companionOutputFolder(): string {
  const value = Zotero.Prefs.get(
    "extensions.zotero.zoteroobsidianbridge.outputFolder",
    true,
  );
  const configured = typeof value === "string" ? value.trim() : "";
  const folder = configured || "Zotero Literature";
  const normalized = folder.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("The configured output folder is not a safe Vault path.");
  }
  return normalized;
}

function companionVaultId(): string {
  const value = Zotero.Prefs.get(
    "extensions.zotero.zoteroobsidianbridge.companionVaultId",
    true,
  );
  const vaultId = typeof value === "string" ? value.trim() : "";
  if (!isValidCompanionVaultId(vaultId)) {
    throw new Error("Enter the companion Vault ID shown in Obsidian settings.");
  }
  return vaultId;
}

function companionIdentity(contents: string): {
  cardId: string;
  sourceId: string;
} {
  const cardId =
    readFrontmatterValue(contents, "bridge_card_id") ??
    readFrontmatterValue(contents, "bridge_paper_id");
  const sourceId = readFrontmatterValue(contents, "bridge_source_id");
  if (
    typeof cardId !== "string" ||
    !cardId ||
    typeof sourceId !== "string" ||
    !sourceId
  ) {
    throw new Error(
      "Companion writes require registered bridge identity fields.",
    );
  }
  return { cardId, sourceId };
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function submitCompanionCreate(
  rootPath: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  resolveVaultPath(rootPath, relativePath);
  const identity = companionIdentity(contents);
  await submitCompanionWrite({
    operation: "create",
    ...identity,
    targetVaultId: companionVaultId(),
    outputFolder: companionOutputFolder(),
    relativePath,
    baseRevision: null,
    content: contents,
  });
}

function assertInside(rootPath: string, targetPath: string): void {
  const root = normalize(rootPath).replace(/[\\/]+$/, "");
  const target = targetPath;
  const separator = root.includes("\\") ? "\\" : "/";
  if (target !== root && !target.startsWith(`${root}${separator}`)) {
    throw new Error(
      "Refusing to access a path outside the configured Obsidian vault.",
    );
  }
}

export function resolveVaultPath(
  rootPath: string,
  relativePath: string,
): string {
  const normalizedRelative = relativePath.replace(/\\/g, "/");
  const parts = normalizedRelative.split("/");
  if (
    !normalizedRelative ||
    PathUtils.isAbsolute(relativePath) ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Vault paths must be normalized relative paths.");
  }
  const root = normalize(rootPath);
  const target = PathUtils.join(root, ...parts);
  assertInside(root, target);
  return target;
}

async function rejectSymlinkComponents(
  rootPath: string,
  relativePath: string,
): Promise<void> {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  const root = normalize(rootPath);
  let cursor = root;
  for (const part of parts) {
    cursor = PathUtils.join(cursor, part);
    assertInside(root, cursor);
    if (await IOUtils.exists(cursor)) {
      const file = Zotero.File.pathToFile(cursor);
      if (file.isSymlink()) {
        throw new Error(
          `Refusing to follow a symbolic link inside the vault: ${part}`,
        );
      }
    }
  }
}

export async function ensureVaultDirectory(
  rootPath: string,
  relativePath: string,
): Promise<string> {
  const target = resolveVaultPath(rootPath, relativePath);
  await rejectSymlinkComponents(rootPath, relativePath);
  if (await IOUtils.exists(target)) {
    if (!Zotero.File.pathToFile(target).isDirectory()) {
      throw new Error(`Vault path is not a directory: ${relativePath}`);
    }
    return target;
  }
  try {
    await IOUtils.makeDirectory(target, {
      createAncestors: true,
      ignoreExisting: true,
    });
  } catch (error) {
    if (
      !(await IOUtils.exists(target)) ||
      !Zotero.File.pathToFile(target).isDirectory()
    ) {
      throw error;
    }
  }
  return target;
}

export async function readVaultFile(
  rootPath: string,
  relativePath: string,
): Promise<string | null> {
  const path = resolveVaultPath(rootPath, relativePath);
  await rejectSymlinkComponents(rootPath, relativePath);
  if (!(await IOUtils.exists(path))) return null;
  return IOUtils.readUTF8(path);
}

export async function createExclusiveVaultFile(
  rootPath: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  return trackVaultWrite(async () => {
    if (currentWriterMode() === "companion") {
      await submitCompanionCreate(rootPath, relativePath, contents);
      return;
    }
    const path = resolveVaultPath(rootPath, relativePath);
    const parentPath = PathUtils.parent(path);
    if (!parentPath)
      throw new Error("Could not resolve the card's parent directory.");
    const parentRelative = relativePath.split("/").slice(0, -1).join("/");
    await ensureVaultDirectory(rootPath, parentRelative);
    await rejectSymlinkComponents(rootPath, relativePath);

    const temporaryPath = PathUtils.join(
      parentPath,
      `.zob-${crypto.randomUUID()}.tmp`,
    );
    try {
      await IOUtils.writeUTF8(temporaryPath, contents, {
        mode: "create",
        flush: true,
      });
      await IOUtils.move(temporaryPath, path, { noOverwrite: true });
    } catch (error) {
      await IOUtils.remove(temporaryPath, { ignoreAbsent: true }).catch(
        () => {},
      );
      if (await IOUtils.exists(path)) {
        throw new Error(
          `A file already exists at ${relativePath}; it was not overwritten.`,
        );
      }
      throw error;
    }
  });
}

export async function createExclusiveVaultBinary(
  rootPath: string,
  relativePath: string,
  bytes: Uint8Array,
  resource: {
    cardID: string;
    sourceID: string;
    mimeType: CompanionImageMimeType;
    sha256: string;
  },
): Promise<void> {
  return trackVaultWrite(async () => {
    const path = resolveVaultPath(rootPath, relativePath);
    await rejectSymlinkComponents(rootPath, relativePath);
    if (currentWriterMode() === "companion") {
      await submitCompanionResource({
        cardId: resource.cardID,
        sourceId: resource.sourceID,
        targetVaultId: companionVaultId(),
        outputFolder: companionOutputFolder(),
        relativePath,
        resourceMimeType: resource.mimeType,
        resourceSha256: resource.sha256,
        bytes,
      });
      return;
    }

    if (await IOUtils.exists(path)) {
      const current = await IOUtils.read(path);
      if ((await sha256Bytes(current)) === resource.sha256) return;
      throw new Error(
        `An image resource already exists with different content: ${relativePath}`,
      );
    }

    const parentRelative = relativePath.split("/").slice(0, -1).join("/");
    await ensureVaultDirectory(rootPath, parentRelative);
    await rejectSymlinkComponents(rootPath, relativePath);
    const temporaryPath = `${path}.zob-${crypto.randomUUID()}.tmp`;
    await IOUtils.write(temporaryPath, bytes, { mode: "create", flush: true });
    try {
      await IOUtils.move(temporaryPath, path, { noOverwrite: true });
    } catch (error) {
      await IOUtils.remove(temporaryPath, { ignoreAbsent: true }).catch(
        () => {},
      );
      if (await IOUtils.exists(path)) {
        const current = await IOUtils.read(path);
        if ((await sha256Bytes(current)) === resource.sha256) return;
        throw new Error(
          `An image resource already exists with different content: ${relativePath}`,
        );
      }
      throw error;
    }
  });
}

export async function writeAtomicVaultFile(
  rootPath: string,
  relativePath: string,
  expectedOriginal: string,
  contents: string,
  recoveryRelativePath: string,
): Promise<void> {
  return trackVaultWrite(async () => {
    if (currentWriterMode() === "companion") {
      const path = resolveVaultPath(rootPath, relativePath);
      await rejectSymlinkComponents(rootPath, relativePath);
      if (!(await IOUtils.exists(path))) {
        throw new Error(`Cannot update missing card: ${relativePath}`);
      }
      const current = await IOUtils.readUTF8(path);
      if (current !== expectedOriginal) {
        throw new Error(
          `Card changed before companion write; preserving the current version: ${relativePath}`,
        );
      }
      const identity = companionIdentity(contents);
      const recovery = resolveVaultPath(rootPath, recoveryRelativePath);
      const outputFolder = companionOutputFolder();
      const recoveryRelative = PathUtils.split(recovery)
        .slice(PathUtils.split(rootPath).length)
        .join("/");
      await submitCompanionWrite({
        operation: "replace",
        ...identity,
        targetVaultId: companionVaultId(),
        outputFolder,
        relativePath,
        baseRevision: await sha256Text(expectedOriginal),
        content: contents,
        recoveryRelativePath: recoveryRelative.replace(
          "/.bridge-recovery/",
          "/Bridge Recovery/",
        ),
        recoveryContent: expectedOriginal,
      });
      return;
    }
    const path = resolveVaultPath(rootPath, relativePath);
    const temporaryPath = `${path}.zob-${crypto.randomUUID()}.tmp`;
    const backupPath = resolveVaultPath(rootPath, recoveryRelativePath);
    await ensureVaultDirectory(
      rootPath,
      recoveryRelativePath.split("/").slice(0, -1).join("/"),
    );
    await rejectSymlinkComponents(rootPath, relativePath);
    if (!(await IOUtils.exists(path))) {
      throw new Error(`Cannot update missing card: ${relativePath}`);
    }
    const current = await IOUtils.readUTF8(path);
    if (current !== expectedOriginal) {
      throw new Error(
        `Card changed before direct write; preserving the current version: ${relativePath}`,
      );
    }
    try {
      await IOUtils.writeUTF8(path, contents, {
        mode: "overwrite",
        tmpPath: temporaryPath,
        backupFile: backupPath,
        flush: true,
      });
    } catch (error) {
      await IOUtils.remove(temporaryPath, { ignoreAbsent: true }).catch(
        () => {},
      );
      throw error;
    }
  });
}

export async function readCardIndex(path: string): Promise<CardIndex> {
  if (!(await IOUtils.exists(path))) {
    return { bridge_schema: 1, cards: {}, suspendedCards: {} };
  }
  const value = await IOUtils.readJSON(path);
  if (
    !value ||
    value.bridge_schema !== 1 ||
    !value.cards ||
    typeof value.cards !== "object" ||
    Array.isArray(value.cards)
  ) {
    throw new Error(
      "Card index is malformed or uses an unsupported schema; no data was reset.",
    );
  }
  for (const [sourceID, entry] of Object.entries(value.cards)) {
    const record = entry as Record<string, unknown> | null;
    if (
      !sourceID ||
      !record ||
      typeof record !== "object" ||
      typeof record.cardID !== "string" ||
      typeof record.relativePath !== "string" ||
      typeof record.updatedAt !== "string"
    ) {
      throw new Error(
        "Card index contains an invalid entry; no data was reset.",
      );
    }
  }
  const index = value as CardIndex;
  if (index.suspendedCards === undefined) index.suspendedCards = {};
  if (
    !index.suspendedCards ||
    typeof index.suspendedCards !== "object" ||
    Array.isArray(index.suspendedCards)
  ) {
    throw new Error("Card index contains an invalid suspended-card map.");
  }
  for (const [sourceID, entry] of Object.entries(index.suspendedCards)) {
    const record = entry as unknown as Record<string, unknown> | null;
    if (
      !sourceID ||
      !record ||
      typeof record.cardID !== "string" ||
      typeof record.relativePath !== "string" ||
      typeof record.suspendedAt !== "string" ||
      record.reason !== "missing"
    ) {
      throw new Error("Card index contains an invalid suspended-card entry.");
    }
  }
  return index;
}

export async function writeCardIndex(
  path: string,
  index: CardIndex,
): Promise<void> {
  const directory = PathUtils.parent(path);
  if (!directory) throw new Error("Could not resolve the index directory.");
  await IOUtils.makeDirectory(directory, {
    createAncestors: true,
    ignoreExisting: true,
  });
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
  const backupPath = `${path}.${crypto.randomUUID()}.bak`;
  await IOUtils.writeJSON(path, index, {
    mode: "overwrite",
    tmpPath: temporaryPath,
    backupFile: backupPath,
    flush: true,
  });
}

function validateSyncTaskLog(value: unknown): SyncTaskLog {
  if (
    !value ||
    typeof value !== "object" ||
    (value as SyncTaskLog).bridge_schema !== 1 ||
    !Array.isArray((value as SyncTaskLog).tasks)
  ) {
    throw new Error(
      "Sync task log is malformed or uses an unsupported schema.",
    );
  }
  const statuses: SyncTaskStatus[] = [
    "pending",
    "running",
    "done",
    "retry",
    "conflict",
  ];
  for (const task of (value as SyncTaskLog).tasks) {
    if (
      !task ||
      typeof task.id !== "string" ||
      typeof task.sourceID !== "string" ||
      !statuses.includes(task.status) ||
      !Number.isSafeInteger(task.attempts) ||
      task.attempts < 0 ||
      typeof task.updatedAt !== "string" ||
      (task.lastEvent !== undefined && typeof task.lastEvent !== "string") ||
      (task.lastError !== undefined && typeof task.lastError !== "string")
    ) {
      throw new Error("Sync task log contains an invalid task record.");
    }
  }
  return value as SyncTaskLog;
}

export async function readSyncTaskLog(path: string): Promise<SyncTaskLog> {
  if (!(await IOUtils.exists(path))) return { bridge_schema: 1, tasks: [] };
  return validateSyncTaskLog(await IOUtils.readJSON(path));
}

export async function writeSyncTaskLog(
  path: string,
  taskLog: SyncTaskLog,
): Promise<void> {
  validateSyncTaskLog(taskLog);
  const directory = PathUtils.parent(path);
  if (!directory) throw new Error("Could not resolve the sync task directory.");
  await IOUtils.makeDirectory(directory, {
    createAncestors: true,
    ignoreExisting: true,
  });
  await IOUtils.writeJSON(path, taskLog, {
    mode: "overwrite",
    tmpPath: `${path}.${crypto.randomUUID()}.tmp`,
    backupFile: `${path}.${crypto.randomUUID()}.bak`,
    flush: true,
  });
}

export async function findCardByFrontmatter(
  rootPath: string,
  outputRelativePath: string,
  field: "bridge_card_id" | "bridge_source_id",
  value: string,
): Promise<string | null> {
  const matches = await findMarkdownByFrontmatter(
    rootPath,
    outputRelativePath,
    {
      [field]: value,
    },
  );
  if (matches.length > 1) {
    throw new Error(
      `Multiple Markdown cards match ${field}=${value}: ${matches.join(", ")}. ` +
        "Resolve the duplicate identity before syncing. No card was selected.",
    );
  }
  return matches[0] ?? null;
}

export async function findMarkdownByFrontmatter(
  rootPath: string,
  outputRelativePath: string,
  expectedFields: Record<string, unknown>,
): Promise<string[]> {
  const root = resolveVaultPath(rootPath, outputRelativePath);
  if (!(await IOUtils.exists(root))) return [];
  if (Object.keys(expectedFields).length === 0) return [];

  const matches: string[] = [];

  const visit = async (directory: string): Promise<void> => {
    const folder = Zotero.File.pathToFile(directory);
    if (folder.isSymlink()) return;
    for (const entry of await IOUtils.getChildren(directory)) {
      const file = Zotero.File.pathToFile(entry);
      if (file.isSymlink()) continue;
      if (file.isDirectory()) {
        await visit(entry);
      } else if (entry.toLowerCase().endsWith(".md")) {
        const markdown = await IOUtils.readUTF8(entry);
        try {
          if (
            Object.entries(expectedFields).every(
              ([key, value]) => readFrontmatterValue(markdown, key) === value,
            )
          ) {
            matches.push(
              PathUtils.split(entry)
                .slice(PathUtils.split(rootPath).length)
                .join("/"),
            );
          }
        } catch {
          // An unrelated or damaged note cannot be trusted as an index hit.
        }
      }
    }
  };

  await visit(root);
  for (const relativePath of matches) {
    const fullPath = PathUtils.join(rootPath, ...relativePath.split("/"));
    assertInside(rootPath, fullPath);
  }
  return matches;
}

export async function indexMarkdownByFrontmatterField(
  rootPath: string,
  outputRelativePath: string,
  field: "bridge_card_id" | "bridge_source_id",
): Promise<Map<string, string[]>> {
  const root = resolveVaultPath(rootPath, outputRelativePath);
  const index = new Map<string, string[]>();
  if (!(await IOUtils.exists(root))) return index;
  const rootParts = PathUtils.split(rootPath);

  const visit = async (directory: string): Promise<void> => {
    const folder = Zotero.File.pathToFile(directory);
    if (folder.isSymlink()) return;
    for (const entry of await IOUtils.getChildren(directory)) {
      const file = Zotero.File.pathToFile(entry);
      if (file.isSymlink()) continue;
      if (file.isDirectory()) {
        await visit(entry);
      } else if (entry.toLowerCase().endsWith(".md")) {
        const markdown = await IOUtils.readUTF8(entry);
        let value: unknown;
        try {
          value = readFrontmatterValue(markdown, field);
        } catch {
          continue;
        }
        if (typeof value !== "string" || !value) continue;
        const relativePath = PathUtils.split(entry)
          .slice(rootParts.length)
          .join("/");
        const matches = index.get(value) ?? [];
        matches.push(relativePath);
        index.set(value, matches);
      }
    }
  };

  await visit(root);
  return index;
}

export async function listMarkdownFiles(
  rootPath: string,
  outputRelativePath: string,
): Promise<string[]> {
  const root = resolveVaultPath(rootPath, outputRelativePath);
  if (!(await IOUtils.exists(root))) return [];
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (Zotero.File.pathToFile(directory).isSymlink()) return;
    for (const entry of await IOUtils.getChildren(directory)) {
      const file = Zotero.File.pathToFile(entry);
      if (file.isSymlink()) continue;
      if (file.isDirectory()) {
        await visit(entry);
      } else if (entry.toLowerCase().endsWith(".md")) {
        files.push(
          PathUtils.split(entry)
            .slice(PathUtils.split(rootPath).length)
            .join("/"),
        );
      }
    }
  };
  await visit(root);
  return files;
}

export function makeIndexEntry(
  cardID: string,
  relativePath: string,
): CardIndexEntry {
  return { cardID, relativePath, updatedAt: new Date().toISOString() };
}
