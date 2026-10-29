# R7 CI, Installation, and Release Execution Report

**Status: IN PROGRESS.** Local CI-equivalent verification, paired artifact
generation, isolated companion lifecycle, and a real paired request/response/
ACK using both selected permanent IDs pass. The remaining R7 work is safe
reconciliation of the disconnected local and remote Git histories, review of
the Zotero settings-pane rendering issue, and release preparation. R6 remains
incomplete as recorded in
[`r6-execution-report.md`](r6-execution-report.md).

## Baseline and Safety

- Project checkout: `/Users/yuke/Desktop/code/zotero-obsidian-bridge`
- Local branch: `main`; local HEAD at start: `a9d4e59`
- Configured `origin`: `https://github.com/qianzhouji/zotobsidian-bridge.git`
- The project-owned GitHub repository is private. The project tree was uploaded
  to its `main` branch through the authorized GitHub integration as commit
  `299a09d3ceec5dc0d6e9dc31913dd2560bebe9dd`.
- `git fetch origin main` now succeeds. It fetched remote `main` at
  `35af6e31dbde7c65da16332b5c8cba42311c0738`; local `main` remains at
  `a9d4e59`. `git rev-list --left-right --count main...origin/main` reports
  `412 4`, and `git merge-base main origin/main` finds no common ancestor.
  These are disconnected histories, not a fast-forward situation. No merge,
  reset, rebase, or push was attempted; preserve the working tree and choose an
  explicit history-reconciliation strategy before syncing. Do not treat local
  `HEAD` as the remote CI commit.
- No tag, public release, ordinary Zotero profile, or primary Obsidian Vault
  was modified for this R7 work.
- Current package version: `0.1.0`; selected Zotero add-on ID is
  `zotobsidian-bridge@qianzhouji`; selected Obsidian plugin ID is
  `zotero-card-bridge`. Repository and homepage metadata point to the project
  repository. Both selected IDs have now been installed/activated in isolated
  R7 app instances and used for a real paired write/ACK.
- The first R7 launch used `.scaffold/r7-profile` and `.scaffold/r7-data`, but
  no window was visible and the profile contained `.startup-incomplete`. The
  exact cause was not proven. The retry used explicit `--dataDir` with fresh
  `.scaffold/r7-retry-profile` and `.scaffold/r7-retry-data`; the live process
  arguments confirmed both isolated paths, and the user confirmed that a
  separate Zotero window appeared. The first-run Zotero welcome page also
  opened in the browser. The new Zotero window was subsequently inspected and
  operated directly; the separate Obsidian `.scaffold/r7-vault` was opened in
  its own window. The existing `test-vault` and primary Vault were not edited
  during this R7 lifecycle run.

## Implementation

- Expanded `.github/workflows/ci.yml` to install both locked dependency sets,
  audit all dependencies, run lint/build and the focused annotation,
  protocol, note, image, enrollment, diagnostics, companion lifecycle, and R6
  stress suites, audit paired packages, and upload checksummed artifacts.
- Added `scripts/verify-release-config.mjs` and a tag-workflow preflight for
  repository identity, non-placeholder IDs, desktop-only companion metadata,
  aligned Zotero/companion versions and license metadata, the root license file,
  and an exact `v<package-version>` tag match. Repository URL normalization
  accepts both `https://...git` and `git+https://...git`. The guard fails
  closed and validates Obsidian ID syntax. It does not reserve an ID or replace
  the separate live registry check.
- Added `scripts/test-release-config.mjs` to exercise a valid configuration and
  negative repository, tag, placeholder-ID, and license cases in a disposable
  temporary fixture; the test is part of the CI matrix.
- `prepare-release.mjs` rejects mismatched Zotero package, companion package,
  and Obsidian manifest versions.
- Companion queue and output-folder settings now commit on blur or Enter rather
  than on every keystroke, so the queue poller cannot observe a partially typed
  path.
- Declared `AGPL-3.0-or-later` in the companion package metadata to match the
  repository's existing root license. The package is private and is not
  published to npm.
- `origin`, `repository`, `homepage`, and the Zotero updater fallback now point
  to the project repository. The reviewed tree is on the private remote and
  GitHub Actions has completed successfully; remote evidence is recorded below.

## Acceptance Results

