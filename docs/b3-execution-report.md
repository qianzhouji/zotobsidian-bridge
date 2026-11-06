# B3 Execution Report: Reader Markdown Card

Date: 2026-11-02
Status: **B3 ACCEPTANCE COMPLETE.** After the user's computer restart, the isolated apps were relaunched, the exact installed candidate was verified, and the persisted in-flight request resumed. Reader quick-open was exercised while the companion was deferring a write for an open Markdown card; closing that card drained the request/response/ACK lifecycle. Minimum-boundary resizing was also checked live. No main-profile application or vault was opened.

## Isolation and Current State

- B3 Zotero is running as PID `6713` with `.scaffold/b3-isolated-profile` and `.scaffold/b3-data`.
- B3 Obsidian is running as PID `6853` with `.scaffold/b3-obsidian-profile` and `.scaffold/b3-vault`.
- The build artifact `.scaffold/build/b3-candidate-2026-11-02.xpi` and the XPI installed in `.scaffold/b3-isolated-profile/extensions/zotobsidian-bridge@qianzhouji.xpi` both have SHA-256 `7184ed692b77a5981347f47468a3bab613604222ba2bbc743688f592f295e2b7`.
- After relaunch, Obsidian reported `Zotero Bridge: connected`; its fresh heartbeat identified the expected B3 Vault ID `6db31eb9-c0d5-4b1c-828f-35644228256b` and vault path hash `672c52415ba664422c8b8d0752d752c3025b2da1b270dd9621471de5806c4cbf`.
- Persisted request `75338024-3092-475a-a662-118b7fccda3b` resumed after startup. The companion deferred its replace operation while `P02N01.md` was open in an Obsidian Markdown editor. Zotero's `Open / Add Obsidian card` action handed the existing card URL to Obsidian while that deferral was present; macOS displayed its normal `Open the obsidian link with Obsidian?` confirmation. Closing only the B3 `P02N01` tab allowed the companion to apply the request and emit an ACK. Obsidian returned to `connected`, and the request, response, and ACK directories were all empty after ACK collection.
- The B3 annotation folder still contains exactly `P02N01.md` and `P02N02.md`; the test card body, Markdown fixture, and local preview image remain present. No duplicate card was created and no note text was manually changed during this check.
- No operation was performed in `Main_Learning`, the everyday Zotero profile, or their queues.

## Implementation and Automated Checks

The Reader popup uses the shared `EditorSession`, a Markdown source editor, Preview mode, page/card identity, sync status, collapsible source context, an expanded editor, and an explicit Obsidian action. Preview preserves Markdown source. Local raster images are restricted to the card's Vault-contained `assets/` directory; remote, absolute, traversal, symlink, oversized, and unsupported resources are rejected. Raw HTML is inert and dangerous links are not rendered as active links.

The existing-card quick-open path was changed so it resolves the indexed card and launches its known path before waiting for serialized card-source refresh work. The refresh is still queued afterward; a path change is reopened when the refresh completes. New-card creation remains serialized. A smoke regression holds the card-operation queue with a controlled blocker and asserts that the existing card's URL launches before that blocker is released, then checks that source refresh completes.

