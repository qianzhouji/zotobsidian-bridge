# Project Acceptance Report

## Test Environment

- Build host: macOS, isolated project checkout
- Zotero baseline recorded in setup notes: 10.0.6
- Obsidian baseline recorded in setup notes: 1.14.5 for R4-A live acceptance
- Node.js: 24.22.1
- Package version: 0.1.0 (internal development artifact)
- Automated fixture: `.scaffold/smoke vault 测试 (#1)`; no personal vault or Zotero
  library data is used

## Stage 7: Integration Hardening

| Case                                           | Input and expected result                                                                                                                         | Result  | Evidence                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| 100-card batch                                 | 100 distinct saved-annotation fixtures plus one repeated selection ID; each source maps to exactly one unique card and the batch opens one result | PASS    | `npm run smoke:integration`; 100 source IDs, 100 unique card UUIDs                                 |
| Mid-batch cancellation                         | Cancel a 10-card batch after five completed cards; stop before the sixth and retain the first five                                                | PASS    | Cancellation injected at the progress callback in `scripts/smoke-test-card.mjs`                    |
| Duplicate source identity                      | Two Markdown cards carry the same `bridge_source_id`; lookup must fail closed and name the ambiguity                                              | PASS    | Isolated duplicate-copy regression in `scripts/smoke-test-card.mjs`                                |
| Multiple PDF attachments                       | One batch contains annotations from two attachment keys; each card must retain the correct attachment URI                                         | PASS    | `ATTACH01`/`ATTACH02` fixture assertions                                                           |
| Missing page data                              | Invalid PDF position plus a printable page label; card preserves label and omits page query                                                       | PASS    | `LOAD001` fixture                                                                                  |
| Empty selection / scanned-PDF behavior         | No saved/selectable annotations; operation must report that nothing can be resolved and create no card                                            | PASS    | Isolated no-annotation fixture                                                                     |
| Special characters and page labels             | Paper title contains path-reserved characters; generated paths remain inside the Vault                                                            | PASS    | Existing `Neural Mass/Model: Alpha?` path fixture                                                  |
| Damaged YAML and path escape                   | Malformed frontmatter and traversal/symlink paths are rejected without changing outside files                                                     | PASS    | Existing parser, traversal, and symlink assertions                                                 |
| Sync failure and restart                       | Injected write failure retries; persisted task resumes and user prose survives                                                                    | PASS    | Existing retry/restart smoke scenarios                                                             |
| Editor conflict and recovery                   | External edit is not silently overwritten; both versions can be archived; drafts round-trip                                                       | PASS    | Existing editor smoke scenarios                                                                    |
| Isolated Zotero host startup                   | Plugin registers its instance in a project-local Zotero process                                                                                   | PASS    | `npm run test -- --exit-on-finish`; startup test 1/1 passed on the recorded Zotero 10.0.6 baseline |
| Real Zotero PDF lifecycle and UI               | Exercise actual multi-attachment PDFs, scanned files, page-label mismatch, plugin disable/restart, and real Notifier APIs                         | NOT RUN | Requires isolated Zotero desktop session and manual evidence                                       |
| iCloud placeholders and conflict copies        | Repeat fixture operations in a separate test-only iCloud directory; verify delayed hydration and conflict copies                                  | NOT RUN | No iCloud test directory was created or modified                                                   |
| Real progress-window cancellation and profiler | Click Cancel in Zotero during a real large batch; confirm reader responsiveness and that the current card finishes while prior cards remain       | NOT RUN | Automated cancellation semantics pass; live XUL window and profiler need host verification         |

Automated result: `npm run smoke:integration` passed locally on 2026-10-26.
The script uses mocked Zotero API objects and disposable filesystem fixtures; it
does not count as host or cloud-drive acceptance.

## Stage 8: Packaging and Release