| Check                                                       | Status                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean locked install, root and companion                    | PASS (local)                       | Clean disposable checkout; Node 24.22.1, npm 11.11.0; `npm ci` and `npm --prefix obsidian-plugin ci` succeeded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Lint, builds, integration and focused regression matrix     | PASS (local)                       | `npm run lint:check`, both builds, automated suites, package audit, release preflight, and artifact preparation pass locally.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Full dependency audit                                       | PASS (local)                       | `npm audit` and `npm --prefix obsidian-plugin audit` both report zero vulnerabilities. CI now runs both full audits as blocking checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Third-party license inventory and package notices           | PASS (local)                       | Generated `THIRD_PARTY_NOTICES.txt` inventories licenses for 39 shipped Zotero runtime packages and is included with the project `LICENSE` in the XPI. The companion ZIP includes the AGPL license text. `license-checker`'s `UNLICENSED` result for the private npm package is a scanner artifact; metadata and package contents were inspected. Not legal advice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Package contents, paired versions, and hashes               | PASS (local)                       | `verify:package` passed. Current test XPI SHA-256: `8cbdb2ffdd832da23ec678d6b6de683c68dedd462d8f59cdca0c5d18e7e73de2`; companion ZIP SHA-256: `dce52d1fb807821b2c49dfce802f3de7052bc8c717799585cf6a18650aba3a1d`. Artifacts are internal `0.1.0` test packages, not releases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Fresh isolated Zotero instance launch                       | PASS                               | Process 90768 arguments point to `.scaffold/r7-retry-profile` and `.scaffold/r7-retry-data`; the separate Zotero UI was reached and operated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Release identity, tag, and license preflight                | PASS (local and fixtures)          | The actual `qianzhouji/zotobsidian-bridge` metadata passed with `v0.1.0`; fixtures accepted valid metadata and rejected placeholder/invalid IDs, repository mismatch, tag mismatch, and license mismatch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Isolated Zotero install/upgrade/disable/uninstall/reinstall | PASS (development ID lifecycle)    | The earlier lifecycle matrix installed XPI 0.1.0, exercised a synthetic 0.1.1 upgrade, disable/re-enable, uninstall, and reinstall. The selected permanent Zotero ID was separately installed and verified active in `.scaffold/r7-retry-profile`; `extensions.json` records `zotobsidian-bridge@qianzhouji`, version 0.1.0, `active: true`, and `userDisabled: false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Permanent-ID companion lifecycle                            | PASS (isolated)                    | In `.scaffold/r7-vault`, `zotero-card-bridge` installed/enabled, disabled/re-enabled, replaced with a synthetic 0.1.1 build while preserving the settings hash, restored to actual 0.1.0, then uninstalled and reinstalled. The current ID is enabled at 0.1.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Companion path-setting edit behavior                        | PASS                               | In the isolated R7 settings page, typed `/tmp/r7-queue-typed-only` while the field remained focused. The persisted setting stayed on `.scaffold/r7-queue`, and no temporary queue directory was created. The queue setting was restored and rechecked; only the R7 Vault was used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Paired real request/response/ACK                            | PASS (isolated live; selected IDs) | Zotero ID `zotobsidian-bridge@qianzhouji` and Obsidian ID `zotero-card-bridge` used queue `.scaffold/r7-queue` and matching Vault ID `d350bbc8-7c67-4dc7-a475-b49873ea109a`. Real annotation `TP8AZRBP` produced card `7b6272f0-b8b0-49c2-8189-c5f9969173a5` at `.scaffold/r7-vault/Zotero Literature/Zotero Obsidian Bridge R2 Test Fixture (user-0-B4XQYVRK)/Annotations/TP8AZRBP.md`; the note contains the expected page-2 excerpt and source metadata. Obsidian reported connected and the queue converged to no pending request/response/ACK files. ACK files are intentionally deleted after validation, so the round-trip is evidenced by the successful companion write and terminal queue cleanup, not by a retained ACK artifact; see `acknowledgeCompanionResponses()` and `collectAcknowledged()` in the implementation. |
| Remote GitHub Actions                                       | PASS                               | [Run #1](https://github.com/qianzhouji/zotobsidian-bridge/actions/runs/40728760703) succeeded for commit `299a09d3ceec5dc0d6e9dc31913dd2560bebe9dd`; the `verify` job passed. Artifact `zotero-obsidian-bridge-299a09d3ceec5dc0d6e9dc31913dd2560bebe9dd` (1,019,201 bytes) has digest `sha256:65288ed4500e59171d5a5bd7711af67225c2458f5615c0216d0a46c443ef56d2` and is retained until 2026-11-11. Linux-built XPI SHA-256: `01db56c080037620addedd4894a2291327b781661fe639c231024766ec351bdc`; companion ZIP SHA-256: `4e5c0533dfd5d9098ddeabd692844247d2cf188181a8b10f5ccc507a5a1c7a01`; embedded checksum files matched. No GitHub Release was created.                                                                                                                                                                             |
| `git diff --check`                                          | PASS                               | Ran against the project checkout after implementation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

The initial successful Actions run reported a non-blocking maintenance warning because
the selected official actions are currently on Node 20 while GitHub is moving
runners to Node 24, plus an Ubuntu 26 migration notice. The job itself passed;
these notices should be reviewed in a future workflow maintenance change.

The documentation update was committed as `5a6ae40db68d507a10ce710d1c4de43c3369cc5b`.
[Actions run #7](https://github.com/qianzhouji/zotobsidian-bridge/actions/runs/40730587766)
also passed on GitHub-hosted Linux in 54 seconds. Its artifact digest is
`sha256:fa2db40ca6e4c530793989913b47a6fb66310a2f5b18d7c09f142d764d1d90e8`.

The local clean-checkout run also passed the service-level R6 stress test; it
does not change the separate R6 live items. Its 1000-item result is not a
Zotero host UI benchmark.

## Remaining R7 Work

1. Reconcile the local checkout with remote `main`. Fetch now works, but
   `main` and `origin/main` have no common ancestor (`412` local-only and `4`
   remote-only commits by reachability). Preserve local changes and agree on a
   deliberate reconciliation plan before creating or pushing history.
2. Investigate why the Zotero add-on settings pane rendered without visible
   controls in this run. Pairing was completed by setting the Vault ID through
   the isolated Zotero Developer JavaScript console; the real paired write/ACK
   passed, but settings-pane usability was not accepted through the UI.
3. Before public distribution, decide repository visibility and verify the
   updater manifest, release assets, license notices, and install/recovery
   documentation against the public release.

R4-C's private-group visibility check, R5's pristine-profile walkthrough, and
R6's two-device conflict, real provider/network outage, and 1000-item host UI
cases remain independent open acceptance items. Starting R7 does not close
them.
