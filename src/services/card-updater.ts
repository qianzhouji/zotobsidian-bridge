import {
  readFrontmatterValue,
  replacePaperSourceBlock,
  replaceSourceBlock,
  updateBridgeFrontmatter,
} from "../core/markdown.ts";
import {
  readVaultFile,
  writeAtomicVaultFile,
} from "../adapters/vault-storage.ts";
import {
  readUserNoteContent,
  replaceUserNoteContent,
  sameUserNoteContent,
} from "../core/note-content.ts";
import type { UserNoteContent } from "../core/note-content.ts";

const cardWriteTails = new Map<string, Promise<void>>();

function serializeCardWrite<T>(
  vaultPath: string,
  relativePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = `${vaultPath}\u0000${relativePath}`;
  const previous = cardWriteTails.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  cardWriteTails.set(key, tail);
  void tail.then(() => {
    if (cardWriteTails.get(key) === tail) cardWriteTails.delete(key);
  });
  return result;
}

export function updateCardSourceFields(
  vaultPath: string,
  relativePath: string,
  expectedCardID: string,
  sourceFields: Record<string, unknown>,
): Promise<void> {
  return serializeCardWrite(vaultPath, relativePath, async () => {
    const current = await readVaultFile(vaultPath, relativePath);
    if (current === null) throw new Error(`Card not found: ${relativePath}`);
    if (readFrontmatterValue(current, "bridge_card_id") !== expectedCardID) {
      throw new Error("Card identity changed; refusing to write to this file.");
    }

    const updated = updateBridgeFrontmatter(current, {
      ...sourceFields,
      bridge_updated_at: new Date().toISOString(),
    });
    await writeUpdatedCard(vaultPath, relativePath, current, updated);
  });
}

export function updateCardSourceContent(
  vaultPath: string,
  relativePath: string,
  expectedCardID: string,
  sourceFields: Record<string, unknown>,
  sourceBlock: string,
): Promise<boolean> {
  return serializeCardWrite(vaultPath, relativePath, async () => {
    const current = await readVaultFile(vaultPath, relativePath);
    if (current === null) throw new Error(`Card not found: ${relativePath}`);
    if (readFrontmatterValue(current, "bridge_card_id") !== expectedCardID) {
      throw new Error("Card identity changed; refusing to write to this file.");
    }

    const withSource = replaceSourceBlock(current, sourceBlock);
    const updated = updateBridgeFrontmatter(withSource, {
      ...sourceFields,
      bridge_updated_at: new Date().toISOString(),
    });
    if (updated === current) return false;
    await writeUpdatedCard(vaultPath, relativePath, current, updated);
    return true;
  });
}

export function updatePaperSource(
  vaultPath: string,
  relativePath: string,
  expectedLibrary: string,
  expectedItemKey: string,
  sourceFields: Record<string, unknown>,
  sourceBlock: string,
): Promise<boolean> {
  return serializeCardWrite(vaultPath, relativePath, async () => {
    const current = await readVaultFile(vaultPath, relativePath);
    if (current === null)
      throw new Error(`Paper note not found: ${relativePath}`);
    if (
      readFrontmatterValue(current, "zotero_library") !== expectedLibrary ||
      readFrontmatterValue(current, "zotero_item_key") !== expectedItemKey
    ) {
      throw new Error("Paper note identity changed; refusing to update it.");
    }

    let withSource = current;
    try {
      withSource = replacePaperSourceBlock(current, sourceBlock);
    } catch (error) {
      if (!String(error).includes("source section is missing or ambiguous")) {
        throw error;
      }
    }
    const updated = updateBridgeFrontmatter(withSource, {
      ...sourceFields,
      bridge_updated_at: new Date().toISOString(),
    });
    if (updated === current) return false;
    await writeUpdatedCard(vaultPath, relativePath, current, updated);
    return true;
  });
}

export class UserContentConflictError extends Error {
  public readonly current: UserNoteContent;

  constructor(current: UserNoteContent) {
    super(
      "The note changed outside Zotero; review both versions before saving.",
    );
    this.name = "UserContentConflictError";
    this.current = current;
  }
}

export function updateCardUserContent(
  vaultPath: string,
  relativePath: string,
  expectedCardID: string,
  baseline: UserNoteContent,
  next: UserNoteContent,
  force = false,
): Promise<boolean> {
  return serializeCardWrite(vaultPath, relativePath, async () => {
    const current = await readVaultFile(vaultPath, relativePath);
    if (current === null) throw new Error(`Card not found: ${relativePath}`);
    if (readFrontmatterValue(current, "bridge_card_id") !== expectedCardID) {
      throw new Error("Card identity changed; refusing to write to this file.");
    }

    const currentContent = readUserNoteContent(current);
    const normalizedNext = { ...next, title: next.title.trim() };
    if (
      !force &&
      !sameUserNoteContent(currentContent, baseline) &&
      !sameUserNoteContent(currentContent, normalizedNext)
    ) {
      throw new UserContentConflictError(currentContent);
    }
    if (sameUserNoteContent(currentContent, normalizedNext)) return false;

    const updated = replaceUserNoteContent(current, normalizedNext);
    await writeUpdatedCard(vaultPath, relativePath, current, updated);
    return true;
  });
}

async function writeUpdatedCard(
  vaultPath: string,
  relativePath: string,
  expectedOriginal: string,
  updated: string,
): Promise<void> {
  const directory = relativePath.split("/").slice(0, -1).join("/");
  const name = relativePath.split("/").at(-1);
  if (!name) throw new Error("Card path has no file name.");
  const recoveryPath = `${directory}/.bridge-recovery/${name}.${Date.now()}.${crypto.randomUUID()}.bak`;
  await writeAtomicVaultFile(
    vaultPath,
    relativePath,
    expectedOriginal,
    updated,
    recoveryPath,
  );
}