| Case                                      | Expected result                                                                        | Result                   | Evidence                                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean dependency install                  | `npm ci` resolves the committed lockfile                                               | PASS                     | GitHub Actions run #7 completed the `verify` job successfully on GitHub-hosted Linux for commit `5a6ae40`.                                                        |
| Build and static checks                   | Lint, typecheck, build, and isolated integration pass in a clean runner                | PASS                     | GitHub Actions run #7 completed successfully; local checks also pass. See the linked run in `r7-execution-report.md`.                                             |
| XPI content audit                         | Runtime assets exist; no test data, secrets, caches, or local absolute paths           | PASS                     | `npm run verify:package`                                                                                                                                          |
| Versioned artifact                        | Produce XPI and matching SHA-256 in an ignored review folder                           | PASS                     | `npm run prepare:release`; `.scaffold/release/`                                                                                                                   |
| Isolated Zotero install/upgrade/uninstall | Plugin loads; upgrade preserves mappings/body; uninstall leaves Markdown usable        | PASS (dev + selected ID) | R7 lifecycle passed; `zotobsidian-bridge@qianzhouji` is installed and active in `.scaffold/r7-retry-profile`. The paired selected-ID write/ACK is recorded below. |
| Public update channel and tagged release  | Publicly accessible repository, versioned release assets, and working updater manifest | BLOCKED                  | Metadata and IDs are configured, but the repository is private and no release assets or updater manifest are published                                            |

The package audit is a structural check, not a signature or malware scan. No
GitHub tag, GitHub Release, or updater manifest has been published.

## Stage 9: Content Extensions

Stage 9 is intentionally incremental; the roadmap lists independent extensions.
Historical annotation import and R4-A native Zotero note cards are implemented
and accepted. R4-B image-resource implementation and deterministic acceptance
are complete. Its real embedded-image note import, rendering, changed-image
update, identical replay, copied-folder rendering, companion
disable/re-enable check, real image-annotation export, and offline
app-restart/request recovery passed in the isolated desktop setup. Follow-up
checks also passed: a late ACK updates and closes a modeless pending-status
window without blocking Zotero, and source reconciliation for `UF3R8P7Y`
passes after moving the duplicate paper overview fixture outside the active
output tree. The test-only annotation comment and paper date were restored after
these checks.
R4-C scoped auto-enrollment is implemented. Automated policy/batch tests pass,
and isolated live tests confirm collection-scoped notifier-to-card creation,
no card for a separate out-of-scope item, and a six-item historical batch
resumed after Zotero restart without duplicate cards. A runtime-only
`AbortController` dependency found by the live batch test was removed; the
batch then completed 6/6. An unavailable group library is safely rejected
without creating a batch. On 2026-10-28, a live isolated history batch was
cancelled at 48/108, retained 60 items, resumed, and completed 108/108. The
active test Vault had 119 annotation cards with 119 unique source IDs. In the
isolated profile, the library selector exposes My Library only and the existing
unavailable `group:77` retry was left untouched. The available-but-unreadable
Preferences path was verified by runtime fault injection and created no batch.
Zotero's supported group permissions do not provide a member-visible but
unreadable library state; no named non-member group fixture was provisioned, so
the report does not claim a real account-ACL denial test. Final settings are
enrollment off and zero scopes; companion is connected and the sync queue has
zero pending/running work plus one pre-existing retry for unavailable
`group:77/annotation/ANN001`. See `docs/r4-c-execution-report.md`.
Group-library identity and attachment-specific annotation links were covered
earlier.

