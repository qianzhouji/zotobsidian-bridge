# Obsidian Companion Protocol

Protocol version 2 coordinates Markdown writes between the Zotero add-on and
the Obsidian companion on one machine. It is not a multi-device sync protocol.

## Queue Layout

Configure the same absolute local directory in both applications. The bridge
uses four subdirectories:

- `requests/<requestId>.json`: durable Zotero write requests.
- `responses/<requestId>.json`: Obsidian acknowledgements or conflicts.
- `acks/<requestId>.json`: Zotero acknowledgement that it consumed a response.
- `payloads/<requestId>.bin`: immutable binary payload for a resource request.
- `.zotero-obsidian-bridge-owner.json`: exclusive Obsidian queue-consumer owner.

The queue must be outside the Vault and should not be cloud-synced. Obsidian
keeps both request and response until Zotero acknowledges the response. A
request without a response is retried on later polls, including after Obsidian
restarts. Zotero polls for late responses after its foreground operation times
out; it persists annotation-source reconciliation before writing the ACK, so a
restart between response receipt and indexing does not discard the recovery
work. Only then does Obsidian collect the request/response/ACK triplet.

The owner file makes queue consumption single-writer across Obsidian instances.
The first paired instance obtains it with exclusive file creation; other
instances show an ownership status and do not process requests. Normal plugin
unload releases the lock. If Obsidian crashed and its recorded PID no longer
exists, one contender coordinates stale-lock recovery before claiming
ownership. An unreadable owner file or abandoned recovery marker fails closed;
after confirming no Obsidian instance is using the queue, remove the stale
`.zotero-obsidian-bridge-owner.json` and/or its `.reclaim` marker, then retry.
Do not remove a live owner's file to force two consumers.

## Request Contract

Markdown requests include `protocolVersion`, unique `requestId`, `createdAt`,
`operation` (`create` or `replace`), registered `cardId` and `sourceId`, the
target Vault ID, configured `outputFolder`, a Vault-relative Markdown
`relativePath`, a `baseRevision`, and complete new `content`. Replace requests
also include a recovery path/content pair.

`create-resource` requests use the same identity and Vault pairing fields, but
carry no Markdown body. They specify a Vault-relative resource path, MIME type,
SHA-256, and byte length; the matching bytes live in `payloads/<requestId>.bin`.
Only raster images (PNG, JPEG, GIF, WebP, BMP) up to 20 MiB are accepted. The
destination must be under the configured output folder and an `assets`
directory, and the filename must include the content hash. Obsidian validates
the byte count, format, decoded image, MIME type, and hash before creating the
file. Re-delivery succeeds only when the existing file has the same hash.
Resource requests cannot replace or delete files.

The companion rejects absolute paths, traversal, paths outside the configured
output folder, non-Markdown targets, mismatched frontmatter identities,
malformed requests, and stale base revisions. Paper overview notes use the
stable `<library>/paper/<itemKey>` identity. Annotation cards use their UUID
and Zotero library/annotation source identity.

Each Obsidian Vault generates a persistent pairing ID. Copy it into Zotero's
companion settings. Requests carrying a different ID are rejected before any
Markdown write.

The companion status bar distinguishes an idle connected queue, pending
requests, a note deferred because it is open, an outstanding Zotero ACK,
conflicts, and ownership by another Obsidian instance. Conflict details are
available as the status item's tooltip and are returned to Zotero in the
response. The command palette includes **Copy Zotero Bridge Vault pairing ID**.

Version 2 is not wire-compatible with version 1. Before upgrading either app,
drain the local queue, then upgrade both the Zotero add-on and Obsidian plugin.
The pairing ID is stored in Obsidian plugin data and Zotero preferences; keep
the same Vault and ID when upgrading.

## State Transitions

- `create`: succeeds only if the target is absent, or is already byte-for-byte
  the same note with the same identity.
- `create-resource`: verifies and creates a content-addressed binary resource
  before Zotero submits Markdown that references it. Existing identical bytes
  are treated as idempotent; conflicting or invalid data is rejected.
- `replace`: checks the SHA-256 base revision, checks identity, creates a
  recovery copy, then uses `Vault.process()` to re-check and apply the update.
- Open in Obsidian editor: leave the request pending. Once closed, re-check the
  revision. If the user saved edits, report a conflict rather than replacing
  them.
- Obsidian offline: keep the request file for restart recovery. Zotero reports
  pending after 1.5 seconds and does not switch writers.
- Writer transition: Zotero enters a fail-closed transition state, waits for
  in-flight file writes and all request files to be acknowledged and collected.
  It restores the old mode if the queue does not drain within ten seconds. It
  never silently flips writers with queued requests. Change queue/output
  settings only in direct mode.
- Duplicate delivery: request IDs and deterministic file identity prevent a
  repeated create; replacement recognizes already-applied content and is
  revision checked.

`Vault.process()` serializes a read/modify/write against Obsidian's file state;
the editor-open guard and content revision check are separate protections.
This protocol does not claim a cross-device transaction or a global lock
against simultaneous user actions.

## Manual Acceptance Still Required

Use an isolated test Vault and local queue. Test Obsidian closed/reopened,
duplicate delivery, request and app restarts, the same note open with unsaved
typing, a saved edit before a delayed source update, a moved note, and toggling
writer modes with both empty and pending requests. Confirm both the visible editor and
disk contents after each scenario.
