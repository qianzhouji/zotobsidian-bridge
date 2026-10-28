# R4-C Execution Report

## Implemented

- Added persistent, opt-in automatic enrollment rules for whole libraries,
  collections, tags, and collection/tag intersections.
- Collection descendants are opt-in. Overlapping rules and duplicate Zotero
  notifications are deduplicated by library ID and annotation key.
- New saved annotations are observed through Zotero's item notifier and use the
  existing idempotent card creation/update path.
- Added a preferences UI for choosing scopes, previewing matching annotation
  counts, enabling/pausing enrollment, importing historical annotations,
  resuming/cancelling a batch, and retrying automatic failures.
- Historical batches persist candidate IDs and cursor after every item.
  Interrupted batches pause on restart; automatic queue items are retained and
  resume only when the feature is enabled and unpaused.
- Rule changes do not delete cards. Historical backfill is not triggered by
  saving a rule and requires a separate count preview and confirmation.
- Replaced the browser-global `AbortController` dependency in historical import
  and selected-annotation batches with a local cancellation token; the Zotero
  plugin context used for live acceptance does not define that global.

## Verification

- `npm run test:auto-enrollment`: scope semantics, cross-library exclusion,
  overlapping-rule deduplication, invalid-config rejection, the production
  100-item runner's cancellation/restore/resume behavior, and failed-item
  pause/retry with exactly-once successful processing.
- `npx tsc --noEmit`, ESLint, Prettier, `git diff --check`, companion protocol,
  image-resource, native-note, and integration smoke tests passed during R4-C
  implementation. The plugin build passed with a temporary Node 25
  compatibility shim for the scaffold's unsupported `styleText('grey')` alias;
  the shim is local and not part of the product.
- In the isolated profile, a real saved highlight in the selected collection
  generated exactly one Markdown card via notifier and companion. Its page,
  color, Zotero URI, and source identity were correct; the automatic queue
  returned to zero.
- A saved highlight on a separate top-level fixture outside the selected
  collection created no card or queue entry. An earlier attempted negative
  sample was another attachment of the in-scope paper and was correctly
  enrolled; it was not counted as the negative case.
- With enrollment disabled, the scoped preview found six annotations, all
  already indexed. The persisted historical batch resumed after an isolated
  Zotero restart and completed 6/6 without duplicate card IDs.
- The unavailable-group-library path returned `Zotero library 77 is
unavailable`; no history batch was created.
- **Live batch cancellation and resume (2026-10-28):** a dedicated isolated
  Zotero PDF held 100 synthetic cancellation annotations plus one original
  annotation. The historical import contained 108 annotations across the
  configured test scope. The visible Cancel control paused it at 48/108 with 60
  remaining; Continue resumed from that cursor and completed 108/108. The
  dedicated fixture folder contains 101 annotation cards (the original plus
  100 synthetic annotations). Across the active test Vault, all 119 annotation
  Markdown files had distinct `bridge_source_id` values; no duplicate source
  IDs were found. Companion returned to `connected`; Zotero showed 0 pending,
  0 running, 0 conflicts, and one pre-existing retry for unavailable
  `group:77/annotation/ANN001`.
- **Permission-denial error path (2026-10-28):** the isolated Zotero JavaScript
  runner temporarily presented library 1 as an available group-library
  metadata object while making `Zotero.Items.getAll(1, ...)` throw an injected
  read-permission error. The real Preferences preview UI displayed
  `Could not read R4-C Read-Restricted Group Fixture (library 1); no batch was
created.` The completed 108/108 batch remained unchanged. Runtime patches were
  restored, the paper title restored, the temporary whole-library scope
  removed, and automatic enrollment left off.
- The everyday Zotero profile and personal Vault were not used.

## Permission Model Closeout (2026-10-28)

- Rechecked the isolated Preferences window in `.scaffold/profile`. The
  enrollment library field showed `My Library (user)`; automatic enrollment was
  off, no scope was selected, and the status remained 0 pending / 0 running.
  The pre-existing unavailable `group:77` retry was not retried or changed.
- Closed Preferences without changing settings and inspected the isolated
  Zotero main library pane. It showed `My Library` and no group-library entry.
  This confirms the current profile has no selectable group library, but not
  that a particular private group's non-member visibility was tested.
- No named private-group/non-member fixture is configured in this isolated
  account. This live check therefore confirms the current account has no
  selectable group library; it is not reported as a test against a specific
  private group.
- Zotero's documented group model separates library reading visibility
  (anyone on the internet or group members) from editing (any group member or
  only group admins). Group roles are regular member, administrator, and owner;
  there is no supported member role that can see a library while being denied
  item reads. A read-only editing configuration still permits reading. See
  [Zotero Groups](https://www.zotero.org/support/groups).
- Accordingly, the exact “visible group library, denied item/collection reads”
  account-ACL case is not constructible through standard Zotero group settings.
  The fail-closed Preferences error path remains covered by the earlier
  controlled runtime fault injection; it is explicitly not called a real ACL
  test. The named non-member visibility check is still pending because this
  environment has no private group owned by another account and no separate
  isolated login that is not a member of that group.

## Final Isolated State

- Automatic enrollment: off.
- Configured scopes: zero.
- Historical batch: completed, 108/108, zero remaining.
- Obsidian companion: connected.
- Zotero sync queue: zero pending, zero running, zero conflicts; one pre-existing
  retry remains for unavailable group library 77 and was not manually retried.
- The two empty `Annotations` directories that initially blocked the batch were
  moved, without deleting them, into `.scaffold/r4c-empty-folder-backup/`.
- Synthetic annotations and generated cards remain in the isolated test
  profile/Vault as acceptance fixtures; no personal data was changed.

## Known Limits

- The permission-denial UI handling and “no batch created” guarantee passed via
  controlled runtime fault injection. The isolated account exposes My Library
  only and has no named non-member group fixture. Zotero's supported group
  permissions do not include a member-visible/read-denied state, so a real
  member-level read-denial ACL test is not applicable to the standard Zotero
  permission model. Do not report the injection as a real ACL test. The live
  non-member visibility check still requires a private test group owned by a
  different account and a separate isolated Zotero login that is not invited.
- Impact preview counts matching annotations and estimates new cards from the
  bridge index; cards discovered outside that index can make the estimated-new
  count conservative.
- Historical work is represented as one resumable batch at a time and is not
  automatically started after application restart.
