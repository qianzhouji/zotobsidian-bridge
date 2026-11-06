# C0-C2 Execution and Acceptance Report

Updated: 2026-11-06 14:44 Asia/Shanghai

Latest: the expanded-editor regression is fixed, and real C-isolated input,
deletion, offline draft recovery, late creation handoff, 20 final-candidate
window cycles, link interactions and read permission/queue isolation checks
passed. Native Obsidian comparison is now complete for existing-file targets
and anchors, with explicit duplicate/missing-heading differences recorded.
The Reader source matrix, local unsynced anchor/context exclusions and two
simultaneous first-card edits before ACK also passed. A newly found pending-save
draft fault was fixed and verified in C isolation; the installed XPI changed.
See the [host follow-up](c0-c2-host-follow-up-2026-11-06.md) for the
current installed hash and precise remaining gates. The older snapshots below
are historical; their unavailable-tool and untested-host statements are
superseded by that follow-up. C0-C2 are not wholly signed off.

## Decision

**C0-C2 remain partially accepted, not complete.** Builds, automated tests,
read-only companion integration, and the synthetic Reader fixture are ready.
One real Reader retest showed the Bridge card, followed by 20 successful
Reader open/close cycles. The expanded editor also passed 20 open/close cycles,
and the user confirmed its edit/preview toggle works. Native/Bridge mode
switching and source switching between two saved annotations both restored the
expected card without a stale overlay. The native context menu worked and a
positive Bridge-card screenshot is saved. The user confirmed that a freshly
saved highlight now opens the Bridge shell on first click and retains text
entered during creation; read-only inspection found that text in its matching
Markdown card. C0 linked-child interaction checks remain dependent on the
C3-C5 linked-card UI. C1/C2 real Zotero UI checks remain. Offline/restart and
multi-Reader first-card scenarios remain untested in the real host. No automated
Reader click/screenshot tool is available.

## Stage results

| Stage              | Implemented and verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Still required                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C0 popup host      | DOM/component tests cover host-key routing, native preservation, mode changes, retry/click reconciliation, multi-Reader lifecycle, fail-open, and shutdown restore. Two-page synthetic PDF is attached in the isolated Zotero library and its stored bytes match the fixture hash. After refreshing C-isolated packages, the saved highlight displayed the Bridge card; 20 Reader and 20 expanded-editor open/close cycles, edit/preview toggling, Native/Bridge mode switching, source switching between two saved annotations, and native context-menu access were reported normal. The user verified first-click Bridge for a new highlight and text preservation through creation; the matching Markdown file contains that text. | Repeat first-card handoff offline/restarted and with two Readers; after C3-C5 adds linked child cards, run child-card interactions in both windows.             |
| C1 read-only query | Four operations are implemented. Automated tests cover permissions, limits, stale responses, anchors, cancellation and timeout cleanup. The live Obsidian companion passed search, path resolution, note/resource reading, missing-note, and file-integrity checks. A 70-second lease observation confirmed renewal at about 60 seconds; a subsequent 100-query run passed.                                                                                                                                                                                                                                                                                                                                                           | Exercise queries from the actual Zotero Reader/editor, including read permission off/on, stale pairing, and reads while the independent write queue is pending. |
| C2 links           | Wiki links, aliases, embeds-as-placeholders, Markdown internal links, source spans, same-note unsaved anchors, heading/block fragments, ambiguity, and unsafe/context exclusions are implemented and unit-tested. Preview click and editor Cmd-click routing pass DOM tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Validate each supported form with real Zotero preview/editor clicks and Cmd-click; compare resolved note and anchor with Obsidian's behavior.                   |

## Key findings

- The prior intermittent C1 `offline` result came from an expired capability
  lease, not failed note resolution. The desktop process refreshed its timer at
  roughly 60-second intervals while the old lease was 30 seconds. Capability
  lease is now 120 seconds; one query is still capped at 30 seconds, with a
  3-second default. See `NOTE_QUERY_CAPABILITIES_TTL` and its regression tests.
- C0 PDF parent item: `A3DDKUFD`; PDF attachment: `IYE76ATZ`.
- C0 real Reader observation: the user screenshot showed the native comment popup
  for saved annotation `8RV5FHQ5` on PDF page label `i`, with no Bridge card.
  The matching `P01N01.md` already existed in the C Vault and its source metadata
  matched that annotation, so card creation itself had completed. The screenshot
  does not establish whether it was captured before or after the companion ACK.
