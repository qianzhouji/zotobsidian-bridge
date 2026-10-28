# R3 Execution Report: Obsidian Companion Pairing

Date: 2026-10-27
Status: **The requested R3 desktop acceptance cases passed in the isolated Zotero/Obsidian pair.** The exact process-crash boundary between a companion write and its response remains covered by deterministic fault injection rather than a desktop process kill.

## Implemented

- Added an exclusive queue-owner record at
  `.zotero-obsidian-bridge-owner.json`. Only one Obsidian instance can consume a
  configured queue at a time. The owner is checked by process ID, releases the
  lock on normal plugin unload, and coordinates stale-lock recovery after a
  crashed process. Corrupt lock metadata fails closed rather than allowing a
  second writer.
- Added distinct status-bar states for an unconfigured queue, connected/idle,
  pending work, an open-note deferral, pending Zotero acknowledgement,
  conflicts, retryable file access, and another instance owning the queue.
  Conflict details are available in the status tooltip and in the response
  consumed by Zotero.
- Added the command-palette action **Copy Zotero Bridge Vault pairing ID**.
  The per-Vault ID is also shown in companion settings and is checked before
  any note write.
- Kept request/response/ACK records durable until Zotero has reconciled and
  acknowledged the response. Queue/output-folder changes continue to fail
  while records remain pending.

## Isolated Acceptance

`npm run test:companion-r3` loads the built companion bundle against a
filesystem-backed mock Obsidian Vault and an OS-temporary queue. The mock models
Obsidian's Vault and workspace APIs; it does not install the plugin in the
desktop app.

| Scenario                                                                        | Result                                                                     |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Request waits on disk while Obsidian is unavailable, then processes on startup  | PASS                                                                       |
| Applied file is replayed after losing its response and restarting the companion | PASS; no duplicate or content change                                       |
| Target note open among multiple workspace leaves                                | PASS; request stays pending and status explains the deferral               |
| User saves an edit before a stale replacement arrives                           | PASS; conflict response, saved content preserved, detail visible in status |
| Create request reuses a card identity with different content                    | PASS; explicit conflict, original content preserved                        |
| Request targets a different Vault ID                                            | PASS; write rejected                                                       |
| Target card has moved                                                           | PASS; stale target is not recreated or overwritten                         |
| Queue/output configuration changes while records remain                         | PASS; change rejected                                                      |
| Two Obsidian instances try to consume one queue                                 | PASS; one owner, second instance does not process                          |
| Zotero ACK arrives and is collected                                             | PASS; request/response/ACK triplet removed together                        |
| Companion unload/re-enable                                                      | PASS in the isolated harness; owner is released and reacquired             |
| Dead-process owner record and concurrent recovery attempts                      | PASS in `npm run test:companion-ownership`; exactly one contender wins     |

The existing `npm run test:companion-protocol` also covers Zotero-side late
response reconciliation and persisted acknowledgement behavior. Path
containment and retry policy remain covered by `npm run test:companion-safety`.

## Obsidian Desktop Acceptance

Obsidian 1.14.4 was used for the initial desktop checks and 1.14.5 after the
full-app restart, with the isolated `.scaffold/test-vault`; the main learning
Vault was not modified. The local plugin bundle was installed and enabled only
in that test Vault. It was paired with the non-cloud queue
`.scaffold/r3-queue` and the Vault-generated pairing ID. Requests below were
protocol fixtures written to that queue, not sent by a live Zotero instance.

| Obsidian-side scenario                                                                    | Result                                                                           |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Plugin discovered, enabled, and configured only in the isolated Vault                     | PASS                                                                             |
| Create request applied through the live Obsidian Vault API and visible as a Markdown card | PASS                                                                             |
| Open target note defers a replacement; status shows `waiting for editor`                  | PASS                                                                             |
| Save a local edit, close the note, then resume the stale replacement                      | PASS; conflict response, local edit preserved                                    |
| Add valid Zotero-style ACK fixtures                                                       | PASS; request/response/ACK triplets collected and status returned to `connected` |
| Main learning Vault and main Zotero library remain untouched                              | PASS                                                                             |

## Live Dual-App Acceptance

The isolated Zotero profile was paired with the real Obsidian companion in
`.scaffold/test-vault`, using `.scaffold/r3-queue` and the test Vault's pairing
ID. These requests were generated by the live Zotero plugin/editor, not by
protocol fixtures.

| Scenario                                                            | Result | Evidence                                                                                                                               |
| ------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Zotero creates/reopens the annotation card through its context menu | PASS   | Existing card identity and `RQR9RU33.md` were reused; no duplicate annotation file                                                     |
| Zotero editor writes user Markdown through the companion queue      | PASS   | Obsidian file received the body; Zotero showed `Saved`; queue returned to idle                                                         |
| Zotero and Obsidian pairing settings agree                          | PASS   | Zotero `writerMode=companion`, queue path, and Vault ID match Obsidian `data.json` and the queue-owner record; status was `connected`  |
| Obsidian open-note deferral and recovery                            | PASS   | Status changed to `waiting for editor`; closing the note allowed queued replacements and ACKs to drain; status returned to `connected` |
| Obsidian user edit is visible in Zotero editor                      | PASS   | Temporary text typed in Obsidian was read in Zotero; undo restored the blank body and Zotero re-read it                                |
| Cross-app links                                                     | PASS   | Zotero's open-in-Obsidian action selected the matching test note; the note's Zotero link returned to the selected PDF passage          |
| Final isolation and queue state                                     | PASS   | The target annotation has one matching Markdown card; request/response/ACK directories are empty; primary Vault/library untouched      |

While the Obsidian note was open, repeated editor autosaves produced 12
replacement/recovery snapshots. All requests eventually reconciled without
losing the body. This is a performance/noise issue to assess; it is not a
content-integrity failure in this run.