| Check                                                                                        | Result                                                                               |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run build` after quick-open change                                                      | PASS; XPI SHA-256 `7184ed692b77a5981347f47468a3bab613604222ba2bbc743688f592f295e2b7` |
| `npm run verify:package`                                                                     | PASS                                                                                 |
| `npm run smoke:integration`                                                                  | PASS, including a blocked-queue quick-open regression                                |
| `npx tsc --noEmit`                                                                           | PASS                                                                                 |
| `npm run test:reader-popup-prototype`                                                        | PASS                                                                                 |
| `npm run test:editor-session`                                                                | PASS                                                                                 |
| Markdown preview, card format, companion protocol/safety/ownership and related focused tests | PASS                                                                                 |
| `npm run verify:release-config`                                                              | BLOCKED without release repository/tag environment variables; unrelated to B3        |

## Live Host Results

The package with SHA-256 `7184ed692b77a5981347f47468a3bab613604222ba2bbc743688f592f295e2b7` was installed in the isolated B3 profile and the isolated Zotero was restarted. On that exact build:

- Clicking the saved PDF highlight opened the Bridge popup.
- Inline Preview rendered headings, paragraphs, lists, and links; inline and display KaTeX formulas appeared once; the local PNG rendered.
- Expand opened the detailed editor. Its Preview rendered the same Markdown, formulas, and local image, and the session showed `已保存`.
- The B3 fixture body remained unchanged at SHA-256 `96be8bb56eb3ca5fb314a12ec3dbc3b49ff0126a932864aede7a0a340a9bc9cb`.
- The new quick-open implementation passed both the deterministic blocked-queue regression and a live B3 queue-contention check after restart. The persisted write remained deferred while the target note was active, the Zotero Reader action still handed off the card URL, and closing the card drained the transaction. macOS required its normal protocol confirmation before opening the Obsidian URL.

The earlier expanded-editor rendering defects were traced and repaired. The editor runs in an XUL/XML window: assigning rendered Markdown containing HTML void tags to its prefixed XHTML element caused tags to disappear or XML parsing to fail. The renderer now parses the fragment as `text/html` and imports its nodes into the target document. The expanded editor also lacks a global Zotero object; preview-image reads now go through a bridge closure in the Zotero main-window context while retaining Vault path, symlink, and size checks. Reader inline KaTeX needed the scoped `.katex-mathml` clipping rule to prevent duplicate MathML fallback text. The exact package above passed the live checks after these fixes.

| Acceptance item                                         | Status                    | Evidence / remaining work                                                                                                                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B3-01 Reader Markdown editing and preview               | PASS (live, exact build)  | Exact installed hash `7184ed…f295e2b7`; inline and expanded preview, block layout, KaTeX, and local PNG verified after isolated Zotero restart.                                                                                                                                        |
| B3-02 Expand/return and shared session                  | PASS                      | Earlier cross-surface edits appeared in both Reader and expanded editor; temporary markers were removed and the fixture returned to its baseline.                                                                                                                                      |
| B3-03 Popup sizing and minimum boundary                 | PASS (live, exact build)  | Dragged to the minimum size and beyond it. The popup stayed at its minimum without disappearing or corrupting its header, Edit/Preview controls, scroll area, source disclosure, saved status, or resize handle. Preview remained usable at the minimum.                               |
| B3-04 Preview security boundaries                       | PASS (automated)          | Tests cover inert HTML, unsafe links, remote/traversal paths, Vault containment, symlinks, size limits, and object-URL cleanup.                                                                                                                                                        |
| B3 companion pairing, restart recovery, and queue drain | PASS (live, post-restart) | Fresh heartbeat reported the expected Vault ID/path hash. Persisted request `75338024-3092-475a-a662-118b7fccda3b` resumed, deferred while the card was open, then completed and was ACK-collected after closing the tab; all three transaction directories are empty.                 |
| B3 Reader-to-companion write and exact ACK              | PASS (earlier live run)   | Request `e934d1c6-833b-404f-a5ae-b19432ddc8b1` received an `applied` response and matching ACK at `2026-11-02T09:12:02.290Z`, revision `f84dd5255af6589df61ffe9195530c32a4be918e2e278805b6965a5fda7d35ed`; queue was subsequently observed drained.                                    |
| Existing-card quick-open under queue contention         | PASS (automated and live) | Smoke test blocks the serialized queue and confirms URL launch before release. In the live test, the Reader action handed off the known card path while a real companion request was deferred; after the note closed, the queue completed. macOS showed its standard URL confirmation. |
| Zotero extension active in B3 profile                   | PASS (post-restart)       | Permanent add-on ID `zotobsidian-bridge@qianzhouji` was enabled. Current on-disk XPI hash matches the built artifact exactly.                                                                                                                                                          |

The isolated fixture card is `.scaffold/b3-vault/B2 Test Literature/R2 真实界面验收文献（中文标题） (user-0-68Z229Q9)/Annotations/P02N01.md`; its local preview asset is in the adjacent `assets/` folder. These are test fixtures, not user-library content. Both B3 isolated apps remain running; the user's primary applications and vaults were not touched.
