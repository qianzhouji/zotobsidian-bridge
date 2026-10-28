# Development Setup

## Local baseline

- macOS with Zotero 10.0.6 and Obsidian 1.14.4
- Node.js 24.22.1 (LTS) and npm 11.11.0
- Git 2.54.0
- Plugin template commit `306d4e2a0959a7b2f5e44bb38169fb25f841dbaf`
- Scaffold and Zotero type declarations require Node.js `>=22.8.0`

Use the project-pinned Node LTS version. The machine's default Node 25.8.1 is
outside maintenance support and triggers an upstream scaffold color-format
exception, so build and serve with Node 24.22.1.

## Isolation

The development server runs Zotero with both `.scaffold/profile` and
`.scaffold/data`. The latter is passed as Zotero's explicit `--dataDir`; it must
never be blank. Keep the real profile and the normal Zotero data directory
closed to the test instance. The test vault is `.scaffold/test-vault` and is
separate from the Obsidian learning vault.

`ZOTERO_PLUGIN_KILL_COMMAND` points to `scripts/stop-test-zotero.mjs`. It only
matches the Zotero process when its executable, profile path, and data path all
match these project-local test locations. Do not replace this with `pkill
zotero` or the template's broad macOS default.

`ZOTERO_PLUGIN_ZOTERO_BIN_PATH` points to the project launcher script. It
removes a stray bare `no-remote` argument added by the current scaffold release,
then executes the real Zotero binary from `BRIDGE_ZOTERO_PROCESS_BIN_PATH`.

## Install and run

1. Copy `.env.example` to `.env` and set the local absolute paths, including the
   project launcher and real Zotero executable.
2. Install the exact dependency graph with `npm ci`.
   Install the companion toolchain separately with
   `npm --prefix obsidian-plugin ci`.
3. Run `npm start`; the scaffold creates the isolated profile and starts the
   test instance with remote debugging enabled.
4. Use the Zotero test instance to import only test PDFs. In the plugin
   preferences, the test vault path is preconfigured by the development server.
   Generate the reproducible two-page annotation fixture with
   `npm run fixture:r2`; it is written to `.scaffold/r2-fixtures/` and is
   excluded from the release package.
5. Run `npm run smoke:integration` to exercise the annotation, sync, editor,
   historical-import, and regression workflows against
   fake Zotero objects and disposable fixtures, including notifier-driven sync,
   retry, deletion, and restart recovery. It only resets
   `.scaffold/smoke vault 测试 (#1)` and `.scaffold/test-data`; it does not touch
   the configured test vault or Zotero test database.
6. Run `npm run build:obsidian` and `npm run test:companion-protocol` for the
   companion bundle and protocol checks. For live testing, use a separate
   disposable Obsidian Vault; never enable development builds in the learning
   Vault.
7. Stop the development server with Ctrl+C. Confirm that the ordinary Zotero
   process remains open.

The `.env` file, profile, database, build output, and test vault are local-only
and are excluded from version control.
