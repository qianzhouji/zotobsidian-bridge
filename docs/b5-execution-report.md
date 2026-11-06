# B5 Execution Report

Date: 2026-11-04

Status: implementation and automated regression complete for the changes below;
**live B5 acceptance is pending**. The user deferred the B4 live save-failure
test. No desktop app was restarted, no XPI installed, and no main or B3 Vault
card edited during this work.

## Changes

- Persist the companion request ID, submitted body, and submitted baseline in
  the existing atomic editor draft. Old schema-1 drafts without this optional
  field remain readable. Invalid pending metadata is rejected without deletion.
- Restore the pending request on session initialization. A recovered session
  polls the existing request instead of immediately submitting another save.
- Retain the request association when disk verification fails after an ACK.
- Verify current disk body before reporting a pending write as saved. An applied
  but stale ACK with different disk text now produces a conflict, preserving the
  local body instead of briefly reporting success.
- Preserve a newer revert-to-baseline edit while an older direct or companion
  write is in flight. Do not remove its recovery draft or report it as saved.
- Block automatic poll-driven retry after an explicit save error. Editing or
  clicking Save retries; the error and recovery draft remain available.
- Expose local-draft persistence separately from target synchronization in both
  editor surfaces. Offline labels no longer unconditionally assert durability.
- Await draft persistence before the expanded editor's Close button closes the
  window; on failure it stays open with an error. Add an all-session checkpoint
  to plugin shutdown, including standalone editor sessions.
- Add `test:b5-recovery` and wire it plus existing editor/Reader/preview suites
  into GitHub Actions. Remote Actions have not been run for this working tree.

## State And Storage Contract

The Zotero draft is stored under its selected data directory at
`storage/zotero-obsidian-bridge/editor-drafts/<cardID>.json`, not inside the PDF.
The target Markdown stays in the configured Vault. Companion mode never silently
falls back to direct writing.

| State    | Meaning / evidence                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| dirty    | Text differs or requires verification; a separate flag says whether this revision has a local checkpoint.   |
| saving   | Local draft is written before attempting the target write.                                                  |
| pending  | A companion request exists; this is not target-write success. Local draft includes the request association. |
| saved    | Writer confirmed success, or pending reconciliation read the expected user body from disk.                  |
| offline  | Target could not be read; local content and any pending request remain intact.                              |
| conflict | Current disk and local versions disagree; automatic overwriting stops.                                      |
| error    | Explicit failure or missing completion evidence; draft retained, manual retry available.                    |

Existing debounce intervals remain 300 ms for drafts, 750 ms for autosave, and
1600 ms for polling. They are scheduling delays, not durability deadlines.
`Recovery copies` archives conflict-resolution versions; automatic unsaved-draft
recovery is a different mechanism.

## Automated Evidence

| Check                                 | Result / scope                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:b5-recovery`            | PASS: stale ACK conflict, unreadable target with retained request, revert while pending, missing completion, explicit save error/retry, failed checkpoint, direct-write race, separate-process pending recovery. |
| `npm run test:editor-session`         | PASS: shared views, rapid detach, IME model, serialization, newer edits during save, baseline conflicts.                                                                                                         |
| `npm run test:reader-popup-prototype` | PASS: modelled multi-Reader checkpoint/rollback, mode transitions, native restoration and keyboard routing.                                                                                                      |
| `npm run test:card-markdown-preview`  | PASS: Markdown/math/images, safe rendering and resource boundaries.                                                                                                                                              |
| `npm run test:companion-protocol`     | PASS: protocol validation and writer transition safety.                                                                                                                                                          |
| `npm run smoke:integration`           | PASS: isolated filesystem/card workflows, duplicate identity, queues and conflicts.                                                                                                                              |
| `npm run test:companion-r3`           | PASS: mocked Obsidian host, active-editor deferral, replay, recovery, ACK cleanup and ownership. Includes companion build/typecheck.                                                                             |
| `npm run build`                       | PASS: production XPI and TypeScript.                                                                                                                                                                             |
| `npm run verify:package`              | PASS: 54 archive entries.                                                                                                                                                                                        |
| Targeted ESLint                       | PASS on all changed TypeScript and the B5 test script.                                                                                                                                                           |

The B5 process test starts two separate Node processes with a temporary
file-backed adapter. The first writes a pending draft and exits; the second
restores it without resubmission, observes application, and removes the draft.
Temporary files are removed in `finally`. This is **not** a Zotero/Obsidian host
restart or forced-kill test.

Candidate XPI SHA-256:
`e5bfd046b35aeb1c6981194fc060c1029793aa2934e35f8b6acb77aa0c3daade`.
Candidate remains local and uninstalled; no release or push was performed.

## Acceptance Matrix

| Item                            | Automated evidence                                                                                 | Remaining live evidence                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| B5-01 rapid close/switch        | Session detach and direct-write/revert races pass.                                                 | Actual Reader click-away, page change, scroll teardown, and expanded Close/titlebar close with disk comparison. |
| B5-02 offline/reconnect         | Pending request retention, no resubmit on restored session, companion replay and ACK cleanup pass. | Actual offline typing, close/reopen, reconnect, latest-body comparison and queue drain.                         |
| B5-03 occupied target/conflicts | Companion host fixture deferral and session conflict regressions pass.                             | Real Obsidian active-editor deferral, release, both resolution choices and recovery-copy restoration.           |
| B5-04 restart/abnormal exit     | Separate Node process recovery passes.                                                             | Normal restart and controlled abnormal exit of each desktop app on the candidate.                               |
| B5-05 truthful failures         | Explicit error/checkpoint failure/unreadable target/stale ACK/missing result tests pass.           | Live permission/path failures and UI evidence. B4 save-failure recovery remains deferred by user.               |

## Boundaries And Follow-Up

- Full `npm run lint:check`: formatting passes, but ESLint is blocked by existing
  `scripts/create-b0-preview-vault.mjs` findings (irregular whitespace at lines
  40/42 and undefined `process` at line 52). That unrelated fixture was not
  changed. Targeted B5 ESLint and `git diff --check` pass.
- The B5 suite also exercises the production draft validator: valid pending
  metadata and legacy drafts load, malformed pending metadata fails closed.

- Input not yet checkpointed cannot be guaranteed after a process kill or power
  failure. The normal Close button is guarded; native titlebar/OS shutdown timing
  still needs host verification. Shutdown checkpoint failure is logged, not a
  claim that the OS shutdown can always be cancelled.
- Queue publication and recording its request ID in the editor draft are two
  durable operations, not a cross-file transaction. A kill between them may
  require conflict/revision reconciliation or a retry; exactly-one request is
  not promised for that boundary. Stable card identity and conditional writes
  remain the protection against duplicate cards and silent overwrites.
- ACK verification compares the user title/body. Existing card-writer and
  companion checks still own full-file revisions, metadata and resources.
- The candidate was built from an already-dirty development worktree. Existing
  edits were preserved. Before desktop acceptance, record the installed XPI
  hash and confirm isolated profile/Vault/queue paths.
- B4 remains partial and B5 is not fully accepted. Do not promote these unit or
  fixture results to live acceptance or a release decision.
