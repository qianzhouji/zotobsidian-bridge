import {
  createMarkdownWithFrontmatter,
  formatSourceBlock,
  formatPaperSourceBlock,
  readFrontmatterValue,
} from "../core/markdown.ts";
import {
  annotationSourceID,
  libraryIdentityKey,
  safePathSegment,
  validateVaultRelativePath,
} from "../core/models.ts";
import {
  createCancellationController,
  type CancellationController,
} from "../core/cancellation.ts";
import type {
  AnnotationRecord,
  CardIndex,
  CardRecord,
  LibraryIdentity,
  PaperRecord,
} from "../core/models.ts";
import {
  openAnnotationBatchProgress,
  type AnnotationBatchProgress,
} from "./annotation-batch-progress.ts";
import {
  createExclusiveVaultFile,
  ensureVaultDirectory,
  findCardByFrontmatter,
  indexMarkdownByFrontmatterField,
  makeIndexEntry,
  readCardIndex,
  readVaultFile,
  resolveVaultPath,
  writeCardIndex,
} from "../adapters/vault-storage.ts";
import { exportAnnotationImage } from "./image-assets.ts";
import { updateCardSourceContent } from "./card-updater.ts";
import { CompanionPendingError } from "../adapters/companion-queue.ts";
import { showPendingCompanionRequest } from "./companion-pending-window.ts";

type AnnotationPayload = Partial<_ZoteroTypes.Annotations.AnnotationJson> & {
  id?: string;
};

const prefPrefix = "extensions.zotero.zoteroobsidianbridge";
const defaultOutputFolder = "Zotero Literature";
const createLocks = new Map<string, Promise<void>>();
let cardOperationQueue: Promise<void> = Promise.resolve();
let activeBatchController: CancellationController | null = null;
const cardIndexCheckpointInterval = 25;

interface BatchCardIndexContext {
  index: CardIndex;
  discoveredSources: Map<string, string[]>;
  pendingChanges: number;
  dirty: boolean;
}

async function writeBatchCardIndex(
  indexPath: string,
  index: CardIndex,
): Promise<void> {
  try {
    await writeCardIndex(indexPath, index);
  } catch (firstError) {
    try {
      await writeCardIndex(indexPath, index);
    } catch {
      throw firstError;
    }
  }
}

async function persistCardIndexChange(
  indexPath: string,
  index: CardIndex,
  batchContext?: BatchCardIndexContext,
): Promise<void> {
  if (!batchContext) {
    await writeCardIndex(indexPath, index);
    return;
  }

  batchContext.dirty = true;
  batchContext.pendingChanges++;
  if (batchContext.pendingChanges >= cardIndexCheckpointInterval) {
    await writeBatchCardIndex(indexPath, index);
    batchContext.dirty = false;
    batchContext.pendingChanges = 0;
  }
}

export function cancelAnnotationBatch(): boolean {
  if (!activeBatchController || activeBatchController.signal.aborted) {
    return false;
  }
  activeBatchController.abort();
  return true;
}

export function getPreference(name: string): string {
  const value = Zotero.Prefs.get(`${prefPrefix}.${name}`, true);
  return typeof value === "string" ? value.trim() : "";
}

export function getVaultPath(): string {
  const path = getPreference("vaultPath");
  return path && PathUtils.isAbsolute(path) ? PathUtils.normalize(path) : path;
}

