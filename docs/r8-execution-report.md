# R8 Candidate Trial and Release Decision

**Status: CANDIDATE ACCEPTANCE COMPLETE; RELEASE NOT APPROVED.** The R8
candidate trial and its scoped acceptance checks completed on 2026-10-29.
Three separate PDF-reader workflows across distinct saved annotations passed,
followed by a fresh-highlight capture using the exact installed candidate
artifacts. Both isolated applications also passed queued-work restart recovery.
This is a same-day, single-machine test, not a multi-user or longitudinal beta.
Release remains blocked by outstanding R4-C, R5, R6, and R7 publication gates.

## Candidate Identity

| Field                                 | Value                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Candidate branch                      | `r8-candidate` (local only; not pushed)                                                  |
| Base commit                           | `65940eb17a1e8745e12d843749b5943794452a87`                                               |
| Candidate source state                | Frozen implementation commit `0c74ea1`; this report is a later documentation-only update |
| Project version                       | `0.1.0`                                                                                  |
| Zotero add-on ID                      | `zotobsidian-bridge@qianzhouji`                                                          |
| Obsidian companion ID                 | `zotero-card-bridge`                                                                     |
| XPI                                   | `.scaffold/release/zotero-obsidian-bridge-v0.1.0.xpi`                                    |
| XPI SHA-256                           | `88bbb0ebd7e4b139003cd6c0113a61a78eb3124f51020da647e4680cb65c588d`                       |
| Companion ZIP                         | `.scaffold/release/zotero-obsidian-bridge-companion-v0.1.0.zip`                          |
| Companion ZIP SHA-256                 | `36b345250144f7a66bb66cd52e5c5102747b9472112e033eac4b0a616082b6a5`                       |
| Installed companion `main.js` SHA-256 | `089ed728c684cff831e6a7f5f6ce0e07b1ee372b7ee0286c9467ab7b977ed781`                       |
| Build runtime                         | Node.js `24.22.1`                                                                        |

These are local, ignored build artifacts, not immutable release assets. No tag,
GitHub Release, or public update asset has been created. The exact XPI was
reinstalled at
`.scaffold/r7-retry-profile/extensions/zotobsidian-bridge@qianzhouji.xpi` and
its hash matches the candidate. The exact companion ZIP was extracted into
`.scaffold/r8-vault/.obsidian/plugins/zotero-card-bridge`; its installed
`main.js` hash matches the packaged bundle. Both apps were restarted after this
installation. The artifacts were used only in isolated development
environments; do not install them in the primary Zotero profile or
`Main_Learning` Vault.

## Environment and Data Boundaries

- macOS `26.7.1`; Zotero `10.0.6`; Obsidian `1.14.5`.
- R8 Vault: `.scaffold/r8-vault`; queue: `.scaffold/r8-queue`.
- Zotero process arguments and visible fixture window confirmed
  `.scaffold/r7-retry-profile` and `.scaffold/r7-retry-data`; the everyday
  Zotero was exited before UI acceptance continued.
- Pairing ID: `105363f2-928c-439f-8769-d39862fcafe9`.
- The Companion was allowed only in `.scaffold/r8-vault`. The primary
  `Main_Learning` Vault was not used.
- Disposable Zotero fixture: `Zotero Obsidian Bridge R2 Test Fixture`, item
  `B4XQYVRK`; exercised annotations `P7UZ6JVY`, `GITCY6C5`, `XJDWLMBF`, and
  fresh annotation `CXV4B9RF`.

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
earlier candidate build. The final recorded XPI and companion ZIP were then
installed into the isolated profiles, their installed hashes were compared,
both applications were restarted, and the critical capture workflow passed.

## Desktop Trial Matrix