| Case                                                       | Expected result                                                                                                              | Result               | Evidence                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import all saved annotations from the current PDF          | Preview total, process each saved annotation with progress/cancellation, and keep completed cards                            | LOCAL PASS           | `importAllSavedAnnotations`; isolated four-annotation smoke fixture                                                                                                                                                                                                               |
| Repeat historical import                                   | Existing card IDs are reused; no duplicate card files                                                                        | LOCAL PASS           | Two consecutive import runs produce the same four unique IDs                                                                                                                                                                                                                      |
| Native-note HTML conversion                                | Convert supported Zotero note structures; warn on unsupported or untransferred content                                       | LOCAL PASS           | `npm run test:native-note`; `npm run smoke:integration`                                                                                                                                                                                                                           |
| Native Zotero note via companion                           | Create a parented note card from a real isolated Zotero note and clear the queue                                             | LIVE PASS            | `docs/r4-a-execution-report.md`; test Vault only                                                                                                                                                                                                                                  |
| Native-note source refresh and user-content preservation   | Refresh the existing card after a Zotero note edit; preserve `My notes` and card identity                                    | LIVE PASS            | One card remained; `bridge_card_id` and personal marker were preserved                                                                                                                                                                                                            |
| R4-B image-resource implementation and deterministic tests | Hash-addressed raster assets; verify MIME, size, decode, hash, idempotency, and corruption rejection                         | LOCAL PASS           | `npm run test:image-resource`, `npm run test:companion-protocol`, `npm run test:companion-r3`                                                                                                                                                                                     |
| R4-B live Zotero/Obsidian image workflow                   | Export a real image annotation and embedded note image; restart/offline and copy-folder checks                               | LIVE PASS            | Image export/render and offline request recovery passed. The late-ACK notice is modeless and closes after recovery; source reconciliation for `UF3R8P7Y` passed after moving the duplicate `Paper.md` fixture outside the active output tree. See `docs/r4-b-execution-report.md` |
| R4-C scoped auto-enrollment                                | Create cards only for selected user scopes; fail closed for unavailable libraries                                            | LIVE PASS            | Live scope inclusion/exclusion, 6-item restart/resume, 108-item cancellation/resume, and unavailable-library rejection pass. Read-denial UI behavior passes via fault injection. See `docs/r4-c-execution-report.md`                                                              |
| R4-C named non-member group visibility                     | A private test group not joined by the isolated account is absent from Zotero and the scope picker; no batch/card is created | NOT RUN              | No separate group owner/account or named private-group fixture is configured. Current isolated profile exposes My Library only; this observation is not a substitute for the named fixture test.                                                                                  |
| R4-C member-visible read denial                            | Zotero member can see group library but item/collection reads are ACL-denied; UI fails closed and creates no batch           | N/A (platform model) | Zotero's documented group settings do not provide this state. The UI failure/no-batch branch passes through controlled runtime fault injection.                                                                                                                                   |
| Group libraries and multiple PDF attachments               | Library identity and attachment URI remain distinct                                                                          | LOCAL PASS           | Stage 7 isolated scenarios                                                                                                                                                                                                                                                        |

Automated result: `npm run smoke:integration` passed locally on 2026-10-27.
The annotation context-menu open/add action, Markdown editor, source read-only
presentation, KaTeX preview, and PDF deep link also passed in the isolated live
Zotero profile. The broader R2 host matrix has since passed in the isolated
profile and test Vault; see `docs/r2-execution-report.md` for the final evidence.
R4-A live acceptance used the isolated Zotero profile and `.scaffold/test-vault`;
the source-update marker and user-owned content are recorded in
`docs/r4-a-execution-report.md`.

## Stage 10: Obsidian Companion