export function enqueueCardOperation(
  operation: () => Promise<void>,
): Promise<void> {
  const pending = cardOperationQueue.then(operation, operation);
  cardOperationQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

export function getOutputFolder(): string {
  return validateVaultRelativePath(
    getPreference("outputFolder") || defaultOutputFolder,
  );
}

export async function validateVault(vaultPath: string): Promise<void> {
  if (!vaultPath || !PathUtils.isAbsolute(vaultPath)) {
    throw new Error("Choose an absolute path to an existing Obsidian vault.");
  }
  const vault = Zotero.File.pathToFile(vaultPath);
  if (!vault.exists() || !vault.isDirectory()) {
    throw new Error("The configured Obsidian vault folder does not exist.");
  }
  if (!vault.isWritable()) {
    throw new Error("The configured Obsidian vault is not writable.");
  }
  const vaultMarker = PathUtils.join(vaultPath, ".obsidian");
  if (!(await IOUtils.exists(vaultMarker))) {
    throw new Error(
      "The selected folder does not contain an .obsidian vault marker.",
    );
  }
  if (!Zotero.File.pathToFile(vaultMarker).isDirectory()) {
    throw new Error("The .obsidian vault marker is not a folder.");
  }
}

export function getIndexPath(): string {
  const dataDirectory = Zotero.DataDirectory.dir;
  if (!dataDirectory || !PathUtils.isAbsolute(dataDirectory)) {
    throw new Error(
      "Zotero's data directory is unavailable; card index was not written.",
    );
  }
  return PathUtils.join(
    dataDirectory,
    "storage",
    "zotero-obsidian-bridge",
    "cards.json",
  );
}

export function getLibraryIdentity(libraryID: number): LibraryIdentity {
  const library = Zotero.Libraries.get(libraryID);
  if (!library) throw new Error(`Zotero library ${libraryID} was not found.`);
  if (!(["user", "group", "feed"] as string[]).includes(library.libraryType)) {
    throw new Error(`Unsupported Zotero library type: ${library.libraryType}`);
  }
  return {
    type: library.libraryType,
    typeID: library.libraryTypeID,
  };
}

export function zoteroLibraryPath(identity: LibraryIdentity): string {
  return identity.type === "group"
    ? `groups/${identity.typeID}`
    : identity.type === "feed"
      ? `feeds/${identity.typeID}`
      : "library";
}

function parsePageIndex(annotation: Zotero.Item): number | null {
  try {
    const position = JSON.parse(annotation.annotationPosition);
    const pageIndex = Number(position?.pageIndex);
    return Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : null;
  } catch {
    return null;
  }
}

function identifiersMatch(
  item: Zotero.Item,
  identifiers: Set<string>,
): boolean {
  return [
    String(item.id),
    item.key,
    `${item.libraryID}/${item.key}`,
    `${item.libraryID}_${item.key}`,
  ].some((identifier) => identifiers.has(identifier));
}

async function resolveAnnotation(
  reader: _ZoteroTypes.ReaderInstance,
  payload: AnnotationPayload,
  selectedIDs: string[] = [],
): Promise<Zotero.Item | null> {
  if (payload.key && Number.isInteger(payload.libraryID)) {
    const byKey = await Zotero.Items.getByLibraryAndKeyAsync(
      payload.libraryID!,
      payload.key,
    );
    if (byKey && byKey.isAnnotation()) return byKey;
  }

  if (!reader.itemID) return null;
  const attachment = await Zotero.Items.getAsync(reader.itemID);
  const identifiers = new Set(
    [...selectedIDs, payload.id, payload.key].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
  );
  return (
    attachment
      .getAnnotations()
      .find((item) => identifiersMatch(item, identifiers)) ?? null
  );
}

async function resolveSelectedAnnotations(
  reader: _ZoteroTypes.ReaderInstance,
  payload: AnnotationPayload,
  selectedIDs: string[],
): Promise<{ annotations: Zotero.Item[]; requestedCount: number }> {
  if (!reader.itemID) {
    throw new Error(
      "Could not resolve the PDF attachment for selected annotations.",
    );
  }
  const attachment = await Zotero.Items.getAsync(reader.itemID);
  if (!attachment || !attachment.isAttachment()) {
    throw new Error(
      "Could not resolve the PDF attachment for selected annotations.",
    );
  }

  const rawIdentifiers = [...selectedIDs, payload.id].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (rawIdentifiers.length === 0 && payload.key) {
    rawIdentifiers.push(payload.key);
  }
  const identifiers = [...new Set(rawIdentifiers)];
  const savedAnnotations = attachment.getAnnotations(false);
  const annotations: Zotero.Item[] = [];
  const seen = new Set<string>();
  for (const identifier of identifiers) {
    const annotation = savedAnnotations.find((item) =>
      identifiersMatch(item, new Set([identifier])),
    );
    if (!annotation) continue;
    const identity = `${annotation.libraryID}/${annotation.key}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    annotations.push(annotation);
  }

  return { annotations, requestedCount: identifiers.length };
}

async function resolveAllSavedAnnotations(
  reader: _ZoteroTypes.ReaderInstance,
): Promise<Zotero.Item[]> {
  if (!reader.itemID) {
    throw new Error("Could not resolve the PDF attachment for this reader.");
  }
  const attachment = await Zotero.Items.getAsync(reader.itemID);
  if (!attachment || !attachment.isAttachment()) {
    throw new Error("Could not resolve the PDF attachment for this reader.");
  }
  return attachment
    .getAnnotations(false)
    .filter((annotation) => annotation.isAnnotation() && !annotation.deleted);
}

function paperRecord(
  attachment: Zotero.Item,
  parent: Zotero.Item | null,
  identity: LibraryIdentity,
): PaperRecord {
  const zoteroPath = zoteroLibraryPath(identity);
  const item = parent ?? attachment;
  return {
    identity,
    key: item.key,
    title: item.getField("title") || "Untitled paper",
    creator: parent?.getField("firstCreator") || "",
    date: parent?.getField("date") || "",
    publication: parent?.getField("publicationTitle") || "",
    doi: parent?.getField("DOI") || "",
    zoteroURI: `zotero://select/${zoteroPath}/items/${item.key}`,
  };
}

function annotationRecord(
  annotation: Zotero.Item,
  attachment: Zotero.Item,
  identity: LibraryIdentity,
): AnnotationRecord {
  const pageIndex = parsePageIndex(annotation);
  const pageQuery = pageIndex === null ? "" : `?page=${pageIndex + 1}`;
  return {
    identity,
    key: annotation.key,
    attachmentKey: attachment.key,
    pageIndex,
    pageLabel: annotation.annotationPageLabel,
    color: annotation.annotationColor,
    text: annotation.annotationText,
    comment: annotation.annotationComment,
    zoteroURI: `zotero://open-pdf/${zoteroLibraryPath(identity)}/items/${attachment.key}${pageQuery}`,
  };
}

function annotationSourceFields(
  paper: PaperRecord,
  annotation: AnnotationRecord,
  sourceHash: string,
): Record<string, unknown> {
  return {
    bridge_source_status: "available",
    bridge_source_missing_at: null,
    bridge_source_missing_reason: null,
    bridge_source_hash: sourceHash,
    zotero_library: libraryIdentityKey(annotation.identity),
    zotero_library_id: annotation.identity.typeID,
    zotero_paper_key: paper.key,
    zotero_paper_title: paper.title,
    zotero_creator: paper.creator || null,
    zotero_date: paper.date || null,
    zotero_publication: paper.publication || null,
    zotero_doi: paper.doi || null,
    zotero_attachment_key: annotation.attachmentKey,
    zotero_annotation_key: annotation.key,
    zotero_page_index: annotation.pageIndex,
    zotero_page_label: annotation.pageLabel || null,
    zotero_annotation_color: annotation.color || null,
    zotero_uri: annotation.zoteroURI,
  };
}

async function annotationSourceHash(
  paper: PaperRecord,
  annotation: AnnotationRecord,
  imageHash: string | null,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ paper, annotation, imageHash })),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildAnnotationSourceBlock(
  annotation: AnnotationRecord,
  imagePath?: string,
): string {
  return formatSourceBlock(
    annotation.text,
    annotation.comment,
    annotation.pageLabel ? `Page ${annotation.pageLabel}` : "Annotation",
    annotation.zoteroURI,
    annotation.color,
    imagePath ? `![Zotero annotation image](${imagePath})` : "",
  );
}

