import {
  createMarkdownWithFrontmatter,
  readFrontmatterValue,
} from "../core/markdown.ts";
import {
  noteSourceID,
  libraryIdentityKey,
  safePathSegment,
} from "../core/models.ts";
import {
  convertZoteroNoteHTML,
  formatZoteroNoteSourceBlock,
} from "../core/zotero-note-markdown.ts";
import {
  createExclusiveVaultFile,
  ensureVaultDirectory,
  findCardByFrontmatter,
  makeIndexEntry,
  readCardIndex,
  readVaultFile,
  writeCardIndex,
} from "../adapters/vault-storage.ts";
import {
  writeImageAsset,
  readZoteroAttachmentImage,
  decodeImageDataURI,
} from "./image-assets.ts";
import { updateCardSourceContent } from "./card-updater.ts";
import {
  enqueueCardOperation,
  getExistingCard,
  getIndexPath,
  getLibraryIdentity,
  getOutputFolder,
  getVaultPath,
  openCard,
  validateVault,
  zoteroLibraryPath,
} from "./annotation-card.ts";

export interface NativeNoteSnapshot {
  sourceID: string;
  noteKey: string;
  title: string;
  html: string;
  zoteroURI: string;
  identity: ReturnType<typeof getLibraryIdentity>;
  parentKey: string | null;
  parentTitle: string | null;
  markdown: string;
  sourceBlock: string;
  sourceHash: string;
  fields: Record<string, unknown>;
}

function resolveParentItem(note: Zotero.Item): Zotero.Item | null {
  const parent = note.parentItem;
  if (parent) return parent;
  if (note.parentItemID) return Zotero.Items.get(note.parentItemID);
  return null;
}

export async function snapshotNativeNote(
  note: Zotero.Item,
  imageTarget?: { relativePath: string; cardID: string },
): Promise<NativeNoteSnapshot> {
  if (!note.isNote() || note.deleted) {
    throw new Error("Select a saved Zotero note to import.");
  }
  const identity = getLibraryIdentity(note.libraryID);
  const title = note.getNoteTitle().trim() || "Untitled note";
  const html = note.getNote();
  const parent = resolveParentItem(note);
  const zoteroURI = `zotero://select/${zoteroLibraryPath(identity)}/items/${note.key}`;
  const sourceID = noteSourceID(identity, note.key);
  const imagePaths = new Map<string, string>();
  const imageHashes: string[] = [];
  if (imageTarget) {
    const document = new DOMParser().parseFromString(html, "text/html");
    const attachments = (
      await Promise.all(
        note.getAttachments().map((id) => Zotero.Items.getAsync(id)),
      )
    ).filter((item): item is Zotero.Item => Boolean(item));
    const attachmentByKey = new Map(
      attachments
        .filter((item) => item.isEmbeddedImageAttachment())
        .map((item) => [item.key, item]),
    );
    const imageNodes = Array.from(
      document.querySelectorAll("img"),
    ) as HTMLImageElement[];
    for (const [index, image] of imageNodes.entries()) {
      const source = image.getAttribute("src")?.trim() || "";
      const attachmentKey =
        image.getAttribute("data-attachment-key")?.trim() ||
        image.getAttribute("data-attachment")?.trim() ||
        [...attachmentByKey.keys()].find((key) => source.includes(key));
      let bytes: Uint8Array;
      let assetKey: string;
      if (attachmentKey && attachmentByKey.has(attachmentKey)) {
        const attachment = attachmentByKey.get(attachmentKey)!;
        bytes = await readZoteroAttachmentImage(attachment);
        assetKey = attachment.key;
      } else if (source.startsWith("data:image/")) {
        bytes = decodeImageDataURI(source);
        assetKey = `${note.key}-${index + 1}`;
      } else {
        continue;
      }
      const asset = await writeImageAsset(
        getVaultPath(),
        imageTarget.relativePath,
        imageTarget.cardID,
        sourceID,
        assetKey,
        bytes,
      );
      imageHashes.push(asset.sha256);
      const altKeys = [
        image.getAttribute("data-attachment-key")?.trim(),
        image.getAttribute("data-attachment")?.trim(),
        source,
        image.getAttribute("data-src")?.trim(),
        attachmentKey,
      ].filter((value): value is string => Boolean(value));
      for (const key of altKeys) imagePaths.set(key, asset.markdownPath);
    }
  }
  const conversion = convertZoteroNoteHTML(html, undefined, imagePaths);
  const fields = {
    bridge_source_status: "available",
    zotero_library: libraryIdentityKey(identity),
    zotero_library_id: identity.typeID,
    zotero_item_key: note.key,
    zotero_note_key: note.key,
    zotero_note_title: title,
    zotero_parent_item_key: parent?.key ?? null,
    zotero_parent_item_title: parent?.getField("title") || null,
    zotero_uri: zoteroURI,
  };
  const sourceBlock = formatZoteroNoteSourceBlock(title, zoteroURI, conversion);
  const hashValue = JSON.stringify({ fields, html, imageHashes });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(hashValue),
  );
  const sourceHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    sourceID,
    noteKey: note.key,
    title,
    html,
    zoteroURI,
    identity,
    parentKey: parent?.key ?? null,
    parentTitle: parent?.getField("title") || null,
    markdown: conversion.markdown,
    sourceBlock,
    sourceHash,
    fields: { ...fields, bridge_source_hash: sourceHash },
  };
}