| Case                                                  | Expected result                                                                                                                                    | Result               | Evidence                                                                                                                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Companion typecheck and bundle                        | Official Obsidian API types compile and a loadable `main.js`/manifest are staged                                                                   | LOCAL PASS           | `npm --prefix obsidian-plugin run build`                                                                                                                                                                  |
| Protocol validation                                   | Reject path traversal, wrong output folders, non-Markdown writes, malformed revisions, and malformed recovery pairs                                | LOCAL PASS           | `npm run test:companion-protocol`                                                                                                                                                                         |
| Writer-mode transition                                | Wait for in-flight writes and all request files to be acknowledged and collected; restore the old mode on timeout instead of enabling dual writers | LOCAL + LIVE UI PASS | Empty-queue `companion → direct → companion` in the isolated Zotero Settings pane; companion-mode output, queue-path, and Vault-ID guards also passed after removing premature `preference=` auto-binding |
| Paired Zotero writer routing                          | In companion mode, Markdown create/replace requests go to queue; no direct fallback                                                                | LIVE PASS            | Real Zotero editor wrote to the isolated Obsidian Vault; pairing ID, queue path, and persisted mode matched; see `docs/r3-execution-report.md`                                                            |
| Obsidian appends responses and retries deferred files | Requests survive shutdown; open notes are not overwritten; stale revisions conflict                                                                | LIVE LIFECYCLE PASS  | Reading/source/live-preview, tabs/windows, Obsidian and Zotero restart with requests in flight, late ACK, moved-card source refresh, and final companion queue drain passed                               |
| Two-device/iCloud concurrency                         | Distributed edits converge without loss                                                                                                            | OUT OF SCOPE         | Queue is local-machine only and is not a multi-device transaction                                                                                                                                         |

The companion was installed and exercised only in the isolated
`.scaffold/test-vault`. The R3 live acceptance matrix is complete for the
requested scenarios; the exact write/response crash boundary remains covered
by deterministic fault injection, not a desktop process kill. Do not enable
paired mode in a primary Vault until the remaining release gates below pass.

## R5: User-Facing Recovery and Diagnostics

The R5 implementation and planned isolated UX matrix passed on 2026-10-28.
Only the project-local Zotero profile/data and `.scaffold/test-vault` were used.
The setup checks covered companion and direct mode; the companion was restored
after the direct-mode test. Queue retry guidance localized correctly, and the
existing unavailable `group:77` retry was left untouched. Diagnostic export
contained operational metadata without note body, paper text, absolute paths,
or raw error details.

The real Zotero editor listed and previewed a matching recovery copy, required
confirmation, restored its title/body, and archived the pre-restore contents.
The test card was then restored byte-for-byte and its SHA-256 matched the
pre-test copy. Light and dark appearance plus a 1024x666 window with a long
Chinese title passed without action controls being obscured. The full evidence
and automated command list are in [`r5-execution-report.md`](r5-execution-report.md).

| Case                                   | Expected result                                                                                          | Result    | Evidence                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| Companion and direct setup checks      | Correct pairing/heartbeat and Vault read/write checks; restore intended mode                             | LIVE PASS | Zotero preferences and Obsidian test-Vault write probe; see R5 report                                                  |
| Retry/status guidance                  | Localized reason and actionable card/queue location; no duplicate card                                   | LIVE PASS | Isolated queue status UI; pre-existing `group:77` retry not modified                                                   |
| Diagnostic export                      | No note body, paper text, absolute paths, or raw error details                                           | LIVE PASS | `.scaffold/r5-diagnostics-20261028.json` and privacy assertions                                                        |
| Recovery-copy UI                       | List/preview matching archive; require confirmation; restore selected content and preserve prior version | LIVE PASS | Real Zotero editor; UI created a `restore-copy` archive                                                                |
| Theme and constrained window           | Main controls remain visible; long Chinese title does not overlap controls                               | LIVE PASS | Light/dark appearance and 1024x666 isolated desktop checks                                                             |
| Pristine-profile first-use walkthrough | New user pairs a fresh profile/Vault and completes the full workflow without console/source edits        | NOT RUN   | Setup checks passed in the existing isolated development profile; a separate clean-start walkthrough was not performed |
| Automated regression                   | Build and focused R4/R5/R3 suites remain green                                                           | PASS      | Command list in `docs/r5-execution-report.md`                                                                          |

The test recovery archive was synthetic, while recovery selection, confirmation,
restore, and preservation of the prior version were exercised in the actual UI.
The everyday Zotero instance and primary Obsidian Vault were not used. R4's
named non-member private-group visibility check remains deferred at the user's
request; R6–R8 release gates are still open.

