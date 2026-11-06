# C0-C2 Host Follow-Up

Updated: 2026-11-06 18:50 Asia/Shanghai.

## Decision

The expanded-editor editing regression is fixed and accepted in the C-isolated
Zotero host. C0-C2 are still **partially accepted**, not wholly signed off.
The Reader source-click matrix, concurrent first-card edits, installed-client
query/epoch checks, and the exact-candidate offline restart and late-ACK replay
are accepted within the scenarios described below. The supplement also fixed a
real pending-save draft fault in Zotero's addon sandbox.
This report supersedes older statements that no Computer Use tool is available
or that offline draft recovery and all Zotero link interactions are untested.
No release, Git commit, or push was performed.

## Faults And Fixes

1. The expanded editor used a XUL document. Real typing reproduced reversed
   characters and broken Select All/caret behavior. Changing its root to XHTML
   restored normal CodeMirror selection, typing, replacement, and Backspace.
   The built XHTML was checked with `xmllint`; scaffold supplies the `html`
   namespace declaration. A source-envelope regression assertion was added.
2. Pending-editor polling captured the draft at window-open time. A later save
   was replaced by that stale baseline. The pending adapter now advances its
   committed content after a successful local save, separately from draft
   checkpoints. Polling no longer reverts edits or treats its own checkpoints
   as external changes. The source panel now receives only source Markdown,
   not the whole synthetic card or hidden metadata.
3. An initial document unload could release the pending session prematurely.
   Close observation now waits for the intended editor document to load. Both
   pending and regular windows hold a session lease while opening. Pending
   close checkpoints the final content before notifying the inline card and
   releasing the session; the inline card no longer flushes a disposed session.
4. Repeated state notifications unnecessarily assigned `contentEditable` and
   rebuilt unchanged previews. Editability changes and preview rendering are
   now guarded. This avoids redundant selection-affecting DOM writes and
   invalidating link nodes during polling.
5. Real expanded-window links exposed a second sandbox boundary: the window
   cannot directly use Zotero's globals, and the addon sandbox has no global
   `AbortController`. Query clients now come through the main-window bridge;
   the transport uses the main window's AbortController/TextDecoder. A test
   removes the ambient AbortController and exercises the injected constructor.
   Cross-realm query errors retain their diagnostic message.
6. Cmd+W/Ctrl+W now follows the Close button's checkpoint-before-close path.
   A checkpoint failure keeps the window open with an error.
7. An existing card edited while C Obsidian was closed reproduced
   `ReferenceError: structuredClone is not defined`. Pending-save checkpoint
   and restart recovery used that unavailable addon-sandbox global. Both now
   explicitly copy the typed request ID, baseline and snapshot. A regression
   removes the global and verifies pending checkpoints, recovery, copy
   isolation and late ACK followed by saving the latest edit. The C host then
   persisted a newer draft while an earlier replacement still awaited ACK.

