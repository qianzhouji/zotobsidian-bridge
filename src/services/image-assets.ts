import {
  detectImageFormat,
  assertImageDecodable,
  MAX_IMAGE_RESOURCE_BYTES,
  sha256Bytes,
  type ImageFormat,
} from "../core/image-resource.ts";
import { createExclusiveVaultBinary } from "../adapters/vault-storage.ts";

export interface ExportedImageAsset extends ImageFormat {
  sha256: string;
  bytes: Uint8Array;
  relativePath: string;
  markdownPath: string;
}

function safeImageKey(value: string): string {
  const key = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  if (!key) throw new Error("Image source has no safe Zotero key.");
  return key;
}

export async function writeImageAsset(
  rootPath: string,
  cardRelativePath: string,
  cardID: string,
  sourceID: string,
  sourceKey: string,
  bytes: Uint8Array,
): Promise<ExportedImageAsset> {
  const format = detectImageFormat(bytes);
  await assertImageDecodable(bytes, format, Zotero.getMainWindow());
  const sha256 = await sha256Bytes(bytes);
  const separator = cardRelativePath.lastIndexOf("/");
  const cardDirectory =
    separator < 0 ? "" : cardRelativePath.slice(0, separator);
  const filename = `${safeImageKey(sourceKey)}-${sha256}.${format.extension}`;
  const assetDirectory = cardDirectory ? `${cardDirectory}/assets` : "assets";
  const relativePath = `${assetDirectory}/${filename}`;
  await createExclusiveVaultBinary(rootPath, relativePath, bytes, {
    cardID,
    sourceID,
    mimeType: format.mimeType,
    sha256,
  });
  return {
    ...format,
    sha256,
    bytes,
    relativePath,
    markdownPath: `assets/${filename}`,
  };
}

export async function exportAnnotationImage(
  annotation: Zotero.Item,
  attachment: Zotero.Item,
  rootPath: string,
  cardRelativePath: string,
  cardID: string,
  sourceID: string,
): Promise<ExportedImageAsset | null> {
  if (
    !(
      annotation.annotationType === "image" ||
      annotation.annotationType === "ink"
    )
  ) {
    return null;
  }
  if (!(await Zotero.Annotations.hasCacheImage(annotation))) {
    await Zotero.PDFWorker.renderAttachmentAnnotations(attachment.id, true);
  }
  if (!(await Zotero.Annotations.hasCacheImage(annotation))) {
    throw new Error(
      `Zotero did not generate an image cache for ${annotation.annotationType} annotation ${annotation.key}.`,
    );
  }
  const cachePath = Zotero.Annotations.getCacheImagePath(annotation);
  const bytes = await IOUtils.read(cachePath);
  return writeImageAsset(
    rootPath,
    cardRelativePath,
    cardID,
    sourceID,
    annotation.key,
    bytes,
  );
}

export async function readZoteroAttachmentImage(
  attachment: Zotero.Item,
): Promise<Uint8Array> {
  const path = await attachment.getFilePathAsync();
  if (!path || typeof path !== "string") {
    throw new Error(
      `Zotero image attachment ${attachment.key} has no readable file.`,
    );
  }
  return IOUtils.read(path);
}

export function decodeImageDataURI(source: string): Uint8Array {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(
    source.trim(),
  );
  if (!match) throw new Error("Embedded image data URI is not valid base64.");
  const encoded = match[2].replace(/\s/g, "");
  if (encoded.length > Math.ceil(MAX_IMAGE_RESOURCE_BYTES / 3) * 4) {
    throw new Error("Embedded image data URI exceeds the 20 MiB export limit.");
  }
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
