import { libraryIdentityKey, safePathSegment } from "../core/models.ts";
import type { AnnotationRecord, PaperRecord } from "../core/models.ts";
import { readFrontmatterValue } from "../core/markdown.ts";
import { moveVaultFile, readVaultFile } from "../adapters/vault-storage.ts";

export function relativePaperDirectory(
  outputFolder: string,
  paper: PaperRecord,
): string {
  const libraryKey = safePathSegment(
    libraryIdentityKey(paper.identity).replace(":", "-"),
    "library",
  );
  const itemKey = safePathSegment(paper.key, "item");
  const paperFolder = `${safePathSegment(paper.title, "Untitled paper")} (${libraryKey}-${itemKey})`;
  return `${outputFolder}/${paperFolder}`;
}

function pageOrdinal(pageIndex: number | null): string {
  return String(pageIndex === null ? 0 : pageIndex + 1).padStart(2, "0");
}

export async function annotationCardPath(
  vaultPath: string,
  outputFolder: string,
  paper: PaperRecord,
  annotation: AnnotationRecord,
  existingPath?: string,
  sourceID?: string,
): Promise<string> {
  const directory = `${relativePaperDirectory(outputFolder, paper)}/Annotations`;
  const pagePrefix = `P${pageOrdinal(annotation.pageIndex)}N`;
  for (let ordinal = 1; ordinal < 1_000_000; ordinal++) {
    const filename = `${pagePrefix}${String(ordinal).padStart(2, "0")}.md`;
    const candidate = `${directory}/${filename}`;
    if (candidate === existingPath) return candidate;
    const current = await readVaultFile(vaultPath, candidate);
    if (current === null) return candidate;
    if (
      sourceID &&
      readFrontmatterValue(current, "bridge_source_id") === sourceID
    ) {
      throw new Error(
        `Another card already uses the new page-numbered path: ${candidate}`,
      );
    }
  }
  throw new Error(
    `Could not allocate a card number on PDF page ${pageOrdinal(annotation.pageIndex)}.`,
  );
}

export async function migrateLegacyAnnotationCardPath(
  vaultPath: string,
  outputFolder: string,
  paper: PaperRecord,
  annotation: AnnotationRecord,
  currentPath: string,
  cardID: string,
  sourceID: string,
): Promise<string> {
  const legacyFilename = `${safePathSegment(annotation.key, "annotation")}.md`;
  if (currentPath.split("/").at(-1) !== legacyFilename) return currentPath;

  const numberedPath = await annotationCardPath(
    vaultPath,
    outputFolder,
    paper,
    annotation,
    currentPath,
    sourceID,
  );
  if (numberedPath === currentPath) return currentPath;

  await moveVaultFile(vaultPath, currentPath, numberedPath, cardID, sourceID);
  return numberedPath;
}
