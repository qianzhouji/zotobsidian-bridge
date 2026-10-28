# Packaging and Release

## Local package

Use the pinned Node.js version, install both dependency sets, then build and
audit the paired Zotero and Obsidian artifacts:

```sh
npm ci
npm --prefix obsidian-plugin ci
npm run build
npm run build:obsidian
npm run smoke:integration
npm run test:companion-protocol
npm run verify:package
npm run prepare:release
```

The versioned XPI, Obsidian companion ZIP, and their SHA-256 files are written
to `.scaffold/release/`. Obsidian's `main.js` and manifest are staged in
`.scaffold/obsidian-plugin/`. Build output, local test data, and release
artifacts are ignored by Git. The XPI audit checks archive paths, required
runtime files, version and Zotero compatibility metadata, license text,
third-party notices, and rejects development/test files and local absolute
paths. The companion archive contains `main.js`, `manifest.json`, and the
project `LICENSE`.

## Current release gate

The current XPI is an internal test artifact, not a public release. The
configured project repository is
[`qianzhouji/zotobsidian-bridge`](https://github.com/qianzhouji/zotobsidian-bridge),
currently private, with Zotero ID `zotobsidian-bridge@qianzhouji` and Obsidian
ID `zotero-card-bridge`. No Git tag or GitHub Release has been created. Keep
generated updater metadata unpublished until the project is ready for a public
release and the repository/update assets are accessible to intended users.

The GitHub Actions workflow runs locked dependency installation for both
plugins, formatting and lint checks, TypeScript/build checks, the focused
protocol, resource, migration, lifecycle, and R6 stress suites, and paired
package auditing. It uploads both artifacts for 14 days. A successful CI run
does not constitute paired-app host acceptance. Tagged releases have a
separate preflight that rejects placeholder repository metadata or IDs,
requires the Zotero and Obsidian versions to match, and requires the pushed
`v<version>` tag to match the package version exactly.

## Installation and upgrade test

Install only in the isolated Zotero development profile until the release gate
is cleared:

1. Start the project-local Zotero instance as described in
   [development setup](development-setup.md).
2. In Zotero, open **Tools → Add-ons**, use the add-on menu to install an add-on
   from a file, and select the versioned XPI.
3. Restart Zotero if requested. Confirm the add-on loads, preferences open,
   and a disposable test annotation creates and edits a Markdown card in the
   isolated test vault.
4. Install the next test XPI over the prior test build. Confirm the card UUID,
   source mapping, title, user notes, drafts, and pending sync tasks remain
   intact.
5. Uninstall the test add-on and confirm the Markdown files remain readable in
   Obsidian. Do not delete the test profile until recovery artifacts have been
   inspected.

The manual Zotero install/upgrade/disable/uninstall/reinstall sequence passed
in the isolated R7 profile using the earlier development add-on ID. The current
Obsidian companion ID's install, enable/disable, synthetic in-place upgrade,
uninstall, and reinstall lifecycle passed in `.scaffold/r7-vault`; paired live
write/ACK still needs repeating with both permanent IDs. The XPI manifest currently
targets Zotero 10.0.x; Zotero 10.0.6 is the locally recorded development
baseline. macOS is the only platform in the current hands-on development
baseline; Windows and Linux compatibility is not yet claimed.

The R7 live Zotero installation and paired write used the earlier development
IDs `zotero-obsidian-bridge@local.dev` and `zotero-obsidian-bridge`. The
permanent Obsidian ID lifecycle was subsequently verified independently. Do
not treat the development-ID installation as an in-place upgrade or delete its
recovery data until it has been inspected.

Install the companion ZIP only into a disposable Obsidian Vault. Extract
`main.js`, `manifest.json`, and `LICENSE` into
`<test-vault>/.obsidian/plugins/zotero-card-bridge/`, reload Obsidian, and
enable the community plugin. Configure the same output folder and local queue
directory in both plugins before selecting companion writer mode in Zotero.
The dual-app acceptance matrix is in [the companion protocol](companion-protocol.md).

## Data and recovery

Cards are ordinary Markdown files in the chosen vault and remain after plugin
uninstall. The plugin index, retry queue, editor drafts, and recovery copies are
stored under Zotero's data directory. Back up the Zotero profile and the vault
before testing schema migrations or downgrades. Do not downgrade by replacing
the XPI unless the migration procedure for that pair of versions is documented.

See [card and storage format](card-format.md) for field ownership and recovery
details, and [manual workflow](manual-workflow.md) for user-facing behavior.