- A later C Reader observation showed a newly selected highlight initially
  opening Zotero's native popup and Bridge appearing after a delay. This matches
  the current flow: the adapter retries while the annotation is not yet
  resolvable, then waits for the serialized card operation and companion write
  response before mounting Bridge. The initial companion response timeout is
  1.5 seconds; after that, the native popup stays available while the adapter
  polls the queued request every 500 ms and remounts Bridge after an applied
  ACK. Read-only Zotero/Vault inspection subsequently found saved annotations
  `RIRRM7L4` (`Synthetic text only`) and `ZAEF2HBE` (`no research content is
included`) with matching cards `P01N02.md` and `P01N03.md`; the write queue
  had no pending request at inspection time. The screenshot alone cannot show
  whether it was captured before Zotero persisted the annotation or before the
  companion ACK, so it confirms the observed delay but not which wait dominated.
- This was a known first-card latency in the earlier UX, not evidence that the
  note was lost. The optimistic Bridge shell described below now removes the
  wait after Zotero exposes a stable saved-annotation ID. Before that ID exists,
  the native popup can still appear briefly; companion writes remain mediated
  by the companion rather than direct Vault writes.
- At that observation, the installed C XPI (`855f395d...`) differed from the
  then-current build. The older bundle still contained the Bridge popup adapter;
  therefore package staleness is confirmed, but is not yet proven to be the
  popup failure's root cause. The C-isolated packages have since been refreshed
  with the current build. The old packages are backed up at
  `.scaffold/c-install-backups/1793847070332`.
- C XPI SHA-256 at the earlier retest:
  `6ad5c2e83ac6cd304da5e483743b108f849f4860e344e9b9688ae3eeefde3ae4`;
  companion `main.js` SHA-256:
  `ddb1e42d3b45f4a729768af34f4006c103e533b18102e192b6e29d8c6d2c410f`.
  The exact C processes were restarted and the extension is active with
  `readerMode=bridge`. The user retested saved annotation `8RV5FHQ5` after the
  restart and confirmed the Bridge card appeared. This verifies one real
  Reader takeover. The user then reported 20 Reader and 20 expanded-editor
  open/close cycles with no issue, and confirmed edit/preview switching in the
  expanded editor. The user also verified that Native mode restores Zotero's
  native comment popup and switching back to Bridge restores the Bridge card.
  Source switching also passed with no stale overlay, and the user confirmed
  the native context menu works. Positive Bridge-card screenshot:
  `.scaffold/c-evidence/c0-bridge-card.png` (SHA-256
  `27fab155608610fcb5438b15947a6fb91ebc1bed1ca8f60be2a3339cc24563c0`).
  Read-only API inspection
  confirmed two distinct annotations and matching cards: `8RV5FHQ5` on page
  label `i` maps to `P01N01.md`, and `P8EL8G4E` on page label `2` maps to
  `P02N01.md`. Linked child-card interaction is deferred until C3-C5 implements
  that UI; C0's linked-child interaction test remains.
- An earlier failed import left an empty synthetic parent item `3J4WV4ZP` in
  the C test library. It has no PDF attachment and was not deleted. It is not a
  main-library item.
- C isolation only: Zotero PID `55741`, profile `.scaffold/c-profile`, data
  `.scaffold/c-data`; Obsidian PID `55742`, profile
  `.scaffold/c-obsidian-profile`, Vault `.scaffold/c-vault`.
- Current Zotero XPI SHA-256:
  `881a561062beb8fd5f9413c974e1718f50dc0d5de538c45825bca8515fc0f1e3`.
  Companion `main.js` SHA-256:
  `ddb1e42d3b45f4a729768af34f4006c103e533b18102e192b6e29d8c6d2c410f`.

## First-card optimistic shell follow-up

- Once Zotero exposes a saved annotation ID, Reader now mounts an editable
  `creating` Bridge shell before awaiting card creation. Unsaved text is stored
  in Zotero's local data directory, keyed by Vault path and source annotation
  ID; it is not written directly into the Obsidian Vault. Existing cards keep
  their fast path. An annotation without a stable saved identity still uses
  Zotero's native popup until it can be resolved.
- The companion remains the sole Markdown writer. A delayed ACK leaves the
  shell editable and does not resubmit the same pending request. After ACK,
  the local draft is staged as a normal editor recovery draft, verified against
  card/source identity, and loaded by the existing editor session. The pending
  copy is cleared only after the full editor mounts and only if no newer local
  edit replaced that copy. An offline/error state keeps the local draft and
  exposes retry; two different concurrent drafts are preserved rather than
  silently merged.
- Automated coverage passed: immediate editable shell before ACK; late ACK
  handoff without duplicate submission; Markdown preview; persisted draft
  after close/reopen and simulated process restart; write failure and retry;
  handoff to the normal editor draft; and a newer concurrent draft surviving
  cleanup. `npm run test:reader-popup-prototype`,
  `npm run test:pending-card-drafts`, TypeScript, production build, B5 recovery,
  companion R3, and isolated integration smoke checks passed.
