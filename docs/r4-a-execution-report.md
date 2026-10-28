# R4-A Execution Report: Native Zotero Notes

Date: 2026-10-27

Status: **R4-A implementation and acceptance complete** for native Zotero note
cards in the isolated Zotero profile and `.scaffold/test-vault`. The feature is
one-way from Zotero note content to an Obsidian Markdown card; it does not write
Obsidian edits back into Zotero rich text.

## Delivered

- Added the `Import / Update Zotero note in Obsidian` item-context action for
  saved native note items.
- Added stable source identity `<library type>:<library ID>/note/<item key>`.
  Notes with a parent item are placed under that paper's `Notes/` folder;
  standalone notes go under a library-specific `Standalone Notes/` folder.
- Converts Zotero note HTML to Markdown with Turndown. Headings, paragraphs,
  emphasis, lists, tables, blockquotes, links, inline/fenced code, math, and
  citation display text are supported. Citation metadata is retained in a
  compact HTML comment when Zotero exposes it.
- Unsafe links are reduced to plain text; script/style content is omitted.
  Headerless tables receive generic column headings and a warning. Images and
  embedded media are explicitly reported in the note rather than silently
  dropped; copying image resources is deferred to R4-B.
- Zotero-derived content is kept inside the managed source markers. The
  `## My notes` section remains user-owned and is preserved during refresh.
  Re-import updates the existing card and never writes Markdown back to Zotero.
- Protocol v2 accepts native-note identities. Direct and companion writers use
  the same serialized card-operation path.

## Acceptance

| Case                                                                                                                  | Result | Evidence                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML conversion fixtures: headings, inline styles, links, lists, tables, code, math, citations                        | PASS   | `npm run test:native-note`                                                                                                                            |
| Headerless table, unsafe URL, script/style, image and embedded-media handling                                         | PASS   | Conversion fixtures assert warnings, safe fallback text, and omitted scripts                                                                          |
| Native-note identity accepted by companion protocol                                                                   | PASS   | `npm run test:companion-protocol`                                                                                                                     |
| Create a parented note from the real isolated Zotero profile through the registered menu callback and companion queue | PASS   | Test note `PVMEMCEH`; card created at `Zotero Literature/R2 真实界面验收文献（中文标题） (user-0-68Z229Q9)/Notes/R4-A Native Note Test (PVMEMCEH).md` |
| Verify source identity, title, converted body, code, table, and math in the saved Markdown                            | PASS   | Test Vault card contains `user:0/note/PVMEMCEH`, Zotero note key/title, the converted table/code/math, and the parent item key                        |
| Re-import after Zotero note content changes                                                                           | PASS   | Added `R4-A live source update marker.` in the isolated Zotero note; the same card refreshed                                                          |
| Preserve user-authored content and avoid duplicate cards                                                              | PASS   | `Personal note preserved by R4-A acceptance.` remained; exactly one `PVMEMCEH.md` card exists and `bridge_card_id` stayed unchanged                   |
| Companion request/response/ACK drain                                                                                  | PASS   | Request completed; `requests/`, `responses/`, and `acks/` contain no JSON entries afterward                                                           |

The live note contained formatted text, a list, a table, a code block, and a math
span. Citation metadata, unsafe links, image placeholders, and unsupported
embedded media are covered by deterministic conversion fixtures rather than
the live Zotero note. The Zotero card-opening URI displayed an OS confirmation;
it was cancelled after the saved file and companion acknowledgement had already
been verified. This did not affect card creation.

During setup, a second isolated test Vault was still holding the shared queue
lock. The companion correctly refused parallel consumption. Closing only the
`.scaffold/test-vault-secondary` test window transferred ownership to
`.scaffold/test-vault`; the main `Main_Learning` Vault and primary Zotero
profile were not modified.

## Verification Commands

The following focused gates passed after implementation:

```sh
npm run test:native-note
npm run smoke:integration
npm run test:companion-protocol
npm run test:companion-safety
npm run test:companion-ownership
npm run test:companion-r3
npm run build
npm run build:obsidian
```

R4-B is a separate extension and is tracked in
[`r4-b-execution-report.md`](r4-b-execution-report.md); R4-C scoped automatic
enrollment is not part of this acceptance.
