# R8 Candidate Trial and Release Decision

**Status: IN PROGRESS; NOT APPROVED FOR RELEASE.** This report records the
isolated trial completed on 2026-10-29. Both Zotero and Obsidian restart tests
with queued work now pass in positively identified isolated instances. The
release gates are not closed: only one independent reading/capture session has
been counted, the final exact-artifact reinstall has not been run, and required
R4-C/R5/R6 gates remain open.

## Candidate Identity

| Field                                 | Value                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Candidate branch                      | `r8-candidate` (local only; not pushed)                                                      |
| Base commit                           | `65940eb17a1e8745e12d843749b5943794452a87`                                                   |
| Candidate source state                | Base commit plus local R8 fix, regression test, and acceptance documentation; not yet frozen |
| Project version                       | `0.1.0`                                                                                      |
| Zotero add-on ID                      | `zotobsidian-bridge@qianzhouji`                                                              |
| Obsidian companion ID                 | `zotero-card-bridge`                                                                         |
| XPI                                   | `.scaffold/release/zotero-obsidian-bridge-v0.1.0.xpi`                                        |
| XPI SHA-256                           | `3f34c518f5523433b5fd789bfdd1724fbed24b2d9f4504c0d150a14ae0b20749`                           |
| Companion ZIP                         | `.scaffold/release/zotero-obsidian-bridge-companion-v0.1.0.zip`                              |
| Companion ZIP SHA-256                 | `95882113fbcc9230d11264dd331f75268ceda5707387ea2d16ada68e51739f69`                           |
| Installed companion `main.js` SHA-256 | `089ed728c684cff831e6a7f5f6ce0e07b1ee372b7ee0286c9467ab7b977ed781`                           |
| Build runtime                         | Node.js `24.22.1`                                                                            |

These are local, ignored build artifacts, not immutable release assets. No tag,
GitHub Release, or public update asset has been created. The XPI and companion
were installed only in isolated development environments; do not install them
in the primary Zotero profile or `Main_Learning` Vault.
The installed XPI at
`.scaffold/r7-retry-profile/extensions/zotobsidian-bridge@qianzhouji.xpi`
currently hashes to the same value as the recorded candidate XPI.

## Environment and Data Boundaries

- macOS `26.7.1`; Zotero `10.0.6`; Obsidian `1.14.5`.
- R8 Vault: `.scaffold/r8-vault`; queue: `.scaffold/r8-queue`.
- Zotero isolation was intended to use `.scaffold/r7-retry-profile` and
  `.scaffold/r7-retry-data`.
- Pairing ID: `105363f2-928c-439f-8769-d39862fcafe9`.
- The Companion was allowed only in `.scaffold/r8-vault`. The primary
  `Main_Learning` Vault was not used.
- Disposable Zotero fixture: `Zotero Obsidian Bridge R2 Test Fixture`, item
  `B4XQYVRK`; tested annotation `XJDWLMBF`.

## Automated Candidate Verification

The following passed after the Companion-writer fix was added:

| Check                                    | Result | Evidence                                                                                               |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Integration and protocol regression      | PASS   | `npm run smoke:integration`                                                                            |
| Lint and type checks                     | PASS   | `npm run lint:check`                                                                                   |
| Zotero package build                     | PASS   | `npm run build`                                                                                        |
| Obsidian companion build                 | PASS   | `npm run build:obsidian`                                                                               |
| R6 scale/failure/cancellation regression | PASS   | `npm run test:r6-stress`; 1/100/1000-item fixtures, injected recovery, drained queue                   |
| Package verification                     | PASS   | `npm run verify:package`                                                                               |
| Release configuration                    | PASS   | `GITHUB_REPOSITORY=qianzhouji/zotobsidian-bridge GITHUB_REF_NAME=v0.1.0 npm run verify:release-config` |
| Whitespace/error check                   | PASS   | `git diff --check`                                                                                     |
| Candidate artifact hashes                | PASS   | Values recorded above; installed companion bundle hash matches build output                            |

The focused checks were rerun on 2026-10-29 with Node.js `25.8.1`; the earlier
full candidate verification used Node.js `24.22.1`. A fresh XPI build has a
different archive hash because the build timestamp in
`content/preferences.xhtml` changes. Comparing the 54 archive entries showed
that this timestamp line was the only entry-content difference from the
recorded candidate XPI. The recorded XPI remains the package used in the R8
trial; final reinstallation is still required.

## Desktop Trial Matrix

