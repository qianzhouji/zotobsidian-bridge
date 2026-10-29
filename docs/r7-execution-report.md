# R7 CI, Installation, and Release Execution Report

**Status: IN PROGRESS.** Local CI-equivalent verification, paired artifact
generation, isolated companion lifecycle, and a real paired request/response/
ACK using both selected permanent IDs pass. Local and remote Git histories
have now been safely reconciled without rewriting remote history; the original
local history and pre-reconciliation working-tree snapshot remain available as
local backup branches. The Zotero settings pane has now been repaired and
verified in the isolated R7 profile. The repository is public. Remaining R7
work is publishing versioned release assets and validating the public update
endpoints. R6
remains incomplete as recorded in
[`r6-execution-report.md`](r6-execution-report.md).

## Baseline and Safety

- Project checkout: `/Users/yuke/Desktop/code/zotero-obsidian-bridge`
- Local branch: `main`; local HEAD at start: `a9d4e59`
- Configured `origin`: `https://github.com/qianzhouji/zotobsidian-bridge.git`
- The project-owned GitHub repository was private at the time of the initial
  upload; it is public now. The project tree was uploaded to `main` as commit
  `299a09d3ceec5dc0d6e9dc31913dd2560bebe9dd`.
- At reconciliation start, local `main` was `a9d4e59` and fetched remote
  `main` was `35af6e31dbde7c65da16332b5c8cba42311c0738`; they had no common
  ancestor (`412` local-only and `4` remote-only commits by reachability).
  The current local worktree was snapshotted to
  `backup/pre-reconcile-local-main-20261029`, the original local branch was
  preserved as `backup/main-legacy-20261029`, and local `main` was based on the
  remote history. Only the four updated progress documents were added as a
  follow-up commit; no remote history was rewritten. Final local `main` and
  `origin/main` both point to `8ae9bd4`, and the worktree is clean.
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
  to the project repository. The reviewed tree was on the remote, which is now
  public; GitHub Actions has completed successfully. Remote evidence is below.
- Fixed the empty Zotero preferences pane by declaring the XHTML namespace on
  each top-level fragment root in `addon/content/preferences.xhtml`. Added a
  package-audit guard requiring the preferences resource and those declarations.

## Acceptance Results

