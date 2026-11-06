# Zotero Obsidian Bridge

A Zotero desktop plugin and optional Obsidian companion for turning saved Zotero
PDF annotations and native notes into durable Markdown cards in an Obsidian
Vault. The current artifact is an internal development prototype, not a public
release.

## Current Status

C-series update (2026-11-07): C3-C4 implementation and most isolated-host
checks are complete. Real expanded-editor candidate paging and canonical
wikilink insertion passed; automated tests verify that note searches remain
available while an unrelated write request is pending. Real Chinese IME
composition remains open. C4 live rendering of remote-image, unsupported
embed, raw-HTML, and unsafe-link fixtures passed with zero requests to a local
network probe. C5-A/B now automatically discover relations among visible cards
and keep each relation's source anchor independent. Automated regressions and
the isolated expanded-editor root/Bayes/Motion scenario passed. The Reader
popup itself still showed Zotero's native comment on first click in this
candidate and needs separate diagnosis; it is not counted as an in-place popup
pass. Parallel Reader isolation, host card limits, and full lifecycle matrix
also remain open. C0-C2 retain their own host gates and C6-C7 are not
implemented, so the C series is not complete. See the [C3-C4 progress
report](docs/c3-c4-progress.md), [C5 execution report](docs/c5-execution-report.md),
[C5-A/B host follow-up](docs/c5-ab-execution-report.md), and [C0-C2 host
follow-up](docs/c0-c2-host-follow-up-2026-11-06.md) for evidence boundaries and
remaining gates. No new commit/push or release.

Bridge-mode update (2026-11-04): B5 save/sync recovery changes and automated
regressions are implemented. The candidate is not yet installed for live B5
acceptance; B4's live save-failure recovery test is deferred by the user.
See the [B5 execution report](docs/b5-execution-report.md) for changes, state
semantics, evidence, and remaining desktop checks, and the
[Bridge-mode roadmap](docs/bridge-mode-roadmap.md) for B0-B8.

The following R-stage snapshot is as of 2026-10-29. Acceptance means the named scenario was observed in the
isolated desktop setup; local automation and runtime fault injection are called
out separately.

