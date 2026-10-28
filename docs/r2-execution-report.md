# R2 Execution Report: Real Zotero Basic Workflow

Date: 2026-10-27
Status: **R2 acceptance complete in the isolated Zotero profile and test Vault.** The real reader matrix, editor/input/save behavior, and source-preservation cases passed.

## Environment and Isolation

- Host baseline: macOS, Zotero 10.0.6, Node.js 24.22.1.
- Started the project development server with the configured
  `.scaffold/profile` and `.scaffold/data`; the test instance was launched with
  `-no-remote`, an explicit isolated `--dataDir`, and remote debugging enabled.
- Confirmed the isolated local API was on port 23124 and returned an empty test
  library before test items were imported. The primary Zotero process was
  exited before binding desktop automation to the isolated test profile. No
  primary-library item was created, modified, or deleted.
- The scaffold reported that the development add-on was installed as a
  temporary add-on. The isolated instance remains under the Node 24 development
  server during this acceptance session.

## Implemented Test Fixture

Added `npm run fixture:r2`, implemented by
`scripts/create-r2-test-pdf.mjs`. It creates the ignored local file
`.scaffold/r2-fixtures/bridge-r2-test.pdf` with two pages of selectable vector
text. The PDF declares page labels `i` and `2`, while the zero-based PDF page
indices are `0` and `1`, so the visible label/index distinction can be checked
in Zotero. `pdfinfo` confirmed a valid, unencrypted two-page PDF and its test
metadata. The fixture contains no third-party or personal material.

## Code and Automated Acceptance

The entry points are registered in `src/hooks.ts`:

- `renderTextSelectionPopup` and `renderSidebarAnnotationHeader` receive the
  event annotation and expose create/open and Markdown-edit actions.
- `createAnnotationContextMenu` resolves the current or selected annotation
  IDs and offers single, multiple, and all-saved-annotation actions.
- `src/services/annotation-card.ts` resolves a persisted Zotero annotation;
  when none is found, it explicitly asks the user to save the highlight first.
  It keeps the PDF page label and zero-based page index in separate fields and
  emits the Zotero deep link using the one-based PDF page number.
- The isolated integration smoke suite now covers parented and standalone
  PDFs, Chinese titles, multiple PDF attachments under the same paper, group
  library identity, page links, idempotent card mapping, batch import, and
  existing update/conflict-recovery behavior.
- A specific page-label case asserts `zotero_page_index: 0`,
  `zotero_page_label: i`, and a Zotero URL with `?page=1`; the user-visible
  label and the numeric reader page are not conflated.

Verification on Node.js 24.22.1:

| Check                              | Result                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `npm run lint:check`               | PASS                                                                        |
| `npm run build`                    | PASS                                                                        |
| `npm run build:obsidian`           | PASS                                                                        |
| `npm run verify:package`           | PASS; package audit passed, release identity/repository remain placeholders |
| `npm run smoke:integration`        | PASS; parented/standalone/Chinese/multiple-PDF/page-link cases included     |
| `npm run test:companion-protocol`  | PASS                                                                        |
| `npm run test:companion-safety`    | PASS                                                                        |
| `npm run test -- --exit-on-finish` | PASS; isolated Zotero startup test, 1 test                                  |

The fixture and automated tests validate serialization and mapping logic; they
do not replace the remaining real-reader and macOS input-system cases below.

## Live Zotero Acceptance

The isolated Zotero profile and Obsidian `.scaffold/test-vault` were used for
the following real UI checks. The primary Zotero library and `Main_Learning`
Vault were not used.

| Case                                                                         | Result | Evidence                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open/add an existing annotation card from the Zotero annotation context menu | PASS   | Reused the `RQR9RU33` card; one annotation Markdown file remained                                                                                                                                                                                            |
| Open the card's Markdown editor from Zotero                                  | PASS   | Editor showed the expected paper, quote, comment, and editable user-notes area                                                                                                                                                                               |
| Source protection and metadata mapping                                       | PASS   | Zotero source was visibly `Read only`; the quote, comment, page label `2`, page index `1`, and source block remained intact                                                                                                                                  |
| Markdown preview                                                             | PASS   | Bold text and inline KaTeX rendered in the real Zotero editor                                                                                                                                                                                                |
| Zotero-to-Obsidian save and ACK                                              | PASS   | Scratch user text was written through the editor/companion; queue drained and companion returned to `connected`                                                                                                                                              |
| Obsidian-side edit read back in Zotero                                       | PASS   | A temporary body marker typed in Obsidian appeared in the Zotero editor; undo restored the empty body in both apps                                                                                                                                           |
| Zotero deep link                                                             | PASS   | `?page=2` returned to the highlighted passage on the PDF's second physical page                                                                                                                                                                              |
| Open-in-Obsidian deep link                                                   | PASS   | Zotero opened the matching `RQR9RU33` note in the isolated `test-vault`                                                                                                                                                                                      |
| Text-selection popup                                                         | PASS   | Selecting unannotated PDF text displayed both plugin actions; `Open / Add Obsidian card` explicitly blocked the unsaved selection with “Save the highlight in Zotero first.” and created no card                                                             |
| Annotation sidebar entry                                                     | PASS   | Sidebar `Open / Add Obsidian card` created the card; repeating the action reopened the same `UKNIYAFR` note and preserved its card UUID                                                                                                                      |
| Dedicated R2 page-label fixture                                              | PASS   | On fixture label `i`, Obsidian recorded index `0` and `?page=1`; on label `2`, it recorded index `1` and `?page=2`. Both cards opened in the isolated `test-vault`                                                                                           |
| Reader matrix: standalone PDF, parented PDF, Chinese title, multiple PDFs    | PASS   | Opened the standalone top-level PDF in Reader and created its card; the Chinese-titled parent showed two distinct PDF attachments, each mapping to its own attachment key/card/deep link                                                                     |
| Repeated editor updates and autosave                                         | PASS   | Repeated edits changed editor status through `Saving`/`Saved`; persisted Markdown was read back from the test Vault, and recovery snapshots were observed                                                                                                    |
| Manual Save                                                                  | PASS   | A changed editor showed `Unsaved changes`; clicking `Save` changed status to `Saved`, and the resulting Markdown was present on disk                                                                                                                         |
| Chinese IME composition                                                      | PASS   | With Simplified Pinyin active, the editor showed `Composing` while entering `nihao`; Space committed `你好`. The original ABC input source was restored afterward                                                                                            |
| Zotero metadata and annotation update preserve personal content              | PASS   | Changing the parent item's date to `2026-10-27` updated `zotero_date` in both `Paper.md` and `UKNIYAFR.md`; changing the annotation comment updated only its managed source block. Custom YAML `r2_user_marker` and the personal-body marker remained intact |

The editor deferred incoming replacement requests while the target note was
open. After closing the note, the requests were applied and acknowledged. The
repeated-edit test generated recovery snapshots; an inspected snapshot captured
an intermediate partial edit, which is a point-in-time recovery version rather
than a completed-note boundary. Snapshots were left untouched. Temporary editor
text was removed after verification; the deliberate preservation marker remains
in the test fixture. The original ABC input source was restored.

All three outstanding live acceptance groups have now passed. R2 is closed;
the real-host scope was limited to `.scaffold/profile`, `.scaffold/data`, and
`.scaffold/test-vault`. The primary Zotero library and `Main_Learning` Vault
were not used.
