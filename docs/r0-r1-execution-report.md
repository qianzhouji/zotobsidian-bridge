# R0 + R1 Execution Report

Date: 2026-10-26
Project: Zotero Obsidian Bridge
Status: R0 baseline complete; R1 implementation and automated acceptance complete. Live paired-app acceptance remains open for R2/R3.

## R0: Fixed Baseline

- Created local checkpoint `0e4b648` (`chore: checkpoint Zotero Obsidian bridge prototype`) on `main` before R1 edits. The R1 work documented below is included in the current project snapshot.
- Confirmed the checkout is isolated from the Obsidian learning Vault and that `.env`, `.scaffold`, test data, and installed dependencies are ignored rather than part of the baseline commit. No personal Vault or Zotero library was used by the automated fixtures.
- Reinstalled dependencies from both lockfiles and verified the project with Node.js 24.22.1. The development notes record Zotero 10.0.6 and Obsidian 1.14.4 as the desktop baseline.
- Baseline lint, Zotero build, Obsidian companion build, integration smoke tests, companion protocol tests, and isolated Zotero startup test passed.
- `npm audit` reported 14 findings in the Zotero project dependency tree (1 low, 3 moderate, 10 high); the companion dependency tree reported 0. No automated dependency upgrades were applied because they could change runtime behavior without a separate compatibility review.
- The configured Git `origin` still points to the upstream Zotero plugin template. No push or GitHub release was attempted.

## R1: Write Consistency and Queue Lifecycle

| Item                        | Implementation                                                                                                                                                                                                                                                                                                                | Verification                                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-01 Late acknowledgements | Keep request/response files until Zotero writes a validated ACK. Applied annotation responses first enqueue durable source reconciliation; only after persistence does Zotero ACK. Startup/background polling recovers late responses, and failed reconciliation leaves the queue entry available for retry.                  | Integration fixture injects a reconciliation-persistence failure and confirms no ACK is written; a subsequent pass recovers and ACKs. Malformed per-request data does not prevent other responses from progressing. |
| R1-02 Original snapshot     | Pass the exact Markdown snapshot used to generate an update into the storage adapter. Both companion and direct modes compare the current bytes with that snapshot before writing; companion revisions and recovery content use the same baseline.                                                                            | Smoke test edits a card between read/generation and write, then confirms the external edit survives and the stale write is rejected.                                                                                |
| R1-03 Vault pairing         | Add a persisted Obsidian Vault UUID, expose it read-only in Obsidian settings, add a Zotero pairing preference, require a valid ID before companion mode can be enabled, and reject requests addressed to another Vault. Because this changes the wire contract, the protocol is now version 2.                               | Protocol tests cover matching/mismatching IDs, UUID validation, malformed responses, and rejection of version-1 requests.                                                                                           |
| R1-04 Single queue consumer | Acquire the processing flag synchronously before the first asynchronous operation, covering timer, command, and settings-triggered processing.                                                                                                                                                                                | Companion TypeScript build passes; desktop overlap testing remains part of live R3 acceptance.                                                                                                                      |
| R1-05 Transient failures    | Classify transient filesystem errors separately from semantic conflicts at both queue and request levels. Requests remain queued and retry with exponential delays capped at 30 seconds; retryable errors do not generate conflict receipts.                                                                                  | Policy tests cover retryable/permanent error classification and delay boundaries.                                                                                                                                   |
| R1-06 Writer transitions    | Treat every request file as pending until the Obsidian companion has collected its ACK, including requests that already have a response. Zotero continues response recovery while in `transition`; a non-draining queue restores the prior mode. Queue/output/pairing settings remain guarded while companion mode is active. | Existing transition tests cover successful drain and timeout rollback; queue lifecycle smoke checks that an ACK alone does not mean the request has drained.                                                        |
| R1-07 Path boundary         | Resolve existing ancestors through `realpath` before accepting the queue or a target/recovery path. Reject Vault-internal queues, symlink escapes, and broken symlinks.                                                                                                                                                       | macOS temporary-filesystem tests cover external queues, Vault-internal queues, symlinked queues, symlinked targets, and broken symlinks.                                                                            |

Protocol migration note: version 2 is intentionally incompatible with version 1. Drain the shared queue and upgrade both applications together. The Obsidian Vault pairing ID is retained in plugin data and must remain unchanged for an existing pairing.

## Verification Run

Using Node.js 24.22.1:

- `npm run lint:check` — passed.
- `npm run build` — passed.
- `npm run build:obsidian` — passed.
- `npm run smoke:integration` — passed, including the 100-card fixture and new stale-write/late-ACK recovery scenarios.
- `npm run test:companion-protocol` — passed.
- `npm run test:companion-safety` — passed.
- `npm run test -- --exit-on-finish` — passed, 1 startup test.

One initial startup-test invocation inherited Node.js 25.8.1 from the login shell and hit the known scaffold `grey` color-name incompatibility. Re-running with the pinned Node.js 24.22.1 passed; no code change was needed for that environment issue.

## Remaining Acceptance Boundary

R0 and the local R1 automated gate are complete. The companion has not yet been paired in a separate live Obsidian test Vault and exercised against the Zotero test profile. Do not enable protocol v2 in a primary Vault until the R3 manual matrix verifies Obsidian offline/restart recovery, editor-open deferral, external-edit conflict preservation, queue drain during writer-mode transitions, and paired Vault identity. The local tests establish implementation behavior under controlled fixtures, not full desktop or iCloud acceptance.