function buildCardMarkdown(
  card: CardRecord,
  sourceHash: string,
  imagePath?: string,
): string {
  const { paper, annotation } = card;
  const sourceBlock = buildAnnotationSourceBlock(annotation, imagePath);
  return createMarkdownWithFrontmatter(
    {
      type: "zotero-annotation",
      bridge_schema: 1,
      bridge_card_id: card.id,
      bridge_source_id: card.sourceID,
      bridge_source_hash: sourceHash,
      bridge_source_status: "available",
      bridge_updated_at: new Date().toISOString(),
      zotero_library: libraryIdentityKey(annotation.identity),
      zotero_library_id: annotation.identity.typeID,
      zotero_paper_key: paper.key,
      zotero_paper_title: paper.title,
      zotero_creator: paper.creator || null,
      zotero_date: paper.date || null,
      zotero_publication: paper.publication || null,
      zotero_doi: paper.doi || null,
      zotero_attachment_key: annotation.attachmentKey,
      zotero_annotation_key: annotation.key,
      zotero_page_index: annotation.pageIndex,
      zotero_page_label: annotation.pageLabel || null,
      zotero_annotation_color: annotation.color || null,
      zotero_uri: annotation.zoteroURI,
      note_title: null,
    },
    `${sourceBlock}\n## My notes\n\n`,
  );
}

