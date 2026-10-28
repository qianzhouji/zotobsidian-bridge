# R7 CI, Installation, and Release Execution Report

**Status: IN PROGRESS.** Local CI-equivalent verification, paired artifact
generation, isolated Zotero lifecycle, and a real R7 companion request/response/
ACK cycle pass. The project repository and permanent plugin IDs are now
configured locally; remote CI, release distribution checks, and validation of
the selected IDs in clean app profiles remain open. R6 remains incomplete as recorded in
[`r6-execution-report.md`](r6-execution-report.md).

## Baseline and Safety

- Project checkout: `/Users/yuke/Desktop/code/zotero-obsidian-bridge`
- Current branch: `main`; HEAD at start: `a9d4e59`
- Configured `origin`: `https://github.com/qianzhouji/zotobsidian-bridge.git`
- The project-owned GitHub repository is private; no project code has been
  pushed to it yet.
- No push, tag, public release, ordinary Zotero profile, or primary Obsidian
  Vault was modified for this R7 work.
- Current package version: `0.1.0`; selected Zotero add-on ID is
  `zotobsidian-bridge@qianzhouji`; selected Obsidian plugin ID is
  `zotero-card-bridge`. Repository and homepage metadata point to the project
  repository. The earlier R7 live packages used development IDs, so the
  selected IDs still require fresh-profile validation.
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
  to the project repository. The repository is connected locally but no code
  has been pushed, so the Actions workflow has not been run remotely.

## Acceptance Results

| Check                                                       | Status                                      | Evidence                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean locked install, root and companion                    | PASS (local)                                | Clean disposable checkout; Node 24.22.1, npm 11.11.0; `npm ci` and `npm --prefix obsidian-plugin ci` succeeded.                                                                                                                                                                                                                                                     |
| Lint, builds, integration and focused regression matrix     | PASS (local; paired selected-ID write open) | `npm run lint:check`, both builds, automated suites, package audit, release preflight, and artifact preparation pass locally; permanent-ID paired write remains open.                                                                                                                                                                                               |
| Full dependency audit                                       | PASS (local)                                | `npm audit` and `npm --prefix obsidian-plugin audit` both report zero vulnerabilities. CI now runs both full audits as blocking checks.                                                                                                                                                                                                                             |
| Third-party license inventory and package notices           | PASS (local)                                | Generated `THIRD_PARTY_NOTICES.txt` inventories licenses for 39 shipped Zotero runtime packages and is included with the project `LICENSE` in the XPI. The companion ZIP includes the AGPL license text. `license-checker`'s `UNLICENSED` result for the private npm package is a scanner artifact; metadata and package contents were inspected. Not legal advice. |
| Package contents, paired versions, and hashes               | PASS (local)                                | `verify:package` and `prepare:release` passed. XPI SHA-256: `e265d2e7c0f0b3c48088f1519b458aaf4319e07884ef55651ef1602b03350571`; companion ZIP SHA-256: `dce52d1fb807821b2c49dfce802f3de7052bc8c717799585cf6a18650aba3a1d`. Artifacts are internal `0.1.0` test packages, not releases.                                                                              |
| Fresh isolated Zotero instance launch                       | PASS                                        | Process 90768 arguments point to `.scaffold/r7-retry-profile` and `.scaffold/r7-retry-data`; the separate Zotero UI was reached and operated.                                                                                                                                                                                                                       |
| Release identity, tag, and license preflight                | PASS (local and fixtures)                   | The actual `qianzhouji/zotobsidian-bridge` metadata passed with `v0.1.0`; fixtures accepted valid metadata and rejected placeholder/invalid IDs, repository mismatch, tag mismatch, and license mismatch.                                                                                                                                                           |
| Isolated Zotero install/upgrade/disable/uninstall/reinstall | PASS (development ID)                       | Installed XPI 0.1.0, installed a local synthetic 0.1.1 upgrade, disabled/re-enabled it, uninstalled, then reinstalled 0.1.0. A test PDF annotation produced card `d03bfe45-eb34-4a6b-8f55-a48c1ba1bc31`; its Markdown body and identity remained intact. Permanent Zotero ID install/pairing remains open.                                                          |
| Permanent-ID companion lifecycle                            | PASS (isolated)                             | In `.scaffold/r7-vault`, `zotero-card-bridge` installed/enabled, disabled/re-enabled, replaced with a synthetic 0.1.1 build while preserving the settings hash, restored to actual 0.1.0, then uninstalled and reinstalled. The current ID is enabled at 0.1.0.                                                                                                     |
| Companion path-setting edit behavior                        | PASS                                        | In the isolated R7 settings page, typed `/tmp/r7-queue-typed-only` while the field remained focused. The persisted setting stayed on `.scaffold/r7-queue`, and no temporary queue directory was created. The queue setting was restored and rechecked; only the R7 Vault was used.                                                                                  |
| Paired real request/response/ACK                            | PASS (isolated live; development IDs)       | Isolated Zotero used the same queue path and Vault ID as the companion, with output folder `Zotero Literature`. Creating annotation `M4ZS4ULX` produced card `9a749270-e547-45d5-8eaa-4d3fda499a6b` in the R7 Vault; Obsidian opened it and showed the expected source text and metadata. Repeat with selected permanent IDs before release.                        |
| Remote GitHub Actions                                       | NOT RUN                                     | `origin` points to the project repository; the reviewed project tree still needs its initial push, followed by a run on GitHub-hosted runners.                                                                                                                                                                                                                      |
| `git diff --check`                                          | PASS                                        | Ran against the project checkout after implementation.                                                                                                                                                                                                                                                                                                              |

The local clean-checkout run also passed the service-level R6 stress test; it
does not change the separate R6 live items. Its 1000-item result is not a
Zotero host UI benchmark.

## Remaining R7 Work

1. Push the reviewed project tree to the configured private GitHub repository
   and run Actions from a clean checkout; retain the run URL, commit SHA,
   artifacts, and checksums.
2. Revalidate paired request/response/ACK with the selected permanent Zotero
   ID and companion ID in disposable profiles/Vaults. The companion lifecycle
   itself is accepted, but the existing real write/ACK used the earlier
   development IDs.
3. Before public distribution, decide repository visibility and verify the
   updater manifest, release assets, license notices, and install/recovery
   documentation against the public release.

R4-C's private-group visibility check, R5's pristine-profile walkthrough, and
R6's two-device conflict, real provider/network outage, and 1000-item host UI
cases remain independent open acceptance items. Starting R7 does not close
them.
