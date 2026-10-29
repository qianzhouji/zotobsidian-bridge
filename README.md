# Zotero Obsidian Bridge

A Zotero desktop plugin and optional Obsidian companion for turning saved Zotero
PDF annotations and native notes into durable Markdown cards in an Obsidian
Vault. The current artifact is an internal development prototype, not a public
release.

## Current Status

Status as of 2026-10-29. Acceptance means the named scenario was observed in the
isolated desktop setup; local automation and runtime fault injection are called
out separately.

| Workstream                                                             | Status                                                                                                        | Evidence / remaining limitation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0–R3: baseline, durable writes, Zotero workflows, companion lifecycle | Accepted for the planned isolated matrix                                                                      | [`docs/r0-r1-execution-report.md`](docs/r0-r1-execution-report.md), [`docs/r2-execution-report.md`](docs/r2-execution-report.md), [`docs/r3-execution-report.md`](docs/r3-execution-report.md). Exact process kill at the write/receipt boundary remains fault-injection-only.                                                                                                                                                                                                                                                         |
| R4-A: native Zotero notes                                              | Accepted                                                                                                      | Real isolated note import, source refresh, duplicate reuse, personal-content preservation, and queue drain. [`docs/r4-a-execution-report.md`](docs/r4-a-execution-report.md)                                                                                                                                                                                                                                                                                                                                                           |
| R4-B: image resources and image annotations                            | Accepted in the isolated matrix                                                                               | Real image export/rendering, update/replay, offline recovery, late ACK, and source reconciliation passed. [`docs/r4-b-execution-report.md`](docs/r4-b-execution-report.md)                                                                                                                                                                                                                                                                                                                                                             |
| R4-C: scoped enrollment and historical batches                         | Main matrix passed; named non-member group visibility check pending                                           | The 108-item batch resumed from 48/108 to 108/108 with unique source identities. The isolated profile currently exposes My Library only; the unavailable `group:77` was left untouched. Read-denial handling is covered by fault injection. Zotero has no member-visible-but-unreadable group ACL, so that case is not applicable. A private test group owned by another account and a separate non-member test login are still needed for the live visibility check. [`docs/r4-c-execution-report.md`](docs/r4-c-execution-report.md) |
| R5: guided configuration, actionable status, recovery UX               | Isolated UX acceptance passed; fresh-profile onboarding walkthrough not run separately                        | Companion/direct setup checks, localized retry guidance, privacy-safe diagnostic export, recovery-copy restore, dark appearance, and narrow-window/long-title checks passed. The complete evidence and scope note are in [`docs/r5-execution-report.md`](docs/r5-execution-report.md).                                                                                                                                                                                                                                                 |
| R6: performance, cloud-drive, long-run and lifecycle matrix            | Partial acceptance; live matrix not fully closed                                                              | Local 1/100/1000 stress, failure/retry and actual permission checks, single-Mac iCloud hydration, 30-minute UI soak, and isolated companion disable/enable passed. Two-device conflict, real provider/network outage, and 1000-item host UI batch remain unrun. See [`docs/r6-execution-report.md`](docs/r6-execution-report.md).                                                                                                                                                                                                      |
| R7: CI, clean install/upgrade, release engineering                     | Dependency audits, license packaging, remote CI, companion lifecycle, and selected-ID paired write/ACK passed | [Remote Actions run #1](https://github.com/qianzhouji/zotobsidian-bridge/actions/runs/40728760703) passed. The selected Zotero ID `zotobsidian-bridge@qianzhouji` and Obsidian ID `zotero-card-bridge` completed a real isolated card write/ACK. Local and remote Git histories are disconnected and still need deliberate reconciliation; Zotero settings-pane rendering also needs investigation. See [`docs/r7-execution-report.md`](docs/r7-execution-report.md).                                                                  |
| R8: candidate trial and release decision                               | Not started                                                                                                   | Requires the preceding release gates and recorded user trial sessions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The R4-C isolated checks used only the project-local Zotero profile/data and
`.scaffold/test-vault`. Final test settings are automatic enrollment off, zero
scopes, and the 108-item history batch complete; the companion is connected and
the write queue has zero pending/running work. One pre-existing retry for
unavailable `group:77` was left untouched. The isolated library selector
currently exposes My Library only, so no unavailable group can be selected for
enrollment. This is not a test against a named private group. The read-denial
alert/no-batch path was verified with runtime fault injection, not a real group
ACL. Zotero's supported group settings do not provide a state where a member
can see a library but cannot read its items. The remaining live visibility
check requires a private test group owned by another account and a separate
isolated Zotero login that is not a member; neither fixture is currently
provisioned.

## Technical Roadmap

R0–R8 are the current project roadmap identifiers; they do not replace the
original product stages. The detailed development tools, implementation steps,
test cases, and acceptance criteria are maintained in
[`docs/completion-roadmap.md`](docs/completion-roadmap.md). Keep that document
as the detailed source of truth and this section as the current progress view.

| Phase | Goal and main tools                                                                                                                               | Exit gate / current state                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0    | Freeze scope, versions, fixtures, paths, and evidence using Git, Node, isolated Zotero/Obsidian profiles, and a test Vault.                       | Reproducible clean baseline and proven path isolation. Baseline established; preserve private data outside source/package.                                                                                                                                                                         |
| R1    | Make writes durable and idempotent using TypeScript, Zotero APIs, companion protocol, temp-filesystem tests, and failure injection.               | Restart/late-ACK recovery, revision checks, one queue consumer, safe path/pairing validation. Core implementation and acceptance completed; exact desktop kill boundary remains injected.                                                                                                          |
| R2    | Validate real Zotero UI, annotations, PDF/page mapping, Markdown editing, IME, and source updates using an isolated Zotero profile and test PDFs. | Each supported entry point preserves identity/body and opens the correct source. Isolated acceptance completed.                                                                                                                                                                                    |
| R3    | Validate paired Zotero–Obsidian writes using the companion, queue logs, multiple views/windows, restarts, and conflict fixtures.                  | No duplicate/lost notes; durable request/response/ACK convergence and single-writer behavior. Planned isolated matrix completed; exact process-kill boundary remains injected.                                                                                                                     |
| R4    | Add native Zotero notes (R4-A), image resources (R4-B), and scoped auto-enrollment/history import (R4-C).                                         | R4-A/B accepted. R4-C main matrix and fail-closed behavior passed; member-visible read-denial is not expressible by Zotero's ACL model. Final named non-member group visibility fixture remains pending.                                                                                           |
| R5    | Turn setup, waiting, retry, conflict, and recovery states into clear user actions using Zotero preferences/XUL and Obsidian Settings API.         | Isolated UX matrix passed: setup checks, actionable retry/status, diagnostics privacy, recovery restore, dark appearance, and narrow-window Chinese-title behavior. A separate pristine-profile onboarding walkthrough is unrun; see [`docs/r5-execution-report.md`](docs/r5-execution-report.md). |
| R6    | Measure and stress the integrated product using Node fixtures, real desktop apps, Activity Monitor, hashes, and a separate iCloud test directory. | 1/100/1000-item, long-run, crash/failure, cloud-drive, permissions, and multi-PDF criteria pass with no silent loss/overwrite. Pending.                                                                                                                                                            |
| R7    | Establish clean CI, IDs, versioning, migrations, packages, and install/upgrade/uninstall evidence using GitHub Actions and isolated profiles.     | Full dependency audits, license packaging, remote CI, companion lifecycle, and selected-ID paired write/ACK passed. Reconcile disconnected local/remote Git histories and investigate Zotero settings-pane rendering.                                                                              |
| R8    | Run a fixed candidate through at least three real reading sessions, close defects, and make the release decision.                                 | Evidence matches the shipped candidate; no data-integrity defects or core blockers. Not started.                                                                                                                                                                                                   |

### Remaining Work and Release Gates

**Open acceptance status:** R4-C named private-group non-member visibility is
**NOT RUN** (separate owner and non-member test accounts are still required).
R5 pristine-profile first-use onboarding is **NOT RUN** as a separate clean-
start walkthrough. R6 reliability acceptance is **IN PROGRESS**; these three
items remain release gates and are not implicitly closed by later-stage work.

1. **R4-C group visibility fixture:** create a private test group under a
   separate owner account, sign the isolated Zotero profile into a different
   test account that is not invited, and sync. Verify that the group is absent
   from both Zotero's library pane and the plugin's scope picker, and that no
   batch/card is created. Do not use the everyday Zotero profile. The member-
   visible/read-denied scenario is N/A for Zotero's documented ACL model; the
   read-error path remains fault-injection coverage.
2. **R5 fresh-profile walkthrough:** exercise the complete onboarding flow from
   a pristine isolated Zotero profile and test Vault. The setup checks and
   isolated feature matrix passed, but this specific clean-start walkthrough
   was not repeated as a separate lifecycle test.
3. **R6 reliability:** still requires a real two-device iCloud conflict-copy
   test, a real File Provider/network outage and recovery test, and a 1000-item
   Zotero/Obsidian host UI batch. Local stress/failure tests, actual filesystem
   permission denial, one-Mac iCloud hydration, the 30-minute soak, and
   companion disable/enable are recorded as passed in the R6 report.
4. **R7 release engineering:** the permanent Zotero ID and Obsidian ID have
   passed an isolated real paired write/ACK. Fetching remote `main` works, but
   it has no common ancestor with local `main`; reconcile the histories without
   losing local changes. Investigate the blank Zotero settings pane before
   relying on it for end-user setup. The GitHub repository is private, so public
   updater downloads still need a visibility/release decision.
5. **R8 candidate trial:** freeze a candidate commit/package, use it across at
   least three separate reading sessions and two app restarts, classify issues,
   add regression coverage, and retest the exact final artifact.

Public/beta release remains blocked until the deferred R4-C non-member
visibility check, R5 fresh-profile walkthrough, and R6–R8 gates pass. R4-C does
not claim that a real member-level read-denial
ACL was tested: Zotero's documented group settings distinguish library
visibility from editing, but do not expose that ACL state. Multi-device
transactions, mobile clients, OCR, and automatic concept-to-concept knowledge
links are outside this single-machine release.

## Architecture and Data Safety

- Zotero owns source metadata and annotations; Markdown cards carry stable
  source IDs and card UUIDs in frontmatter.
- Plugin-owned source blocks are refreshed independently from the user's
  `My notes` content and unknown YAML properties.
- The default writer is direct mode. Optional companion mode uses a durable
  local request queue, Vault pairing ID, revision checks, and one active queue
  consumer; it never silently falls back to direct writing.
- Paths are Vault-relative for card/resource writes, validated against traversal
  and symlink escape, and written with recovery copies where applicable.
- Automatic enrollment is opt-in, scope-limited, and separate from historical
  backfill. Saving a scope does not silently import old annotations.
- The test Vault and isolated Zotero profile live under `.scaffold/`; do not use
  the everyday profile or learning Vault as test fixtures.

## Development

Requirements: Node.js 24.22.1 LTS (`.node-version`), Zotero desktop for host
tests, and Obsidian desktop for companion tests. The product code is primarily
TypeScript; Zotero UI markup/localization also uses XHTML and Fluent files.

```sh
npm ci
npm --prefix obsidian-plugin ci
npm run build
npm run build:obsidian
npm run lint:check
npm run test:auto-enrollment
npm run test:companion-protocol
npm run smoke:integration
npm run verify:package
```

Use `npm start` only after inspecting `.env`; it must point at the project-local
Zotero profile and data directory. See [`docs/development-setup.md`](docs/development-setup.md)
for setup, [`docs/acceptance-report.md`](docs/acceptance-report.md) for current
test results, [`docs/card-format.md`](docs/card-format.md) for identity and
field ownership, [`docs/companion-protocol.md`](docs/companion-protocol.md) and
[`obsidian-plugin/README.md`](obsidian-plugin/README.md) for companion setup,
[`docs/manual-workflow.md`](docs/manual-workflow.md) for user workflows, and
[`docs/release.md`](docs/release.md) for packaging.

The project derives from the [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template)
at commit `306d4e2a0959a7b2f5e44bb38169fb25f841dbaf` and retains its
AGPL-3.0-or-later license. The project repository is
[`qianzhouji/zotobsidian-bridge`](https://github.com/qianzhouji/zotobsidian-bridge);
its GitHub visibility is private at the current development stage.