## View and Multi-Window Acceptance

The same `UKNIYAFR` annotation card was opened in Reading, Source, and Live
Preview. In each mode, a live Zotero source update stayed queued while the
card was open, the Markdown file on disk remained at the old source revision,
and closing the final open view allowed the source update and ACK cleanup to
finish. The user-owned YAML marker and note body survived.

| Scenario                                   | Result | Evidence                                                                                                                                  |
| ------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Reading, Source, and Live Preview deferral | PASS   | Each view showed a waiting state; disk did not change until the last matching view closed; the latest source update then appeared on disk |
| Same card in multiple tabs                 | PASS   | Closing one tab kept the request deferred; closing the final tab applied the update and drained the queue                                 |
| Same card in separate windows              | PASS   | The card was open in two native Obsidian windows; closing one still deferred the write; closing the remaining card view applied it        |
| Body and user metadata preservation        | PASS   | `r2_user_marker` and `R2 PERSONAL NOTE KEEP MARKER` remained intact across view and restart updates                                       |

## In-Flight Restart Acceptance

| Scenario                                              | Result                           | Evidence                                                                                                                                                                                                                 |
| ----------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full Obsidian restart with requests in flight         | PASS                             | Five duplicate replace requests remained on disk with no responses while Obsidian was down; after restart, the stale owner was recovered, one target card was updated, the personal body remained, and the queue drained |
| Zotero timeout followed by late ACK                   | PASS                             | With the companion offline, requests remained after the 1.5-second response timeout; reopening the test Vault applied the update, Zotero reconciled the late response, and all queue records were collected              |
| Zotero restart with requests in flight                | PASS                             | Three requests persisted with no response while isolated Zotero was quit; the same test profile reopened with its annotation comment intact; after reopening the test Vault, the requests applied and the queue drained  |
| Write succeeded but response was lost before recovery | PASS (automated fault injection) | The R3 companion test applies the file, removes the response, releases/restarts the companion, then replays the request; content stays unchanged and no duplicate card is created                                        |
| Delayed/manual save behavior                          | PASS (R2 live host test)         | Zotero editor autosave and explicit Save were observed; saved Markdown was read from disk, and user prose survived source refresh                                                                                        |

At the end of the desktop run, the test annotation had one matching Markdown
card, its body and custom metadata were preserved, and `requests/`,
`responses/`, and `acks/` were empty. The isolated Zotero item retains the
last test comment marker `R3-MOVED-CARD-LIVE-SOURCE-UPDATE`; no Main_Learning
note or primary Zotero library item was edited.

## Writer-mode, Moved-card, and Pairing Acceptance

These cases used the real isolated Zotero 10.0.6 settings and Reader UI and the
live Obsidian 1.14.5 companion in `.scaffold/test-vault`.

| Scenario                                                               | Result | Evidence                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Companion settings pane registration and pairing values                | PASS   | The Bridge pane appeared in Zotero Settings; Vault path, output folder, queue path, writer mode, and Vault ID matched the isolated Obsidian companion.                                                                                                                                                        |
| Empty-queue writer-mode transition `companion → direct → companion`    | PASS   | Both transitions completed in the real settings UI and ended in `companion`; the persisted profile preference also ended in `companion`.                                                                                                                                                                      |
| Output folder, queue path, and Vault ID guards while in companion mode | PASS   | Each attempted edit showed the expected protection alert and the original value remained. The output-folder test first exposed Zotero's automatic `preference=` binding writing before the guard; those redundant bindings were removed, the add-on was rebuilt/reloaded, and the same live test then passed. |
| Restore a card moved within the configured output folder               | PASS   | Zotero's Open / Add action found the card by its stable `bridge_card_id`, moved the index entry to `Annotations/R3-Moved/UKNIYAFR.md`, and cleared the suspended entry. Exactly one Markdown card with that identity exists.                                                                                  |
| Source update after moving the card                                    | PASS   | With the moved note open, changing the Zotero comment left disk content unchanged and Obsidian reported `waiting for editor`. Closing the final note view applied the source update to the moved path, preserved `r2_user_marker` and the user note body, and drained the request/response/ACK queue.         |
| Wrong Vault pairing ID against the live companion                      | PASS   | A protocol request carrying a different Vault ID received a `conflict` response (`Request is paired with a different Obsidian Vault`); no target file was created, and the request was acknowledged and collected.                                                                                            |
| Two Obsidian Vaults sharing one queue                                  | PASS   | The primary Vault retained the queue-owner record; the secondary Vault showed that the queue was owned by another instance and did not consume requests.                                                                                                                                                      |

R3's requested live acceptance matrix is complete. The isolated Zotero sync
status still reports one historical retry for `group:77/annotation/ANN001`
because that test group library is unavailable; it is unrelated to the moved
user-library card. Companion `requests/`, `responses/`, and `acks/` are empty,
and the companion reports `connected`. The main learning Vault and primary
Zotero library were not modified.

Residual verification note: the write/response loss boundary passed
deterministic fault-injection replay (including restart and idempotent replay),
not a desktop process kill at that exact instruction boundary.

## Verification Results

The focused R2/R3 automated regression commands below passed on Node.js 24.19.0
in this run. The earlier acceptance run also passed lint and package gates.

```sh
npm run build                       # PASS after the preference-pane guard fix
npm run test:companion-r3           # PASS (includes build:obsidian)
npm run test:companion-protocol     # PASS
npm run test:companion-safety       # PASS
npm run test:companion-ownership    # PASS
npm run smoke:integration           # PASS after making notifier test wait for state
npm run lint:check                  # PASS in the earlier acceptance run
npm run verify:package              # PASS in the earlier acceptance run; release placeholders remain
```