The CodeMirror document/root and read-only contracts were checked against its
[official reference](https://codemirror.net/docs/ref/) and installed source.

## Observed Host Results

| Scenario                                                | Result / Evidence Boundary                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sequential input and Backspace                          | Pass in pending and regular expanded editors; characters stay in order and deleted text does not return.                                                                                                                                                                                                                                             |
| Autosave/poll after editing                             | Pass; the final regular-editor marker changed to `C-MULTIREADER-1106-ABC12Z`, remained unchanged through polling, and reached Saved. The marker was then restored to `C-MULTIREADER-1106`.                                                                                                                                                           |
| Pending close/reopen                                    | Pass; inline content resumes without `session disposed`; five repeated cycles passed on the pending-editor fix.                                                                                                                                                                                                                                      |
| Exact-candidate window lifecycle                        | Pass on 7975d1e3...: 20 expanded open/Cmd+W-close cycles for an offline existing card, five for a pending new card, and 20 online Reader popup cycles.                                                                                                                                                                                               |
| Real Zotero process restart while C Obsidian was closed | Pass; `C-DRAFT-CLOSE-20261105-A` and `C-EXPANDED-EDIT-1106` were recovered from Zotero-local storage before starting C Obsidian.                                                                                                                                                                                                                     |
| Companion restart / late creation handoff               | Pass; starting C Obsidian promoted the pending expanded window to P01N05, retained both markers, and reached Saved. Read-only inspection found exactly one card for `user:0/annotation/VJJ6XM9Z`; pending drafts and write requests drained.                                                                                                         |
| Two Reader host routing                                 | Pass including simultaneous first-card editing before ACK: a tab Reader and separate Reader window each retained its own pending draft, survived popup close/reopen and a second edit, then reached Saved with one matching card per source after C Obsidian restarted. See the supplement below.                                                    |
| Reader + expanded preview clicks                        | Pass for wiki path, alias, heading, nested heading, block ID, same-note heading, Markdown internal link, embed placeholder, missing note, duplicate heading and missing heading.                                                                                                                                                                     |
| Expanded source Cmd-click                               | Same matrix passed; the alias initially showed Resolving, then correctly resolved to Mathematics/Bayes.md.                                                                                                                                                                                                                                           |
| Reader source Cmd-click                                 | Pass for all 12 positive/explicit-error cases on 7975d1e3..., plus six excluded contexts, ordinary-click behavior, list/blockquote source spans and a controlled local unsynced heading. Pure navigation changed no content and left no write requests.                                                                                              |
| Duplicate basename                                      | Pass in companion and native Obsidian UI: both selected Physics/Shared.md from P01N05. Duplicate basenames alone do not establish ambiguity.                                                                                                                                                                                                         |
| Native Obsidian comparison                              | Pass for existing wiki/alias/Markdown targets, heading/nested-heading/block links and a same-note heading. Native embeds rendered Motion with its formula and PNG; Bridge's embed remains a deliberate placeholder. Duplicate and missing headings have the explicit differences documented below.                                                   |
| Read permission off/on                                  | Pass from Reader UI: forbidden while disabled; Mathematics/Bayes.md after restoring permission. Only C companion settings were changed, then restored.                                                                                                                                                                                               |
| Wrong paired Vault identity                             | Pass from Reader UI: forbidden while a controlled C-only capability document named a different Vault; original capability restored afterward. The installed client also rejected an in-flight old-epoch result in the controlled runtime test below.                                                                                                 |
| Read while write queue is blocked                       | Pass. A no-op replacement of the already-open C Paper.md was genuinely deferred in the companion write queue. Reader resolved Mathematics/Bayes.md #Posterior (found) while that request still had no response. Paper.md hash stayed unchanged. The test-owned request was removed afterward. Evidence: `.scaffold/c-evidence/c1-busy-request.json`. |

Pausing only an Electron main PID does **not** prove the companion renderer is
offline. The SIGSTOP trials in this session are not counted as offline tests.
The accepted offline case above used the previously closed C Obsidian process;
the write-isolation test used a genuinely deferred request, not SIGSTOP.

## Checks

Passed: production build/TypeScript; editor-session; pending-card-drafts;
reader-popup-prototype; card-markdown-preview; B5 recovery; companion queue;
note-link parser; note navigation; note-query (10,004-entry fixture, permissions,
timeouts, stale responses and injected host constructor); integration smoke;
package audit; built-XHTML validation; targeted ESLint and `git diff --check`.

The live companion also passed all four query operations and 100 sequential
searches. This filesystem-client check is not relabeled as four native Zotero
UI operations. The native UI currently exercises resolve-link. The report is
`.scaffold/c-live-query-report.json`.

### Native Obsidian Comparison

Computer Use was rebound to the C-isolated `Obsidian 1.15.0` window after the
user foregrounded c-vault. The root was the existing P01N05 card. Wiki and alias
links opened Mathematics/Bayes.md; the Markdown link opened Physics/Motion.md.
The nested heading and block navigation visibly highlighted their intended
targets. `[[#C2 Local]]` stayed in P01N05 and highlighted that heading. Root
`[[Shared]]` opened Physics/Shared.md, matching the Bridge result.

Two differences are intentional safety semantics, not identical native behavior:

- Native `#Example` highlighted the first of the duplicate Example headings;
  Bridge reports `ambiguous` rather than choosing one silently.
- Native `#Missing heading` opened Bayes without a matching anchor highlight;
  Bridge reports `missing` rather than claiming a valid position.

The missing-note native link was deliberately not clicked because native
navigation could create it. Bridge's `not-found`/no-create behavior already
passed. After this comparison all 38 non-hidden Vault content files matched
the prior live-query inventory, with SHA-256
`a6cc0c25cf36b05ca1345a1faa10ae045eec726d49234facd596d55242d8e79b`;
Missing C0 Note.md still did not exist. Obsidian workspace state is excluded
from this content inventory. Evidence:
`.scaffold/c-evidence/c-native-comparison-1106.json`.

### Reader Source And Concurrent First-Card Supplement

The 7975d1e3... XPI was installed only in C isolation after the pending-save
fault was fixed. The complete Reader textarea Cmd-click matrix was replayed:
wiki, alias, heading, nested heading, block ID, same-note heading, Markdown
internal link, embed reference, duplicate basename, missing note, duplicate
heading and missing heading all produced their expected target/status.

With C Obsidian fully exited, a temporary `C2 Unsaved 1106` heading was present
in the Reader buffer and Zotero-local draft but absent from the Vault card;
Cmd-click found it locally. Inline/fenced/indented code, HTML comments,
Obsidian comments and escaped syntax did not replace a sentinel missing-link
status. An ordinary click on a real link did not navigate; Cmd-click in list
and blockquote links did. P01N05's original user content was restored through
the editor and confirmed on disk after the write queue drained.

For the concurrent scenario, C Obsidian remained exited while two independent
Readers created and edited new highlights. Both first cards were absent and
there were no responses when the two source-specific drafts were captured.
Each popup was closed/reopened and edited again before any first-card ACK:

- Tab Reader: `MQV9NEWV` retained `C-DUAL-A-1106` and
  `A-SECOND-EDIT-1106`, then became P01N07.
- Separate Reader window: `95HI7M4Z` retained `C-DUAL-B-1106` and
  `B-SECOND-EDIT-1106`, then became P02N05.

Starting C Obsidian promoted both views to Saved. Disk inspection found exactly
one card for each source, with the exact expected body and no cross-card marker.
The already-open P01N05 tab in C Obsidian correctly deferred its separate
replacement requests; closing only that tab let the remaining queue drain.
No requests, editor drafts or pending-card drafts remained.

The pure-navigation replay compared all 46 non-hidden content files before
and after; aggregate SHA-256 remained
`a953a966bb5898d282a375ffe97d2fb8a648d7dc2d027626ce5b28cbec94a4fb`.
This is not a claim that the whole supplement left the original 38 files
unchanged: temporary editing changed P01N05's serialized file, its user content
was restored, and the test added two cards plus six recovery backups. Existing
knowledge-note files were not changed; no missing note was created.

Evidence under `.scaffold/c-evidence/`:
`c-source-host-matrix-1106.json`, `c-source-unsaved-draft-1106.json`,
`c-dual-before-ack-1106.json`, `c-dual-edited-before-ack-1106.json`,
`c-dual-after-ack-1106.json`, and `c-supplement-integrity-1106.json`.

`fixture:c0 --check` refused the pre-existing modified Physics/Motion.md;
the file was not overwritten. This is not a clean-fixture validation pass.

## Exact-Candidate Host Supplement

On installed XPI `7975d1e3...` and companion `ddb1e42d...`, Zotero's actual
editor bridge created the installed query client. It successfully searched an
alias, resolved a nested heading, read a note with revision/metadata, and read
a PNG resource whose bytes matched the isolated Vault. Missing, unsupported and
forbidden reads returned their expected errors. A controlled transport barrier
held a real old-epoch companion response while the C-only Obsidian process was
restarted. The installed client rejected the delayed response as stale and a
fresh read succeeded with the new epoch. This is runtime fault injection, not a
manual re-pairing workflow or a claim that the C3 search/child-card UI exists.
All 46 non-hidden content files were unchanged by the query checks.

With C Obsidian fully exited, an existing card retained both a pending save and
a newer local edit; a new annotation retained its inline and expanded-editor
draft before any card existed. The existing card passed 20 expanded-window
open/Cmd+W-close cycles; the pending card passed five. After restarting only C
Zotero, both drafts were visible while Obsidian remained offline. Starting C
Obsidian promoted the still-open pending editor to `P01N08`, preserved its
complete text, and reached Saved. The existing card also received its newer
edit. Disk inspection found exactly one card per source and no remaining write
requests, responses, or local drafts. The existing test card's user text was
then restored to its pre-test baseline. The new card remains for inspection.
The final candidate also passed 20 Reader popup open/close cycles online.

Evidence: `.scaffold/c-evidence/c-zotero-runtime-query-1106.json`,
`c-zotero-runtime-integrity-1106.json`, `c-epoch-held-1106.json`,
`c-epoch-release-1106.json`, `c4-before-restart-1106.json`,
`c4-restart-process-1106.json`, and `c4-after-recovery-1106.json`.

## Remaining Gates

1. Linked child-card interaction cycles depend on the unimplemented C3-C5 UI.
   No floating knowledge cards, connector arrows, or completion UI are claimed.
2. The newly built math-style fix has a focused isolated Reader visual check,
   but the entire C0-C2 exact-artifact matrix has not been repeated on that
   newer package. Earlier full replay evidence remains tied to `7975d1e3...`.

## Reader Math Preview Fix

The Reader document rejected a direct `chrome://` stylesheet link: its sheet
existed but had zero rules, leaving superscripts unformatted. The plugin now
reads its bundled KaTeX CSS through Zotero's local resource API and inserts it
as a document-local style, with absolute bundled font URLs. Loading is
idempotent per Reader document and a failed load can be retried. A broad body
counter reset is omitted to avoid changing the host page.

Installed C-only XPI `f8088fde05e9584135aeb06de953ed0f9d04755fe15dcf72becbc5c9620a396a`
was visually checked on `P01N08`: the existing `$x^2$` rendered as a
superscript, and a temporary inline fraction and subscript rendered correctly.
The temporary content was removed and the original card text was confirmed on
disk; the write queue and local draft directories were empty. The block-formula
renderer is covered by automated tests, but its visual layout was not separately
confirmed in this run. Build/TypeScript, targeted ESLint and Reader popup and
Markdown preview regressions passed. Only the C-isolated Zotero was refreshed;
the previous package was backed up.

B4's deferred save-failure recovery and historical R/B gates remain unchanged.

## Installed Candidate And Scope

- Current C Zotero XPI SHA-256:
  `f8088fde05e9584135aeb06de953ed0f9d04755fe15dcf72becbc5c9620a396a`.
  Earlier exact-candidate results above used `7975d1e3...`.
- C companion main.js SHA-256 remains
  `ddb1e42d3b45f4a729768af34f4006c103e533b18102e192b6e29d8c6d2c410f`.
- Latest rollback package:
  `.scaffold/c-install-backups/1793963247134-zotero-only`.
- Only `.scaffold/c-profile`, `c-data`, `c-vault`, `c-queue`, and
  `c-obsidian-profile` were modified. Main_Learning was observed during app
  binding, but no clicks, settings changes, or content edits were made there.
- C apps are left running, read permission enabled, original pairing restored.
  Test cards/highlights remain for inspection. No fixtures were purged.