## R6: Reliability, Scale, and Cloud-Drive Acceptance

**Status: IN PROGRESS.** All live work uses the project-isolated Zotero
profile/data and `.scaffold/test-vault`; the primary Vault and daily Zotero
library are excluded.

| Case                                             | Expected result                                                                                       | Result                 | Evidence                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local 1/100/1000-card stress                     | Reconcile all inputs; unique source/card IDs; queue drains; record latency/RSS                        | PASS (service fixture) | Node 24.22.1, darwin-arm64: 1, 100, and 1000 inputs all succeeded; latest 1000-item elapsed 1.211 s, p50 0.77 ms, p95 2.45 ms; harness peak RSS 205.8 MiB. Repeated runs: 0.813–1.225 s; pre-optimization baseline: 127.100 s. Not a host UI benchmark.  |
| Large note/image and failure boundaries          | Preserve exact payloads; clean partial artifacts; retries do not duplicate cards                      | PASS                   | 280,000-byte note; 2 MiB resource; injected card/index/resource failures, idempotent retries, duplicate identity, in-flight cancellation, and actual read-only-directory denial/recovery; details in [`r6-execution-report.md`](r6-execution-report.md). |
| Single-Mac iCloud File Provider                  | Upload, evict local copy, hydrate on read without content change                                      | LIVE PASS              | 89-byte Markdown file hash remained `dbe3a503e2c018bbf188090ab2d63f132ec0792d878ee6d434bded749f4568a`; File Provider state changed uploaded+downloaded -> uploaded-only -> uploaded+downloaded.                                                          |
| 30-minute isolated Obsidian UI soak              | Repeated edits/view changes retain note body and companion connection without monotonic memory growth | LIVE PASS              | 08:19:08–08:49:19 UTC; 36 sequential edits, original user-note section retained, `connected`; final SHA-256 and RSS snapshots recorded in R6 report.                                                                                                     |
| Companion disable/re-enable and duplicate tab    | Reconnects after re-enable; same card remains intact in two tabs                                      | LIVE PASS              | Disabled/enabled only in `.scaffold/test-vault`; plugin toggle restored and status returned to `connected`; same card opened in two tabs.                                                                                                                |
| Two-device iCloud conflict copy                  | Detect conflict and avoid silent overwrite/duplicate card                                             | NOT RUN                | No second device was available for a real conflict fixture.                                                                                                                                                                                              |
| Actual File Provider/network outage and recovery | No empty overwrite; queued work recovers when service returns                                         | NOT RUN                | Local injected write failures are covered; actual outage is not simulated.                                                                                                                                                                               |
| Real filesystem permission denial                | Explain failure and recover without data loss                                                         | PASS                   | Temporarily removed write permission from the isolated test directory; write failed without a partial note and succeeded after permission restoration.                                                                                                   |
| 1000-item real host UI batch / multiple PDFs     | Correct mapping and responsive host UI under representative load                                      | NOT RUN                | Current performance measurements are service-level fixture results.                                                                                                                                                                                      |

R6 still cannot be marked fully accepted until the remaining applicable live
cases are run or explicitly deferred as release scope. R4-C's named non-member group visibility fixture and R5's
pristine-profile first-use walkthrough also remain open; see the R4/R5 rows
above and their execution reports.

## R7: CI, Installation Lifecycle, and Release Engineering

**Status: IN PROGRESS.** R6's open live acceptance items remain open and are
not closed by the R7 work.