function buildPaperMarkdown(paper: PaperRecord): string {
  const sourceID = `${libraryIdentityKey(paper.identity)}/paper/${paper.key}`;
  return createMarkdownWithFrontmatter(
    {
      type: "zotero-paper",
      bridge_schema: 1,
      bridge_paper_id: sourceID,
      bridge_source_id: sourceID,
      zotero_library: libraryIdentityKey(paper.identity),
      zotero_library_id: paper.identity.typeID,
      zotero_item_key: paper.key,
      zotero_title: paper.title,
      zotero_creator: paper.creator || null,
      zotero_date: paper.date || null,
      zotero_publication: paper.publication || null,
      zotero_doi: paper.doi || null,
      zotero_uri: paper.zoteroURI,
    },
    `${formatPaperSourceBlock(paper.title, paper.zoteroURI)}\n## Reading notes\n\n`,
  );
}

function relativePaperDirectory(
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

function assertMatchingCard(
  markdown: string,
  cardID: string,
  sourceID: string,
): void {
  if (
    readFrontmatterValue(markdown, "bridge_card_id") !== cardID ||
    readFrontmatterValue(markdown, "bridge_source_id") !== sourceID
  ) {
    throw new Error(
      "The saved card's identity does not match Zotero. It was left untouched; resolve the file conflict before retrying.",
    );
  }
}

export async function openCard(
  vaultPath: string,
  relativePath: string,
): Promise<void> {
  const filePath = resolveVaultPath(vaultPath, relativePath);
  Zotero.launchURL(`obsidian://open?path=${encodeURIComponent(filePath)}`);
}

export async function getExistingCard(
  vaultPath: string,
  outputFolder: string,
  index: CardIndex,
  indexPath: string,
  sourceID: string,
  batchContext?: BatchCardIndexContext,
): Promise<{ cardID: string; relativePath: string } | null> {
  const discoveredPaths = batchContext?.discoveredSources.get(sourceID) ?? [];
  if (discoveredPaths.length > 1) {
    throw new Error(
      `Multiple Markdown cards match bridge_source_id=${sourceID}: ${discoveredPaths.join(", ")}. ` +
        "Resolve the duplicate identity before syncing. No card was selected.",
    );
  }

  const suspended = index.suspendedCards[sourceID];
  if (suspended) {
    const restored = await findCardByFrontmatter(
      vaultPath,
      outputFolder,
      "bridge_card_id",
      suspended.cardID,
    );
    if (!restored) {
      throw new Error(
        "This card is suspended because it was missing from the output folder. Restore it there to resume; it will not be recreated automatically.",
      );
    }
    const contents = await readVaultFile(vaultPath, restored);
    if (contents === null)
      throw new Error("Restored card disappeared during lookup.");
    assertMatchingCard(contents, suspended.cardID, sourceID);
    delete index.suspendedCards[sourceID];
    index.cards[sourceID] = makeIndexEntry(suspended.cardID, restored);
    return { cardID: suspended.cardID, relativePath: restored };
  }

  const indexed = index.cards[sourceID];
  if (indexed) {
    const indexedContents = await readVaultFile(
      vaultPath,
      indexed.relativePath,
    );
    if (indexedContents !== null) {
      assertMatchingCard(indexedContents, indexed.cardID, sourceID);
      return { cardID: indexed.cardID, relativePath: indexed.relativePath };
    }

    const moved = await findCardByFrontmatter(
      vaultPath,
      outputFolder,
      "bridge_card_id",
      indexed.cardID,
    );
    if (moved) {
      const contents = await readVaultFile(vaultPath, moved);
      if (contents === null)
        throw new Error("Moved card disappeared during lookup.");
      assertMatchingCard(contents, indexed.cardID, sourceID);
      index.cards[sourceID] = { ...indexed, relativePath: moved };
      return { cardID: indexed.cardID, relativePath: moved };
    }
    index.suspendedCards[sourceID] = {
      cardID: indexed.cardID,
      relativePath: indexed.relativePath,
      suspendedAt: new Date().toISOString(),
      reason: "missing",
    };
    delete index.cards[sourceID];
    await persistCardIndexChange(indexPath, index, batchContext);
    throw new Error(
      "The linked card is missing from the configured output folder. It was suspended instead of being recreated; restore or move it back, then retry.",
    );
  }

  const discovered = batchContext
    ? (discoveredPaths[0] ?? null)
    : await findCardByFrontmatter(
        vaultPath,
        outputFolder,
        "bridge_source_id",
        sourceID,
      );
  if (!discovered) return null;
  const contents = await readVaultFile(vaultPath, discovered);
  if (contents === null)
    throw new Error("Discovered card disappeared during lookup.");
  const cardID = readFrontmatterValue(contents, "bridge_card_id");
  if (typeof cardID !== "string" || !cardID) {
    throw new Error(
      "Matching card has no valid bridge_card_id; no duplicate was created.",
    );
  }
  assertMatchingCard(contents, cardID, sourceID);
  index.cards[sourceID] = makeIndexEntry(cardID, discovered);
  batchContext?.discoveredSources.set(sourceID, [discovered]);
  return { cardID, relativePath: discovered };
}

async function createOrOpenCard(
  annotation: Zotero.Item,
  batchContext?: BatchCardIndexContext,
): Promise<string> {
  const vaultPath = getVaultPath();
  const outputFolder = getOutputFolder();
  await validateVault(vaultPath);

  const attachment = annotation.parentItem;
  if (!attachment || !attachment.isAttachment()) {
    throw new Error("Could not resolve the annotation's PDF attachment.");
  }
  const parent = attachment.parentItemID
    ? await Zotero.Items.getAsync(attachment.parentItemID)
    : null;
  const identity = getLibraryIdentity(annotation.libraryID);
  const paper = paperRecord(attachment, parent, identity);
  const sourceAnnotation = annotationRecord(annotation, attachment, identity);
  const sourceID = annotationSourceID(identity, annotation.key);
  const indexPath = getIndexPath();
  const index = batchContext?.index ?? (await readCardIndex(indexPath));

  const existing = await getExistingCard(
    vaultPath,
    outputFolder,
    index,
    indexPath,
    sourceID,
    batchContext,
  );
  if (existing) {
    const image = await exportAnnotationImage(
      annotation,
      attachment,
      vaultPath,
      existing.relativePath,
      existing.cardID,
      sourceID,
    );
    const sourceHash = await annotationSourceHash(
      paper,
      sourceAnnotation,
      image?.sha256 ?? null,
    );
    await updateCardSourceContent(
      vaultPath,
      existing.relativePath,
      existing.cardID,
      annotationSourceFields(paper, sourceAnnotation, sourceHash),
      buildAnnotationSourceBlock(sourceAnnotation, image?.markdownPath),
    );
    index.cards[sourceID] = makeIndexEntry(
      existing.cardID,
      existing.relativePath,
    );
    await persistCardIndexChange(indexPath, index, batchContext);
    return existing.relativePath;
  }

  await ensureVaultDirectory(vaultPath, outputFolder);
  const paperDirectory = relativePaperDirectory(outputFolder, paper);
  await ensureVaultDirectory(vaultPath, `${paperDirectory}/Annotations`);
  const paperRelativePath = `${paperDirectory}/Paper.md`;
  const existingPaper = await readVaultFile(vaultPath, paperRelativePath);
  if (existingPaper === null) {
    try {
      await createExclusiveVaultFile(
        vaultPath,
        paperRelativePath,
        buildPaperMarkdown(paper),
      );
    } catch (error) {
      if ((await readVaultFile(vaultPath, paperRelativePath)) === null)
        throw error;
    }
  }

  const cardID = crypto.randomUUID();
  const relativePath = `${paperDirectory}/Annotations/${safePathSegment(annotation.key, "annotation")}.md`;
  const card: CardRecord = {
    id: cardID,
    sourceID,
    relativePath,
    paper,
    annotation: sourceAnnotation,
  };
  const image = await exportAnnotationImage(
    annotation,
    attachment,
    vaultPath,
    relativePath,
    cardID,
    sourceID,
  );
  const sourceHash = await annotationSourceHash(
    paper,
    sourceAnnotation,
    image?.sha256 ?? null,
  );

  try {
    await createExclusiveVaultFile(
      vaultPath,
      relativePath,
      buildCardMarkdown(card, sourceHash, image?.markdownPath),
    );
  } catch (error) {
    const discovered = await findCardByFrontmatter(
      vaultPath,
      outputFolder,
      "bridge_source_id",
      sourceID,
    );
    if (!discovered) throw error;
    const contents = await readVaultFile(vaultPath, discovered);
    if (contents === null) throw error;
    const existingID = readFrontmatterValue(contents, "bridge_card_id");
    if (typeof existingID !== "string" || !existingID) throw error;
    assertMatchingCard(contents, existingID, sourceID);
    index.cards[sourceID] = makeIndexEntry(existingID, discovered);
    batchContext?.discoveredSources.set(sourceID, [discovered]);
    await persistCardIndexChange(indexPath, index, batchContext);
    return discovered;
  }

  index.cards[sourceID] = makeIndexEntry(cardID, relativePath);
  batchContext?.discoveredSources.set(sourceID, [relativePath]);
  await persistCardIndexChange(indexPath, index, batchContext);
  return relativePath;
}

export async function ensureAnnotationCardItem(
  annotation: Zotero.Item,
): Promise<string> {
  if (!annotation.isAnnotation() || annotation.deleted) {
    throw new Error("The Zotero item is not a saved annotation.");
  }
  let relativePath = "";
  await enqueueCardOperation(async () => {
    relativePath = await createOrOpenCard(annotation);
  });
  return relativePath;
}

export interface AnnotationCardReference {
  cardID: string;
  sourceID: string;
  vaultPath: string;
  relativePath: string;
  absolutePath: string;
  paperTitle: string;
  paperCreator: string;
  zoteroURI: string;
}

export async function ensureCardForAnnotation(
  reader: _ZoteroTypes.ReaderInstance,
  payload: AnnotationPayload,
): Promise<AnnotationCardReference> {
  let reference: AnnotationCardReference | null = null;
  await enqueueCardOperation(async () => {
    const annotation = await resolveAnnotation(reader, payload);
    if (!annotation) {
      throw new Error(
        "No saved annotation was found. Save the highlight in Zotero first.",
      );
    }
    const vaultPath = getVaultPath();
    const attachment = annotation.parentItem;
    if (!attachment || !attachment.isAttachment()) {
      throw new Error("Could not resolve the annotation's PDF attachment.");
    }
    const identity = getLibraryIdentity(annotation.libraryID);
    const paper = paperRecord(
      attachment,
      attachment.parentItemID
        ? await Zotero.Items.getAsync(attachment.parentItemID)
        : null,
      identity,
    );
    const sourceAnnotation = annotationRecord(annotation, attachment, identity);
    const sourceID = annotationSourceID(identity, annotation.key);

    let relativePath: string;
    try {
      relativePath = await createOrOpenCard(annotation);
    } catch (error) {
      if (!vaultPath || !PathUtils.isAbsolute(vaultPath)) throw error;
      const vaultDirectory = Zotero.File.pathToFile(vaultPath);
      if (
        vaultDirectory.exists() &&
        vaultDirectory.isDirectory() &&
        vaultDirectory.isWritable()
      ) {
        throw error;
      }

      const index = await readCardIndex(getIndexPath());
      const indexed = index.cards[sourceID] ?? index.suspendedCards[sourceID];
      if (!indexed) throw error;
      reference = {
        cardID: indexed.cardID,
        sourceID,
        vaultPath,
        relativePath: indexed.relativePath,
        absolutePath: resolveVaultPath(vaultPath, indexed.relativePath),
        paperTitle: paper.title,
        paperCreator: paper.creator,
        zoteroURI: sourceAnnotation.zoteroURI,
      };
      return;
    }

    const markdown = await readVaultFile(vaultPath, relativePath);
    if (markdown === null) {
      throw new Error("The annotation card disappeared after creation.");
    }
    const cardID = readFrontmatterValue(markdown, "bridge_card_id");
    const cardSourceID = readFrontmatterValue(markdown, "bridge_source_id");
    const zoteroURI = readFrontmatterValue(markdown, "zotero_uri");
    if (
      typeof cardID !== "string" ||
      cardSourceID !== sourceID ||
      typeof zoteroURI !== "string"
    ) {
      throw new Error("The annotation card has incomplete identity metadata.");
    }
    reference = {
      cardID,
      sourceID,
      vaultPath,
      relativePath,
      absolutePath: resolveVaultPath(vaultPath, relativePath),
      paperTitle: String(
        readFrontmatterValue(markdown, "zotero_paper_title") ?? "",
      ),
      paperCreator: String(
        readFrontmatterValue(markdown, "zotero_creator") ?? "",
      ),
      zoteroURI,
    };
  });
  if (!reference) throw new Error("Could not resolve the annotation card.");
  return reference;
}

function reportSelectionSummary(
  completed: number,
  requested: number,
  failures: string[],
  pendingCount: number,
): void {
  if (completed === requested && failures.length === 0 && pendingCount === 0) {
    return;
  }
  if (failures.length === 0 && pendingCount > 0) return;
  const details = failures.length ? `\n${failures.join("\n")}` : "";
  Zotero.getMainWindow().alert(
    `已处理 ${completed}/${requested} 条批注。${details}\n` +
      `Processed ${completed} of ${requested} annotations.${details}`,
  );
}

async function runAnnotationBatch(
  annotations: Zotero.Item[],
  requestedCount: number,
  currentID?: string,
): Promise<void> {
  if (annotations.length === 0) {
    throw new Error(
      "No saved annotations were found. Save the highlights in Zotero first.",
    );
  }

  const currentAnnotation = currentID
    ? annotations.find((item) => identifiersMatch(item, new Set([currentID])))
    : null;
  if (activeBatchController) {
    throw new Error("An annotation batch is already running.");
  }
  const controller = createCancellationController();
  const progress: AnnotationBatchProgress = openAnnotationBatchProgress(
    requestedCount,
    () => controller.abort(),
  );
  activeBatchController = controller;

  const operation = enqueueCardOperation(async () => {
    let completed = 0;
    let processed = 0;
    let preferredPath: string | null = null;
    const failures: string[] = [];
    let pendingCount = 0;
    const indexPath = getIndexPath();
    const vaultPath = getVaultPath();
    const outputFolder = getOutputFolder();
    const batchIndexContext: BatchCardIndexContext = {
      index: await readCardIndex(indexPath),
      discoveredSources: await indexMarkdownByFrontmatterField(
        vaultPath,
        outputFolder,
        "bridge_source_id",
      ),
      pendingChanges: 0,
      dirty: false,
    };

    try {
      for (let index = 0; index < annotations.length; index++) {
        if (controller.signal.aborted) break;
        const annotation = annotations[index];
        const position = index + 1;
        const headline = `正在处理批注 ${position}/${requestedCount}`;
        let detail = "";
        try {
          const page = annotation.annotationPageLabel;
          if (page) {
            detail = `Page ${page}`;
          }
          progress.update(processed, headline, detail);
          const relativePath = await createOrOpenCard(
            annotation,
            batchIndexContext,
          );
          completed++;
          if (annotation === currentAnnotation || !preferredPath) {
            preferredPath = relativePath;
          }
        } catch (error) {
          if (error instanceof CompanionPendingError) {
            pendingCount++;
            showPendingCompanionRequest(error.requestId);
            continue;
          }
          failures.push(
            `${annotation.key}: ${String(error).replace(/[\r\n]+/g, " ")}`,
          );
        } finally {
          processed++;
          progress.update(processed, headline, detail);
        }
      }
    } finally {
      if (batchIndexContext.dirty) {
        await writeBatchCardIndex(indexPath, batchIndexContext.index);
      }
    }

    const cancelled = controller.signal.aborted;
    if (cancelled) failures.push("Batch cancelled by user.");
    if (preferredPath) {
      await openCard(getVaultPath(), preferredPath);
    }
    const unresolved = Math.max(0, requestedCount - annotations.length);
    if (unresolved) {
      failures.unshift(
        `${unresolved} selected annotation(s) could not be resolved.`,
      );
    }
    const totalCompleted = completed;
    const headline = cancelled
      ? `批注批处理已取消：${totalCompleted}/${requestedCount}`
      : `批注卡片处理完成：${totalCompleted}/${requestedCount}`;
    progress.finish(
      headline,
      `Processed ${processed} of ${requestedCount} selected annotations. ` +
        `${pendingCount} request(s) remain queued. Completed cards were kept.`,
    );

    if (completed === 0 && failures.length > 0 && !cancelled) {
      throw new Error(
        `No annotation cards could be created or opened.\n${failures.join("\n")}`,
      );
    }
    reportSelectionSummary(completed, requestedCount, failures, pendingCount);
  });

  try {
    await operation;
  } catch (error) {
    progress.finish("批注卡片处理失败", String(error));
    throw error;
  } finally {
    if (activeBatchController === controller) activeBatchController = null;
  }
}

async function createCardsFromSelection(
  reader: _ZoteroTypes.ReaderInstance,
  payload: AnnotationPayload,
  selectedIDs: string[],
): Promise<void> {
  const { annotations, requestedCount } = await resolveSelectedAnnotations(
    reader,
    payload,
    selectedIDs,
  );
  await runAnnotationBatch(annotations, requestedCount, payload.id);
}

export async function importAllSavedAnnotations(
  reader: _ZoteroTypes.ReaderInstance,
  currentID?: string,
): Promise<void> {
  const annotations = await resolveAllSavedAnnotations(reader);
  if (annotations.length === 0) {
    throw new Error("This PDF has no saved annotations to import.");
  }
  const accepted = Zotero.getMainWindow().confirm(
    `Import ${annotations.length} saved annotations from this PDF?\n` +
      `The operation is idempotent; existing cards will be reused.`,
  );
  if (!accepted) return;
  await runAnnotationBatch(annotations, annotations.length, currentID);
}

export async function createCardFromAnnotation(
  reader: _ZoteroTypes.ReaderInstance,
  payload: AnnotationPayload,
  selectedIDs: string[] = [],
): Promise<void> {
  if (new Set(selectedIDs).size > 1) {
    return createCardsFromSelection(reader, payload, selectedIDs);
  }

  const knownSource =
    payload.key && Number.isInteger(payload.libraryID)
      ? `${libraryIdentityKey(getLibraryIdentity(payload.libraryID!))}/annotation/${payload.key}`
      : null;
  if (knownSource && createLocks.has(knownSource)) {
    return createLocks.get(knownSource)!;
  }

  const operation = enqueueCardOperation(async () => {
    const annotation = await resolveAnnotation(reader, payload, selectedIDs);
    if (!annotation) {
      throw new Error(
        "No saved annotation was found. Save the highlight in Zotero first.",
      );
    }
    const relativePath = await createOrOpenCard(annotation);
    await openCard(getVaultPath(), relativePath);
  });
  if (knownSource) createLocks.set(knownSource, operation);
  try {
    await operation;
  } finally {
    if (knownSource && createLocks.get(knownSource) === operation) {
      createLocks.delete(knownSource);
    }
  }
}