| Case                                            | Result                        | Evidence and limitation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read fixture and capture a saved highlight      | LIVE PASS (one trial)         | Post-fix card contains the expected excerpt, page label `2`, zero-based page index `1`, and Zotero deep link. Companion queue drained.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Edit card through Zotero and verify in Obsidian | LIVE PASS (same trial series) | `XJDWLMBF` contains `R8 editor round-trip verified.`; it was visible in Obsidian and persisted on disk. This does not count as an independent reading session.                                                                                                                                                                                                                                                                                                                                                                              |
| Repeat the card action                          | LIVE PASS (one card)          | Repeating the action reused the source identity; no second card was created for the tested annotation.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Open-note deferral, close, and queue recovery   | LIVE PASS                     | The replacement was deferred while the note was open. After closing the test note, request `5c19f31e-f6cb-455c-9ef2-72c6b54b70f4` was applied/collected, the queue directories emptied, status returned to `Zotero Bridge: connected`, and the note body remained intact. Recovery content matched the prior on-disk note.                                                                                                                                                                                                                  |
| Obsidian restart with queued work               | LIVE PASS                     | Request `06227541-681f-47e6-90ce-d53628facbb3` (`replace`) was queued while the target note was open. Obsidian exited; the request remained on disk with no response/ACK, and its recovery content matched the Markdown file. Relaunched with `.scaffold/r8-obsidian-profile` and `.scaffold/r8-vault`; the same card reopened with `Zotero Bridge: connected`, request/response/ACK files were collected, `bridge_card_id` stayed `6d376859-21f6-4398-a353-56f33dae5cc2`, and `R8 editor round-trip verified.` remained in UI and on disk. |
| Zotero restart with in-flight work              | LIVE PASS                     | Request `0b40f649-e0a1-4f6d-b7cf-4bde06a388d1` persisted while the isolated Zotero process was stopped. Restart used `.scaffold/r7-retry-profile` and `.scaffold/r7-retry-data`; CUA showed `Zotero Obsidian Bridge R2 Test Fixture - Zotero`. After closing the target Obsidian note, the request drained, status returned to connected, and the Markdown body remained intact. Repeating Open/Add after restart reopened the same path/card/source ID; filesystem scan found one card for `user:0/annotation/XJDWLMBF`.                   |
| Third independent reading session               | NOT RUN                       | Only one independent capture session is counted. Restart recovery and replay of the same annotation are lifecycle/idempotency checks, not separate reading sessions.                                                                                                                                                                                                                                                                                                                                                                        |
| Final exact-candidate reinstall                 | NOT RUN                       | Reinstall the final XPI and companion artifacts after code is frozen, then rerun the critical workflow.                                                                                                                                                                                                                                                                                                                                                                                                                                     |

The Obsidian restart queue-drain check verified that the pending request and
its response/ACK were collected. The Markdown file SHA-256 after the earlier
round trip was
`babc4ecb72ab5f9ea4639511fbc64987182224563549279af71b4168cf9a2a75`.

## Issue Register

| ID    | Severity              | Description                                                                                                                                            | Status                                                                                                                                                                                                                                     |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R8-01 | High; core write path | In Companion mode, Zotero created an output directory directly before Obsidian's Vault API created it, causing a real `Folder already exists` failure. | FIXED in the local candidate; regression assertion added. Post-fix write/capture passed in the isolated trial.                                                                                                                             |
| R8-02 | High; test isolation  | Zotero automation bound to the everyday profile window during restart handling while the separately launched isolated process also existed.            | OPEN. No Zotero UI actions were taken after discovering the mismatch. Read-only checks on the everyday profile were inconclusive; do not claim the absence of earlier effects as proven. Reconfirm the isolated profile before continuing. |
| R8-03 | Release blocker       | Required number of independent reading sessions, isolated Zotero restart, and final exact-artifact reinstall are incomplete.                           | OPEN.                                                                                                                                                                                                                                      |

The issue table records the initial status when this report was drafted. The
R8-02 `OPEN` and R8-03 restart wording are superseded by the 2026-10-29 status
update below: the current isolated Zotero restart passed. R8-03 remains open
for the independent-session count and exact-artifact reinstall.

The `Folder already exists` failure was fixed by making Zotero's directory
preparation a no-op in Companion writer mode; the Obsidian Companion owns
directory creation through the Vault API. This avoids a filesystem/index race.
The regression test asserts that Zotero does not create the directory in this
mode.

**R8-02 status update (2026-10-29):** after the initial window mismatch, the
user saved/exited the everyday Zotero. The isolated process was relaunched with
the expected profile/data arguments, and the visible UI title identified the
disposable fixture. The Zotero restart test below is accepted as isolated. No
Zotero UI action was taken against the everyday profile after the mismatch was
detected. Earlier read-only checks do not establish whether prior state
changed, so this update does not claim the ordinary profile was untouched
before testing paused.

## Release Decision

**Not approved.** R8 remains open until at minimum:

1. Three independent candidate reading sessions are recorded; currently one
   independent capture session is counted.
2. The exact frozen-candidate XPI and companion are reinstalled and the critical
   flow is retested.
3. Remaining applicable R0–R7 release gates are passed or explicitly scoped
   out with the user's approval. At this report's date, R4-C named non-member
   visibility, R5 fresh-profile onboarding, and R6 two-device conflict,
   actual provider/network outage, and 1000-item host UI cases remain open.
4. The candidate tree is committed/frozen, then release metadata, public
   updater endpoints, package hashes, and installation/recovery documentation
   are verified against the exact artifacts before any publication.

Do not create a tag or publish release assets while any data-integrity or core
workflow blocker remains unresolved.
