# Manual Card Workflow

## Configure

1. Open Zotero's plugin preferences.
2. Choose the Obsidian vault folder with **Browse…** or enter its absolute path.
   The folder must be writable and contain an `.obsidian` directory.
3. Set the output folder as a relative path inside the vault. The default is
   `Zotero Literature`; absolute paths and `.`/`..` segments are rejected.
4. Confirm the displayed destination path before using the annotation action.

## Create or reopen

From a saved PDF annotation, use **Open / Add Obsidian card** in the reader
selection popup, annotation sidebar header, or annotation context menu. The
plugin resolves the saved Zotero annotation, its PDF attachment, parent item,
library identity, displayed page label, internal PDF page index, quote, and
comment.

Use **Edit Markdown in Zotero** from the same reader controls to open a Zotero
editor window for that annotation card. The Zotero-derived excerpt is read-only;
the title and `My notes` Markdown are editable. The split preview renders
Markdown and KaTeX. Changes autosave to the vault after a short pause, and a
local recovery draft is written first. `Mod-S` or **Save** requests an immediate
save.

If the note body changes in Obsidian while the Zotero editor has unsaved work,
the editor shows the baseline and both versions. **Use Obsidian version** adopts
the disk copy; **Keep Zotero version** explicitly writes the local copy. Each
choice archives the competing text in the Zotero data directory before
resolving the conflict. If the vault disappears, the editor retains its local
draft and retries when the vault becomes available.

In the annotation context menu, selecting multiple annotations adds their
count to the action label. The plugin processes each saved annotation in turn,
shows a separate progress window, creates or reuses each card, and opens the
card for the current annotation when the batch finishes. **Cancel batch** stops
after the current card operation; completed cards remain valid, and failed or
unresolved entries are reported without stopping the rest of the batch.

For a new annotation, the plugin creates a paper overview and an annotation
card, updates its local index, and opens the card in Obsidian. Repeating the
action opens the existing card. If the card has moved within the configured
output folder, its UUID is scanned and the index path is repaired. If an
indexed card is missing, it is suspended rather than silently recreated; move
the same card back into the output folder to resume it.

The paper overview and annotation card are created without overwriting files.
The card includes a Zotero deep link to the PDF page. Zotero source updates are
synchronized only in bridge-owned fields and the marked source section; the
user-owned title and notes remain intact.

## Current limitations

- Only saved PDF annotations are supported; unsaved text selections are not.
- The selection popup and sidebar entry points use Zotero Reader events. The
  separate small floating annotation popup has not yet been confirmed as a
  stable extension point.
- Obsidian must be installed and the selected vault must be openable by its
  `obsidian://open` URI handler.
- Chinese IME composition, math rendering, automatic recovery, and conflict
  resolution need manual verification in the isolated Zotero profile.
- Actual macOS menu/input/URI behavior still requires hands-on verification in
  the isolated Zotero profile and test vault. Automated tests use mock Zotero
  objects and a disposable filesystem fixture.
