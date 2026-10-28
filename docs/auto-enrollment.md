# Scoped Automatic Enrollment

## Scope Rules

- Automatic enrollment is disabled by default.
- Each rule targets one Zotero library. Separate rules are combined as a union.
- Multiple selected collections in one rule are a union; multiple selected tags
  are a union. When both collections and tags are selected in one rule, the
  item must match at least one selected collection and at least one selected
  tag.
- Subcollection membership is excluded unless the rule explicitly enables it.
- Annotation scope is evaluated against the parent bibliographic item, or the
  standalone PDF attachment when it has no parent.
- Saving or changing rules affects future annotation additions only. It never
  deletes cards and never silently backfills existing annotations.
- Historical import is a separate explicit action. The matching count and an
  estimate of currently unindexed cards are shown before confirmation.

## Durable State

Selected rules are stored as JSON in the Zotero preference `autoEnrollment`,
using schema version `1`. Queue and batch state are stored at
`<Zotero data directory>/storage/zotero-obsidian-bridge/auto-enrollment-state.json`
with flush and temporary-file replacement.

The state contains a pending automatic queue, an in-progress item, retryable
failures, and at most one historical batch. Item identity is `(libraryID,
annotation key)`. The historical cursor is persisted after every successful
item. On Zotero startup, an interrupted automatic item is returned to the
queue, while an interrupted historical batch is marked paused and waits for an
explicit resume. Reprocessing is safe because the existing card identity and
source-update path are reused.

The companion request protocol does not change: both writer modes reuse the
existing card write path. A companion timeout remains visible through the
existing pending-request UI and is recorded as a retryable task.

## Failure and Permission Behavior

Historical scope scanning completes before any batch is created. If Zotero
cannot read a selected library, the scan fails with the library name and no
Vault writes are started. Automatic failures are retained for inspection and
manual retry. Disabling enrollment stops accepting new automatic work; pending
items remain visible and are not discarded. Pausing holds queued automatic
items without deleting them.

The historical batch is a snapshot of annotation IDs from the confirmed scan.
Changing or removing a rule does not cancel that batch or delete cards already
created; use the batch controls to cancel it explicitly. Cancellation takes
effect after the current annotation operation settles, and the cursor advances
only after that operation succeeds. A failed item pauses at that item so retry
does not skip it. Card creation is idempotent, covering a crash after the card
write but before the cursor is persisted.