| Workstream                                                             | Status                                                                                                                                                            | Evidence / remaining limitation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0–R3: baseline, durable writes, Zotero workflows, companion lifecycle | Accepted for the planned isolated matrix                                                                                                                          | [`docs/r0-r1-execution-report.md`](docs/r0-r1-execution-report.md), [`docs/r2-execution-report.md`](docs/r2-execution-report.md), [`docs/r3-execution-report.md`](docs/r3-execution-report.md). Exact process kill at the write/receipt boundary remains fault-injection-only.                                                                                                                                                                                                                                                         |
| R4-A: native Zotero notes                                              | Accepted                                                                                                                                                          | Real isolated note import, source refresh, duplicate reuse, personal-content preservation, and queue drain. [`docs/r4-a-execution-report.md`](docs/r4-a-execution-report.md)                                                                                                                                                                                                                                                                                                                                                           |
| R4-B: image resources and image annotations                            | Accepted in the isolated matrix                                                                                                                                   | Real image export/rendering, update/replay, offline recovery, late ACK, and source reconciliation passed. [`docs/r4-b-execution-report.md`](docs/r4-b-execution-report.md)                                                                                                                                                                                                                                                                                                                                                             |
| R4-C: scoped enrollment and historical batches                         | Main matrix passed; named non-member group visibility check pending                                                                                               | The 108-item batch resumed from 48/108 to 108/108 with unique source identities. The isolated profile currently exposes My Library only; the unavailable `group:77` was left untouched. Read-denial handling is covered by fault injection. Zotero has no member-visible-but-unreadable group ACL, so that case is not applicable. A private test group owned by another account and a separate non-member test login are still needed for the live visibility check. [`docs/r4-c-execution-report.md`](docs/r4-c-execution-report.md) |
| R5: guided configuration, actionable status, recovery UX               | Isolated UX acceptance passed; fresh-profile onboarding walkthrough not run separately                                                                            | Companion/direct setup checks, localized retry guidance, privacy-safe diagnostic export, recovery-copy restore, dark appearance, and narrow-window/long-title checks passed. The complete evidence and scope note are in [`docs/r5-execution-report.md`](docs/r5-execution-report.md).                                                                                                                                                                                                                                                 |
| R6: performance, cloud-drive, long-run and lifecycle matrix            | Partial acceptance; live matrix not fully closed                                                                                                                  | Local 1/100/1000 stress, failure/retry and actual permission checks, single-Mac iCloud hydration, 30-minute UI soak, and isolated companion disable/enable passed. Two-device conflict, real provider/network outage, and 1000-item host UI batch remain unrun. See [`docs/r6-execution-report.md`](docs/r6-execution-report.md).                                                                                                                                                                                                      |
| R7: CI, clean install/upgrade, release engineering                     | Dependency audits, license packaging, remote CI, companion lifecycle, selected-ID paired write/ACK, Git reconciliation, and local settings-pane acceptance passed | [Remote Actions run #1](https://github.com/qianzhouji/zotobsidian-bridge/actions/runs/40728760703) passed. The settings pane renders in the isolated profile. The repository is public; local 0.1.0 artifacts and hashes are verified, but no tag/Release assets exist and both updater URLs currently return 404. See [`docs/r7-execution-report.md`](docs/r7-execution-report.md).                                                                                                                                                   |
| R8: candidate trial and release decision                               | Candidate trial acceptance complete; release not approved                                                                                                         | Three distinct same-day PDF-reader workflows, fresh capture after exact-artifact reinstall, Markdown round-trip, duplicate reuse, deferred-write recovery, and queued-work restarts in both isolated apps passed. Release remains blocked by R4-C/R5/R6 acceptance and R7 updater endpoint gates. See [`docs/r8-execution-report.md`](docs/r8-execution-report.md).                                                                                                                                                                    |

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

The next feature track is **B0–B8: Bridge-mode inline Markdown cards**. Its
development operations, dependencies, test matrix, and exit criteria are in
[`docs/bridge-mode-roadmap.md`](docs/bridge-mode-roadmap.md). This is a plan,
with execution status tracked separately: B0's metadata, naming, migration,
automated regression, and isolated Obsidian view checks have passed. B1 has a
read-only Reader prototype and component tests, but real saved-annotation
popup replacement is not yet accepted because the isolated Reader click did
not expose a popup to the adapter. The existing text-selection popup extension
does not establish that capability. See
[`docs/b0-b1-execution-report.md`](docs/b0-b1-execution-report.md). The
remaining R-stage release gates below continue to apply.

| Phase | Goal and main tools                                                                                                                               | Exit gate / current state                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0    | Freeze scope, versions, fixtures, paths, and evidence using Git, Node, isolated Zotero/Obsidian profiles, and a test Vault.                       | Reproducible clean baseline and proven path isolation. Baseline established; preserve private data outside source/package.                                                                                                                                                                         |
| R1    | Make writes durable and idempotent using TypeScript, Zotero APIs, companion protocol, temp-filesystem tests, and failure injection.               | Restart/late-ACK recovery, revision checks, one queue consumer, safe path/pairing validation. Core implementation and acceptance completed; exact desktop kill boundary remains injected.                                                                                                          |
| R2    | Validate real Zotero UI, annotations, PDF/page mapping, Markdown editing, IME, and source updates using an isolated Zotero profile and test PDFs. | Each supported entry point preserves identity/body and opens the correct source. Isolated acceptance completed.                                                                                                                                                                                    |
| R3    | Validate paired Zotero–Obsidian writes using the companion, queue logs, multiple views/windows, restarts, and conflict fixtures.                  | No duplicate/lost notes; durable request/response/ACK convergence and single-writer behavior. Planned isolated matrix completed; exact process-kill boundary remains injected.                                                                                                                     |
| R4    | Add native Zotero notes (R4-A), image resources (R4-B), and scoped auto-enrollment/history import (R4-C).                                         | R4-A/B accepted. R4-C main matrix and fail-closed behavior passed; member-visible read-denial is not expressible by Zotero's ACL model. Final named non-member group visibility fixture remains pending.                                                                                           |
| R5    | Turn setup, waiting, retry, conflict, and recovery states into clear user actions using Zotero preferences/XUL and Obsidian Settings API.         | Isolated UX matrix passed: setup checks, actionable retry/status, diagnostics privacy, recovery restore, dark appearance, and narrow-window Chinese-title behavior. A separate pristine-profile onboarding walkthrough is unrun; see [`docs/r5-execution-report.md`](docs/r5-execution-report.md). |
| R6    | Measure and stress the integrated product using Node fixtures, real desktop apps, Activity Monitor, hashes, and a separate iCloud test directory. | 1/100/1000-item, long-run, crash/failure, cloud-drive, permissions, and multi-PDF criteria pass with no silent loss/overwrite. Pending.                                                                                                                                                            |
| R7    | Establish clean CI, IDs, versioning, migrations, packages, and install/upgrade/uninstall evidence using GitHub Actions and isolated profiles.     | Full dependency audits, license packaging, remote CI, companion lifecycle, selected-ID paired write/ACK, Git reconciliation, and isolated settings-pane acceptance passed. Repository visibility is public; versioned release assets and live updater URL validation remain outstanding.           |
| R8    | Run a fixed candidate through at least three real reading sessions, close defects, and make the release decision.                                 | Candidate-trial acceptance complete: three distinct same-day PDF-reader workflows and exact-artifact reinstall/fresh capture passed. Release is not approved while R4-C/R5/R6 and R7 updater endpoint gates remain open. See [`docs/r8-execution-report.md`](docs/r8-execution-report.md).         |

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
4. **R7 release engineering:** the permanent Zotero and Obsidian IDs passed an
   isolated real paired write/ACK. At the latest check, local and remote `main`
   both point to `d8befec`; original history and pre-reconciliation snapshots
   remain in local backup branches. The Zotero settings pane fix is verified in
   the isolated profile. The GitHub repository is public, but it has no tag or
   Release assets yet; both updater URLs currently return 404. Current local
   fixes and documentation edits are uncommitted and have not been pushed.
5. **R8 candidate trial:** the scoped candidate-trial acceptance is complete.
   Three distinct same-day PDF-reader workflows, exact-artifact
   reinstall/fresh capture, deferred queue drain, and queued-work restart
   recovery in both isolated apps passed. This does not constitute a
   longitudinal or multi-user beta. See
   [`docs/r8-execution-report.md`](docs/r8-execution-report.md).

Public/beta release remains blocked until the deferred R4-C non-member
visibility check, R5 fresh-profile walkthrough, and R6–R8 gates pass. R4-C does
not claim that a real member-level read-denial
ACL was tested: Zotero's documented group settings distinguish library
visibility from editing, but do not expose that ACL state. Multi-device
transactions, mobile clients, OCR, and automatic concept-to-concept knowledge
links are outside this single-machine release.

## Architecture and Data Safety

- Zotero owns source metadata and annotations. Annotation cards expose only
  the paper title as plugin-generated Obsidian Properties. Bridge identity and
  synchronization fields are stored in an empty inline span's payload
  attribute, outside visible Properties. Reading View and Live Preview were
  verified in the isolated B0 Vault; Source mode intentionally shows raw
  Markdown. Legacy path migration runs through the shared manual/background
  synchronization service, including when the source hash is unchanged. See
  [`docs/card-format.md`](docs/card-format.md) for `PxxNxx` naming and legacy
  card migration behavior.
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
field ownership, [`docs/b0-b1-execution-report.md`](docs/b0-b1-execution-report.md)
for Bridge-mode implementation status, [`docs/companion-protocol.md`](docs/companion-protocol.md) and
[`obsidian-plugin/README.md`](obsidian-plugin/README.md) for companion setup,
[`docs/manual-workflow.md`](docs/manual-workflow.md) for user workflows, and
[`docs/release.md`](docs/release.md) for packaging.

The project derives from the [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template)
at commit `306d4e2a0959a7b2f5e44bb38169fb25f841dbaf` and retains its
AGPL-3.0-or-later license. The project repository is
[`qianzhouji/zotobsidian-bridge`](https://github.com/qianzhouji/zotobsidian-bridge);
its GitHub visibility is public. No versioned GitHub Release has been published.