function relativeNotePath(
  outputFolder: string,
  snapshot: NativeNoteSnapshot,
): string {
  const libraryKey = safePathSegment(
    libraryIdentityKey(snapshot.identity).replace(":", "-"),
    "library",
  );
  const itemKey = safePathSegment(snapshot.noteKey, "note");
  const fileName = `${safePathSegment(snapshot.title, "Untitled note")} (${itemKey}).md`;
  if (!snapshot.parentKey) {
    return `${outputFolder}/Standalone Notes (${libraryKey})/${fileName}`;
  }
  const parentFolder = `${safePathSegment(snapshot.parentTitle || "Untitled item", "Untitled item")} (${libraryKey}-${safePathSegment(snapshot.parentKey, "item")})`;
  return `${outputFolder}/${parentFolder}/Notes/${fileName}`;
}

function buildNativeNoteMarkdown(
  snapshot: NativeNoteSnapshot,
  cardID: string,
): string {
  return createMarkdownWithFrontmatter(
    {
      ...snapshot.fields,
      bridge_source_id: snapshot.sourceID,
      type: "zotero-note",
      bridge_schema: 1,
      bridge_card_id: cardID,
      bridge_updated_at: new Date().toISOString(),
      note_title: null,
    },
    `${snapshot.sourceBlock}\n## My notes\n\n`,
  );
}

async function createOrUpdateNativeNoteCard(
  note: Zotero.Item,
): Promise<string> {
  const rootPath = getVaultPath();
  const outputFolder = getOutputFolder();
  await validateVault(rootPath);
  let snapshot = await snapshotNativeNote(note);
  const indexPath = getIndexPath();
  const index = await readCardIndex(indexPath);
  const existing = await getExistingCard(
    rootPath,
    outputFolder,
    index,
    indexPath,
    snapshot.sourceID,
  );

  if (existing) {
    const snapshot = await snapshotNativeNote(note, {
      relativePath: existing.relativePath,
      cardID: existing.cardID,
    });
    const current = await readVaultFile(rootPath, existing.relativePath);
    if (current === null) throw new Error("The Zotero note card disappeared.");
    await updateCardSourceContent(
      rootPath,
      existing.relativePath,
      existing.cardID,
      snapshot.fields,
      snapshot.sourceBlock,
    );
    index.cards[snapshot.sourceID] = makeIndexEntry(
      existing.cardID,
      existing.relativePath,
    );
    delete index.suspendedCards[snapshot.sourceID];
    await writeCardIndex(indexPath, index);
    return existing.relativePath;
  }

  await ensureVaultDirectory(rootPath, outputFolder);
  let relativePath = relativeNotePath(outputFolder, snapshot);
  const cardID = crypto.randomUUID();
  snapshot = await snapshotNativeNote(note, { relativePath, cardID });
  relativePath = relativeNotePath(outputFolder, snapshot);
  await ensureVaultDirectory(
    rootPath,
    relativePath.split("/").slice(0, -1).join("/"),
  );
  try {
    await createExclusiveVaultFile(
      rootPath,
      relativePath,
      buildNativeNoteMarkdown(snapshot, cardID),
    );
  } catch (error) {
    const discovered = await findCardByFrontmatter(
      rootPath,
      outputFolder,
      "bridge_source_id",
      snapshot.sourceID,
    );
    if (!discovered) throw error;
    const markdown = await readVaultFile(rootPath, discovered);
    const existingID =
      markdown && readFrontmatterValue(markdown, "bridge_card_id");
    if (typeof existingID !== "string" || !existingID) throw error;
    index.cards[snapshot.sourceID] = makeIndexEntry(existingID, discovered);
    await writeCardIndex(indexPath, index);
    return discovered;
  }
  index.cards[snapshot.sourceID] = makeIndexEntry(cardID, relativePath);
  await writeCardIndex(indexPath, index);
  return relativePath;
}

export async function importNativeNote(note: Zotero.Item): Promise<void> {
  let relativePath = "";
  await enqueueCardOperation(async () => {
    relativePath = await createOrUpdateNativeNoteCard(note);
    await openCard(getVaultPath(), relativePath);
  });
}
