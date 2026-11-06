import {
  ensureAnnotationCardItem,
  getExistingCardReference,
  getVaultPath,
  type AnnotationCardReference,
} from "./annotation-card.ts";
import type { UserNoteContent } from "../core/note-content.ts";
import {
  readUserNoteContent,
  sameUserNoteContent,
} from "../core/note-content.ts";
import { readFrontmatterValue } from "../core/markdown.ts";
import { readVaultFile } from "../adapters/vault-storage.ts";
import {
  deletePendingCardDraft,
  flushPendingCardDraft,
  listPendingCardDrafts,
  readPendingCardDraft,
  type PendingCardDraft,
} from "../adapters/pending-card-drafts.ts";
import {
  hasPendingCompanionRequest,
  CompanionPendingError,
} from "../adapters/companion-queue.ts";
import { updateCardUserContent } from "./card-updater.ts";
import {
  readEditorDraft,
  writeEditorDraft,
} from "../adapters/editor-drafts.ts";

const recoveryInFlight = new Set<string>();
const recoveryLastAttempt = new Map<string, number>();
const emptyContent: UserNoteContent = { title: "", markdown: "" };

function sameContent(left: UserNoteContent, right: UserNoteContent): boolean {
  return left.title === right.title && left.markdown === right.markdown;
}

export async function stagePendingCardDraft(
  reference: AnnotationCardReference,
): Promise<PendingCardDraft | null> {
  const { vaultPath, sourceID, cardID, relativePath } = reference;
  await flushPendingCardDraft(vaultPath, sourceID);
  const stored = await readPendingCardDraft(vaultPath, sourceID);
  if (!stored) return null;
  const markdown = await readVaultFile(vaultPath, relativePath);
  if (markdown === null) throw new Error("The new card is not yet readable.");
  if (
    readFrontmatterValue(markdown, "bridge_card_id") !== cardID ||
    readFrontmatterValue(markdown, "bridge_source_id") !== sourceID
  ) {
    throw new Error("Card identity changed; the pending draft was preserved.");
  }
  const diskContent = readUserNoteContent(markdown);
  const previous = await readEditorDraft(cardID);
  if (
    previous &&
    (previous.sourceID !== sourceID ||
      previous.relativePath !== relativePath ||
      !sameContent(previous.draft, stored.content))
  ) {
    throw new Error(
      "A different recovery draft exists; both drafts were preserved.",
    );
  }
  if (!previous && !sameContent(diskContent, stored.content)) {
    await writeEditorDraft({
      schema: 1,
      cardID,
      sourceID,
      relativePath,
      baseline: { title: "", markdown: "" },
      draft: stored.content,
      updatedAt: new Date().toISOString(),
    });
  }
  return stored;
}

export async function clearPendingCardDraft(
  reference: AnnotationCardReference,
  staged: PendingCardDraft,
): Promise<boolean> {
  return deletePendingCardDraft(
    reference.vaultPath,
    reference.sourceID,
    staged,
  );
}

async function annotationForSourceID(
  sourceID: string,
): Promise<Zotero.Item | null> {
  const match = /^(user|group|feed):(\d+)\/annotation\/([^/]+)$/.exec(sourceID);
  if (!match) return null;
  const library = Zotero.Libraries.getAll().find(
    (candidate) =>
      candidate.libraryType === match[1] &&
      candidate.libraryTypeID === Number(match[2]),
  );
  if (!library) return null;
  const item = await Zotero.Items.getByLibraryAndKeyAsync(
    library.libraryID,
    match[3],
  );
  return item && !item.deleted && item.isAnnotation() ? item : null;
}

async function recoverOnePendingCardDraft(
  draft: PendingCardDraft,
): Promise<void> {
  const { sourceID, vaultPath } = draft;
  if (getVaultPath() !== vaultPath) return;
  let reference: AnnotationCardReference | null = null;
  const annotation = await annotationForSourceID(sourceID);
  if (!annotation) return;
  reference = await getExistingCardReference(annotation);
  if (!reference) {
    if (await hasPendingCompanionRequest(sourceID, new Set(["create"]))) return;
    await ensureAnnotationCardItem(annotation);
    reference = await getExistingCardReference(annotation);
  }
  if (!reference) return;

  await applyPendingCardDraft(reference);
}

export async function applyPendingCardDraft(
  reference: AnnotationCardReference,
): Promise<void> {
  const { sourceID, vaultPath } = reference;
  await flushPendingCardDraft(vaultPath, sourceID);
  const currentDraft = await readPendingCardDraft(vaultPath, sourceID);
  if (!currentDraft) return;
  const markdown = await readVaultFile(vaultPath, reference.relativePath);
  if (
    markdown === null ||
    readFrontmatterValue(markdown, "bridge_card_id") !== reference.cardID ||
    readFrontmatterValue(markdown, "bridge_source_id") !== sourceID
  ) {
    throw new Error("Card identity changed; the local pending draft was kept.");
  }

  const currentContent = readUserNoteContent(markdown);
  if (sameContent(currentContent, currentDraft.content)) {
    await clearPendingCardDraft(reference, currentDraft);
    return;
  }
  if (!sameUserNoteContent(currentContent, emptyContent)) {
    throw new Error(
      "The card already has different user notes; the local pending draft was kept for conflict review.",
    );
  }
  if (await hasPendingCompanionRequest(sourceID, new Set(["replace"]))) return;

  try {
    await updateCardUserContent(
      vaultPath,
      reference.relativePath,
      reference.cardID,
      emptyContent,
      currentDraft.content,
    );
  } catch (error) {
    if (error instanceof CompanionPendingError) return;
    throw error;
  }

  const verified = await readVaultFile(vaultPath, reference.relativePath);
  if (
    verified &&
    sameContent(readUserNoteContent(verified), currentDraft.content)
  ) {
    await clearPendingCardDraft(reference, currentDraft);
  }
}

export async function recoverPendingCardDrafts(
  sourceIDs?: readonly string[],
): Promise<void> {
  const allowed = sourceIDs ? new Set(sourceIDs) : null;
  const drafts = await listPendingCardDrafts();
  for (const draft of drafts) {
    if (allowed && !allowed.has(draft.sourceID)) continue;
    const key = JSON.stringify([draft.vaultPath, draft.sourceID]);
    if (recoveryInFlight.has(key)) continue;
    const lastAttempt = recoveryLastAttempt.get(key) ?? 0;
    if (Date.now() - lastAttempt < 4000) continue;
    recoveryLastAttempt.set(key, Date.now());
    recoveryInFlight.add(key);
    try {
      await recoverOnePendingCardDraft(draft);
    } catch (error) {
      Zotero.debug(
        `[Zotero Obsidian Bridge] Pending card recovery kept ${draft.sourceID}: ${String(error)}`,
      );
    } finally {
      recoveryInFlight.delete(key);
    }
  }
}
