# C1 Note Query Protocol

This document describes the read-only protocol shared by the Zotero add-on and
the Obsidian companion. It is separate from the durable Markdown write queue:
queries never create cards, write notes, or return a write ACK.

## Transport and pairing

The protocol uses the paired local queue directory under `note-query/`:

- `capabilities.json` advertises protocol version, Vault ID, pairing epoch,
  enabled/ready state, allowed read folders, limits, and index generation.
- `requests/<requestId>.json` contains one validated query.
- `responses/<requestId>.json` contains the matching result or error.

The client checks the capability document before publishing and again before
accepting a response. A Vault ID or pairing-epoch mismatch rejects the result.
Search requests use a latest-wins channel; closing the client cancels its
in-flight requests. Expired, malformed, or cancelled requests are discarded.

Capability leases last 120 seconds to tolerate observed desktop background
timer throttling of roughly 60 seconds. Individual query messages remain
limited to 30 seconds; the client default is 3 seconds. The companion normally
refreshes the capability document every 5 seconds, and publishes a disabled
state when cleanly stopped.

## Operations

| Operation            | Input                                               | Result                                                                                                                    |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `search-notes`       | Query text, source note path, optional limit/cursor | Bounded paths, basenames, titles, and matching aliases; never whole-note bodies                                           |
| `resolve-link`       | Raw link target and source note path                | Canonical Vault-relative path, fragment, revision, and anchor state (`none`, `found`, `missing`, `ambiguous`, `indexing`) |
| `read-note`          | Canonical Markdown path                             | Saved Markdown, SHA-256 revision, read time, and revision-validated heading/block metadata                                |
| `read-note-resource` | Resource link and source note path                  | Bounded base64 bytes for PNG, JPEG, GIF, or WebP                                                                          |

Missing notes return `not-found`; resolving or reading a missing note does not
create it. Same-note anchors use the unsaved editor buffer locally and do not
need a service request.

## Limits and safety

- At most 4 concurrent requests per client; search is debounced by about 120 ms.
- Query text: 256 characters. Canonical path: 1,024 characters.
- Search: at most 50 results. Request: 16 KiB. Note body: 2 MiB.
- Resource: 5 MiB; response: 16 MiB; heading/block metadata: 4,096 entries.
- Paths must be canonical Vault-relative paths. Absolute paths, traversal,
  control characters, encoded path syntax, and symlink components are rejected.
- The configured read-folder allowlist is enforced for source and target paths.
  `.obsidian`, Trash, Recovery, Recovery Copies, and Bridge Recovery paths are
  excluded. No query path can relax the existing card `outputFolder` write
  restriction.
- Resource formats are detected from bytes; arbitrary file reads are not
  supported. Read results are not persisted as annotations or cards.

## Evidence and boundary

Protocol validators, cancellation/timeout cleanup, permissions, stale
responses, indexes, and anchor cases pass `npm run test:note-query`. A live
Obsidian companion test is recorded in `.scaffold/c-live-query-report.json`;
the latest 100-query run had p50 44.85 ms and p95 85.59 ms on the local file
queue, with nine Vault content files unchanged.

The installed Zotero editor bridge has since exercised all four operations
against the live C companion. A controlled in-flight barrier and actual C
companion restart verified rejection of an old-epoch response and successful
fresh reading. Reader link resolution was also exercised in the host. These
checks do not establish a search or linked-child-card UI, which depends on
later stages. See [host follow-up](c0-c2-host-follow-up-2026-11-06.md) for
the precise scenario and evidence boundaries.