- Final candidate XPI is installed only in `.scaffold/c-profile`; the installed
  SHA-256 is the hash above. A later verification build has a different archive
  SHA-256 because its generated `content/preferences.xhtml` build timestamp
  changed; every other archive entry, including the main script, is byte-identical
  to the installed package. The C companion hash did not change.
  The user reported that a newly saved highlight opened Bridge on first click
  and retained text entered during creation. Read-only inspection found C
  annotation `GD5RJHP4` (`zero`, PDF page 2) mapped to
  `Annotations/P02N04.md`, whose `My notes` section contains `test` and whose
  embedded source ID decodes to `user:0/annotation/GD5RJHP4`. The other two
  new page-2 highlights map separately to `P02N02.md` and `P02N03.md`.
  This accepts the first-click and basic handoff behavior, but not a timed
  measurement of the pre-ACK interval. Companion-offline/restart recovery and
  two-Reader concurrent edits still require real-host checks.

## Verification

| Check                                 | Result                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                       | Pass                                                                                                                                                        |
| `npm run build:obsidian`              | Pass                                                                                                                                                        |
| `npm run test:note-query`             | Pass; 10,004-entry index fixture and security/timeout regressions                                                                                           |
| `npm run test:note-links`             | Pass                                                                                                                                                        |
| `npm run test:note-navigation`        | Pass; DOM fixture only                                                                                                                                      |
| `npm run test:reader-popup-prototype` | Pass; component fixture only                                                                                                                                |
| `npm run test:pending-card-drafts`    | Pass; durable draft, late ACK, handoff, simulated restart, write failure and retry                                                                          |
| `npm run test:companion-protocol`     | Pass                                                                                                                                                        |
| `npm run test:companion-safety`       | Pass                                                                                                                                                        |
| `npm run test:companion-ownership`    | Pass                                                                                                                                                        |
| `npm run test:companion-r3`           | Pass; existing write/ACK/recovery behavior preserved                                                                                                        |
| Live C companion query report         | Pass; 100 requests, p50 44.85 ms, p95 85.59 ms, max 87.58 ms; 9 Vault content files unchanged                                                               |
| `npm run lint:check`                  | Prettier passes; full ESLint is blocked by existing issues in `scripts/create-b0-preview-vault.mjs` (two irregular-space findings and undeclared `process`) |

## Remaining acceptance protocol

1. After C3-C5 implements linked child cards, run the planned child-card
   interaction cycles in Reader and the expanded editor.
2. In the actual Zotero editor, click preview links and Cmd-click source links
   for each syntax in `note-link-support.md`. Confirm same-note, heading,
   nested-heading, block, alias, relative path, duplicate, and missing cases.
3. From Zotero, test read permission disabled/re-enabled and a read while the
   write queue is pending. Confirm reads never create or modify linked notes.
4. For first-card creation, repeat the C-isolated Reader test with the companion
   offline/restarted and with two Reader windows. Check that the local draft
   survives, one card is eventually created, and the late ACK preserves edits.

Do not mark C0-C2 complete or begin C3 dependent UI work until these host gates
are recorded.

## Pending-card draft persistence follow-up (2026-11-05)

The card-create wait and pending-editor draft are separate async paths. Pending
text is checkpointed under Zotero's data directory first; it should not wait for
Obsidian to create the Markdown file. Popup teardown now flushes through the
latest queued draft version, and a background recovery pass merges it into the
card once that card exists. Recovery verifies source/card IDs, clears the local
checkpoint only after the Markdown content is verified, and preserves both
versions on a concurrent edit instead of overwriting Obsidian content. The
pending Bridge shell also exposes expand/collapse before the card exists.

Automated regression checks passed for a delayed write with a newer edit queued
while closing, popup close/reopen persistence, simulated restart, card-later
recovery, verified cleanup, conflict preservation, duplicate create-request
reuse, and pending-shell expansion. Builds, TypeScript, focused lint/format,
companion queue, Reader popup, editor session, and integration smoke tests pass.
The candidate XPI installed only in the C-isolated profile has SHA-256
`1273411be82763a5b19ab72c47be6a53633fb80e293ba0d1204485e74d5fce78`;
rollback package is `.scaffold/c-install-backups/1793880655360`.

Real Zotero/Obsidian host acceptance is still pending for the new candidate:
create a fresh synthetic highlight, type a unique marker immediately, close
the pending popup before the companion ACK, then verify one card eventually
contains the marker and the local pending queue drains. The earlier
`C-OFFLINE-1105` marker eventually synced after Obsidian was restored, but that
occurred before this candidate and is not acceptance evidence for this fix.
Cmd+W handling in the expanded popup remains a low-priority follow-up.