| Check                                                       | Status                              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean locked install, root and companion                    | PASS (local)                        | Clean disposable checkout; Node 24.22.1, npm 11.11.0; `npm ci` and `npm --prefix obsidian-plugin ci` succeeded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Lint, builds, integration and focused regression matrix     | PASS (local)                        | `npm run lint:check`, both builds, automated suites, package audit, release preflight, and artifact preparation pass locally.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Full dependency audit                                       | PASS (local)                        | `npm audit` and `npm --prefix obsidian-plugin audit` both report zero vulnerabilities. CI now runs both full audits as blocking checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Third-party license inventory and package notices           | PASS (local)                        | Generated `THIRD_PARTY_NOTICES.txt` inventories licenses for 39 shipped Zotero runtime packages and is included with the project `LICENSE` in the XPI. The companion ZIP includes the AGPL license text. `license-checker`'s `UNLICENSED` result for the private npm package is a scanner artifact; metadata and package contents were inspected. Not legal advice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Package contents, paired versions, and hashes               | PASS (local)                        | `verify:package` and `prepare:release` passed for version 0.1.0. Current XPI SHA-256: `5eeb233d49f80783b7a489fe238c44d2a51544324e3e7b352f0896ede9009b2c`; companion ZIP SHA-256: `c21bebde705bdf3abb0878cb97d632977ef6a902e61c5a824d061cfec5f19788`. Both archives contain the expected permanent IDs, matching versions, and licenses. They are local release candidates, not published releases.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Zotero preferences pane and pairing controls                | PASS (isolated live)                | Rebuilt and reinstalled the XPI in `.scaffold/r7-retry-profile`. The settings pane now renders the vault/output fields, writer mode, queue path, pairing ID, auto-enrollment controls, and sync actions. **Check setup** read the matching pairing and reported the companion online; its remaining message correctly requests Obsidian's Vault write-permission probe.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Update URL and generated updater manifest                   | CONFIGURED; remote endpoint pending | XPI `update_url` is `https://github.com/qianzhouji/zotobsidian-bridge/releases/download/release/update.json`. The generated 0.1.0 manifest points to the versioned XPI URL and includes its SHA-512. The repository is public, but has no tags or GitHub Releases; anonymous checks on 2026-10-29 returned HTTP 404 for both URLs because the release assets are not published.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Fresh isolated Zotero instance launch                       | PASS                                | The Zotero process used `.scaffold/r7-retry-profile` and `.scaffold/r7-retry-data`; it was restarted with the same isolated paths to test the rebuilt preferences pane.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Release identity, tag, and license preflight                | PASS (local and fixtures)           | The actual `qianzhouji/zotobsidian-bridge` metadata passed with `v0.1.0`; fixtures accepted valid metadata and rejected placeholder/invalid IDs, repository mismatch, tag mismatch, and license mismatch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Isolated Zotero install/upgrade/disable/uninstall/reinstall | PASS (development ID lifecycle)     | The earlier lifecycle matrix installed XPI 0.1.0, exercised a synthetic 0.1.1 upgrade, disable/re-enable, uninstall, and reinstall. The selected permanent Zotero ID was separately installed and verified active in `.scaffold/r7-retry-profile`; `extensions.json` records `zotobsidian-bridge@qianzhouji`, version 0.1.0, `active: true`, and `userDisabled: false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Permanent-ID companion lifecycle                            | PASS (isolated)                     | In `.scaffold/r7-vault`, `zotero-card-bridge` installed/enabled, disabled/re-enabled, replaced with a synthetic 0.1.1 build while preserving the settings hash, restored to actual 0.1.0, then uninstalled and reinstalled. The current ID is enabled at 0.1.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Companion path-setting edit behavior                        | PASS                                | In the isolated R7 settings page, typed `/tmp/r7-queue-typed-only` while the field remained focused. The persisted setting stayed on `.scaffold/r7-queue`, and no temporary queue directory was created. The queue setting was restored and rechecked; only the R7 Vault was used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Paired real request/response/ACK                            | PASS (isolated live; selected IDs)  | Zotero ID `zotobsidian-bridge@qianzhouji` and Obsidian ID `zotero-card-bridge` used queue `.scaffold/r7-queue` and matching Vault ID `d350bbc8-7c67-4dc7-a475-b49873ea109a`. Real annotation `TP8AZRBP` produced card `7b6272f0-b8b0-49c2-8189-c5f9969173a5` at `.scaffold/r7-vault/Zotero Literature/Zotero Obsidian Bridge R2 Test Fixture (user-0-B4XQYVRK)/Annotations/TP8AZRBP.md`; the note contains the expected page-2 excerpt and source metadata. Obsidian reported connected and the queue converged to no pending request/response/ACK files. ACK files are intentionally deleted after validation, so the round-trip is evidenced by the successful companion write and terminal queue cleanup, not by a retained ACK artifact; see `acknowledgeCompanionResponses()` and `collectAcknowledged()` in the implementation. |
| Remote GitHub Actions                                       | PASS                                | [Run #1](https://github.com/qianzhouji/zotobsidian-bridge/actions/runs/40728760703) succeeded for commit `299a09d3ceec5dc0d6e9dc31913dd2560bebe9dd`; the `verify` job passed. Artifact `zotero-obsidian-bridge-299a09d3ceec5dc0d6e9dc31913dd2560bebe9dd` (1,019,201 bytes) has digest `sha256:65288ed4500e59171d5a5bd7711af67225c2458f5615c0216d0a46c443ef56d2` and is retained until 2026-11-11. Linux-built XPI SHA-256: `01db56c080037620addedd4894a2291327b781661fe639c231024766ec351bdc`; companion ZIP SHA-256: `4e5c0533dfd5d9098ddeabd692844247d2cf188181a8b10f5ccc507a5a1c7a01`; embedded checksum files matched. No GitHub Release was created.                                                                                                                                                                             |
| `git diff --check`                                          | PASS                                | Ran against the project checkout after implementation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

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

1. Publish a versioned release and the stable `release` updater-manifest
   assets, then test both URLs without authentication and verify downloaded
   hashes against the local artifacts. The repository is already public; no
   tag or Release has been created.
2. Repeat the final install/recovery-documentation audit against those actual
   published assets. The local 0.1.0 archives are verified but not published.

R4-C's private-group visibility check, R5's pristine-profile walkthrough, and
R6's two-device conflict, real provider/network outage, and 1000-item host UI
cases remain independent open acceptance items. Starting R7 does not close
them.
