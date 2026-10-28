# R5 Execution and Acceptance Report

Date: 2026-10-28. All desktop checks used the project-local Zotero profile and
data directory plus `.scaffold/test-vault`. The everyday Zotero instance and
primary Obsidian Vault were not used.

## Scope and Result

R5 implementation and its planned isolated UX acceptance matrix are complete.
The tests covered guided setup checks, queue/retry status, privacy-preserving
diagnostics, editor recovery copies, localization, theme behavior, and a narrow
window with a long Chinese title. A separate walkthrough from a pristine
Zotero profile and newly paired Vault was not run; setup checks were exercised
in the existing isolated development profile. This is recorded as a narrow
onboarding-evidence gap, not as a failed feature test.

## Live Isolated Checks

| Scenario                              | Result | Evidence                                                                                                                                                                                |
| ------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Companion setup check                 | PASS   | In Zotero preferences, paired status, heartbeat, Vault identity, and test write/read check passed.                                                                                      |
| Direct mode setup check               | PASS   | Direct Vault read/write check passed; companion mode was restored and rechecked afterward.                                                                                              |
| Obsidian companion write-access check | PASS   | The test-Vault write probe passed and its temporary file was removed. Pair identity matched.                                                                                            |
| Queue status and retry guidance       | PASS   | Retry state used localized Chinese copy and exposed a card-location/action path. The pre-existing unavailable `group:77` retry was observed but not modified.                           |
| Diagnostic export privacy             | PASS   | The exported JSON contained operational metadata only; checks found no note body, paper text, absolute local paths, or raw error details. See `.scaffold/r5-diagnostics-20261028.json`. |
| Recovery-copy list and preview        | PASS   | Zotero's editor showed only the archive matching the test card/source, with the expected localized title and body preview.                                                              |
| Confirmed recovery and preservation   | PASS   | After explicit confirmation, the editor displayed the selected draft and reported success. The restore operation created a `restore-copy` archive of the pre-restore version.           |
| Theme and narrow-window behavior      | PASS   | Light/dark appearance both rendered coherently. At 1024x666, primary actions stayed visible and a long Chinese title remained editable without overlapping neighboring controls.        |

## Recovery Fixture and Data Integrity

The recovery-list test archive was a synthetic, valid test fixture created only
under `.scaffold/data/storage/zotero-obsidian-bridge/editor-conflicts/`. The
editor UI performed the actual selection, preview, confirmation, restore, and
pre-restore archival. The test annotation card was restored byte-for-byte from
its pre-test copy. Its final SHA-256 matched the backup:

```text
e54eb2b74314529fc1b75d793b295766d9f386fc534b2d7334ff84680211b350
```

The test Vault and Zotero data remained within `.scaffold`; the macOS appearance
and display resolution were restored to their initial light/default settings.

## Automated Regression

All commands below passed with Node.js 24.22.1:

- `npm run build`
- `npm run build:obsidian`
- `npm run test:native-note`
- `npm run smoke:integration`
- `npm run test:diagnostics`
- `npm run test:companion-protocol`
- `npm run test:companion-safety`
- `npm run test:companion-ownership`
- `npm run test:image-resource`
- `npm run test:auto-enrollment`
- `npm run test:companion-r3`

The R5 live UI checks and these regression tests do not constitute R6's
performance, long-run, iCloud, or exact process-kill matrix. R4's named
non-member private-group visibility fixture remains deferred at the user's
request. See [`acceptance-report.md`](acceptance-report.md) for the consolidated
stage record.