| Case                                  | Expected result                                                                                     | Result                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full local release CI matrix          | Clean dependency install, lint, build, all automated suites, package audit, checksums               | PASS (local)            | Fresh locked installs, full dependency audits, lint, builds, all regression/stress suites, package audits, release packaging, and checksums passed in this checkout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Full dependency audit                 | No known vulnerable dependency in either locked dependency tree                                     | PASS (local)            | `npm audit` and `npm --prefix obsidian-plugin audit` both report zero vulnerabilities; both full audits are now blocking CI checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| License and third-party notices       | Include project license and shipped runtime notices in distributable packages                       | PASS (local)            | XPI includes `LICENSE` and generated notices for 39 shipped runtime packages; companion ZIP includes the AGPL license. The private npm package scanner label is a metadata-scanner artifact. Not legal advice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Remote GitHub Actions run             | Successful workflow run attached to this project's own repository                                   | PASS                    | [Run #1](https://github.com/qianzhouji/zotobsidian-bridge/actions/runs/40728760703) passed for `299a09d3ceec5dc0d6e9dc31913dd2560bebe9dd`; artifact digest and package hashes are recorded in `r7-execution-report.md`. No Release/tag was created.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Fresh isolated Zotero instance launch | Launch an independent Zotero profile and data directory visibly                                     | PASS (user-confirmed)   | Retry process arguments use `.scaffold/r7-retry-profile` and `.scaffold/r7-retry-data`; the separate window was visibly reached and operated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Selected-ID companion lifecycle       | Current Obsidian ID installs, enables, upgrades, disables, uninstalls, and reinstalls in test Vault | PASS (isolated)         | `zotero-card-bridge` passed install/enable, disable/re-enable, synthetic 0.1.0→0.1.1 replacement with settings hash preserved, restoration to 0.1.0, and uninstall/reinstall in `.scaffold/r7-vault`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Selected-ID paired write              | Permanent Zotero ID pairs with current Obsidian ID and completes a real card write/ACK              | PASS (isolated live)    | `zotobsidian-bridge@qianzhouji` paired with Obsidian ID `zotero-card-bridge` using matching Vault ID `d350bbc8-7c67-4dc7-a475-b49873ea109a` and `.scaffold/r7-queue`. Annotation `TP8AZRBP` created card `7b6272f0-b8b0-49c2-8189-c5f9969173a5`; expected excerpt/page metadata is on disk, Obsidian reported connected, and the queue drained. ACK files are deleted after validation, so completion is evidenced by the successful write and terminal queue cleanup rather than a retained ACK file. The Zotero setting was written in the isolated profile via Developer JavaScript because the add-on settings pane rendered without visible controls; investigate that pane separately. |
| Tag release identity preflight        | Refuse placeholders, tag/version and license mismatch; accept consistent metadata                   | PASS (local + fixtures) | Current metadata passed for `qianzhouji/zotobsidian-bridge` and `v0.1.0`; fixtures reject placeholder/invalid IDs, repository or tag mismatch, and mismatched licenses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Paired version and package audit      | Zotero, companion package, and companion manifest versions match; archive contents and hashes valid | PASS (local)            | `verify:package` and `prepare:release` passed; internal XPI and companion ZIP hashes are in `r7-execution-report.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

The full evidence and blockers are maintained in
[`r7-execution-report.md`](r7-execution-report.md). The project tree is on the
private repository and remote CI passed. Local `main` and `origin/main` are
synced at `8ae9bd4`, with a clean worktree. The pre-reconciliation local
history and working-tree snapshot are retained in
`backup/main-legacy-20261029` and
`backup/pre-reconcile-local-main-20261029`; neither backup was pushed. No tag
or public release has been created. The selected permanent IDs passed an
isolated paired write/ACK. The Zotero settings-pane rendering issue remains
open.

## Beta Gate

Do not call this beta-ready until progress-window cancellation is verified in
Zotero, the R5 pristine-profile walkthrough is recorded, the real lifecycle
cases and isolated iCloud scenarios pass, the Zotero settings-pane issue is
resolved, repository visibility and update access are settled, and the required
CI, lifecycle, and recovery checks pass.
Any data loss, silent overwrite, or incorrect source-to-card mapping remains a
release blocker.