| Case                                            | Result                            | Evidence and limitation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read fixture and capture a saved highlight      | LIVE PASS (one trial)             | Post-fix card contains the expected excerpt, page label `2`, zero-based page index `1`, and Zotero deep link. Companion queue drained.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Separate PDF-reader workflows                   | LIVE PASS (3 distinct highlights) | After closing and reopening the PDF reader between workflows, Open/Add reused the existing cards for `P7UZ6JVY`, `GITCY6C5`, and `XJDWLMBF`; card IDs and source identity remained stable. These were three distinct same-day workflows in one disposable library, not sessions on separate days or devices.                                                                                                                                                                                                                                |
| Edit card through Zotero and verify in Obsidian | LIVE PASS (same trial series)     | `XJDWLMBF` contains `R8 editor round-trip verified.`; it was visible in Obsidian and persisted on disk. This does not count as an independent reading session.                                                                                                                                                                                                                                                                                                                                                                              |
| Repeat the card action                          | LIVE PASS (one card)              | Repeating the action reused the source identity; no second card was created for the tested annotation.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Open-note deferral, close, and queue recovery   | LIVE PASS                         | The replacement was deferred while the note was open. After closing the test note, request `5c19f31e-f6cb-455c-9ef2-72c6b54b70f4` was applied/collected, the queue directories emptied, status returned to `Zotero Bridge: connected`, and the note body remained intact. Recovery content matched the prior on-disk note.                                                                                                                                                                                                                  |
| Obsidian restart with queued work               | LIVE PASS                         | Request `06227541-681f-47e6-90ce-d53628facbb3` (`replace`) was queued while the target note was open. Obsidian exited; the request remained on disk with no response/ACK, and its recovery content matched the Markdown file. Relaunched with `.scaffold/r8-obsidian-profile` and `.scaffold/r8-vault`; the same card reopened with `Zotero Bridge: connected`, request/response/ACK files were collected, `bridge_card_id` stayed `6d376859-21f6-4398-a353-56f33dae5cc2`, and `R8 editor round-trip verified.` remained in UI and on disk. |
| Zotero restart with in-flight work              | LIVE PASS                         | Request `0b40f649-e0a1-4f6d-b7cf-4bde06a388d1` persisted while the isolated Zotero process was stopped. Restart used `.scaffold/r7-retry-profile` and `.scaffold/r7-retry-data`; CUA showed `Zotero Obsidian Bridge R2 Test Fixture - Zotero`. After closing the target Obsidian note, the request drained, status returned to connected, and the Markdown body remained intact. Repeating Open/Add after restart reopened the same path/card/source ID; filesystem scan found one card for `user:0/annotation/XJDWLMBF`.                   |
| Fresh capture after exact-artifact reinstall    | LIVE PASS                         | Created a new yellow highlight on page 2, source key `CXV4B9RF`; Open/Add created exactly one card `99445e54-5a1c-4bc9-b4cd-0d24b688325a`, rendered it in `.scaffold/r8-vault`, and Obsidian reported `Zotero Bridge: connected`. Queue contained no pending request/response/ACK afterward.                                                                                                                                                                                                                                                |
| Final exact-candidate reinstall                 | LIVE PASS                         | XPI SHA-256 `88bbb0ebd7e4b139003cd6c0113a61a78eb3124f51020da647e4680cb65c588d` matched the installed XPI; companion ZIP SHA-256 `36b345250144f7a66bb66cd52e5c5102747b9472112e033eac4b0a616082b6a5` and installed `main.js` were verified. Both isolated apps restarted before the fresh capture.                                                                                                                                                                                                                                            |

The Obsidian restart queue-drain check verified that the pending request and
its response/ACK were collected. The Markdown file SHA-256 after the earlier
round trip was
`babc4ecb72ab5f9ea4639511fbc64987182224563549279af71b4168cf9a2a75`.

## Issue Register

| ID    | Severity              | Description                                                                                                                                            | Status                                                                                                                                                                                                                               |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R8-01 | High; core write path | In Companion mode, Zotero created an output directory directly before Obsidian's Vault API created it, causing a real `Folder already exists` failure. | FIXED in the local candidate; regression assertion added. Post-fix write/capture passed in the isolated trial.                                                                                                                       |
| R8-02 | High; test isolation  | Zotero automation initially bound to the everyday profile window while an isolated process also existed.                                               | RESOLVED FOR THIS ACCEPTANCE: everyday Zotero was exited; isolated process arguments and visible fixture window were verified before continuing. Earlier read-only checks do not prove that no prior everyday-profile state changed. |
| R8-03 | Release blocker       | Candidate-trial completion and release-gate disposition.                                                                                               | R8 trial checks PASS. Product release remains BLOCKED by the explicitly listed R4-C/R5/R6/R7 gates.                                                                                                                                  |

The `Folder already exists` failure was fixed by making Zotero's directory
preparation a no-op in Companion writer mode; the Obsidian Companion owns
directory creation through the Vault API. This avoids a filesystem/index race.
The regression test asserts that Zotero does not create the directory in this
mode.

## Test-only Data Notes

- During repeated editor UI checks, the disposable `GITCY6C5.md` fixture body
  contained duplicated synthetic R8 marker text. A preserved recovery copy
  showed the original `My notes` section was blank. The test note was restored
  to that blank baseline; recovery copies were retained. The corruption was
  not reproduced after restoring the note, so it is recorded as test-fixture
  contamination rather than a confirmed product defect.
- `Open / Add` on a deliberately missing/suspended fixture card showed the
  expected safety notice and did not create a replacement card or queue item.
  The suspended source mappings were left unchanged.
- The fresh annotation `CXV4B9RF` is disposable R8 fixture data and remains
  only in the isolated Zotero profile and `.scaffold/r8-vault`.

**R8-02 status update (2026-10-29):** after the initial window mismatch, the
user saved/exited the everyday Zotero. The isolated process was relaunched with
the expected profile/data arguments, and the visible UI title identified the
disposable fixture. The Zotero restart test below is accepted as isolated. No
Zotero UI action was taken against the everyday profile after the mismatch was
detected. Earlier read-only checks do not establish whether prior state
changed, so this update does not claim the ordinary profile was untouched
before testing paused.

## Release Decision

**Not approved for release.** R8's scoped candidate-trial acceptance is
complete: three distinct same-day PDF-reader workflows, exact-artifact
reinstallation, fresh capture, and queued-work restart checks passed. The
product is not ready for publication until the remaining applicable gates are
passed or explicitly scoped out with the user's approval. At this report's
date, R4-C named non-member visibility, R5 pristine-profile onboarding, R6
two-device conflict/actual provider or network outage/1000-item host UI, and
R7 public updater endpoint validation remain open. The frozen implementation
commit is `0c74ea1`; this report-only follow-up must also be committed. Verify
release metadata, published package hashes, and installation/recovery
documentation against immutable release assets before publication.

Do not create a tag or publish release assets while any data-integrity or core
workflow blocker remains unresolved.
