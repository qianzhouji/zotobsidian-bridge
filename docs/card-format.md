# Card and Storage Format

## File layout

The configured output folder is a path relative to the selected Obsidian vault.
The default is `Zotero Literature`.

```text
<output folder>/<paper title> (<library type>-<library ID>-<item key>)/
  Paper.md
  Annotations/<annotation key>.md
  Notes/<note title> (<note key>).md

<output folder>/Standalone Notes (<library type>-<library ID>)/
  <note title> (<note key>).md
```

Titles are display names only. Item keys and library identity provide the
disambiguating suffix. Filenames are normalized, control characters and path
separators are removed, and each vault path is checked to remain below the
configured vault. Symlinks encountered below the vault root are rejected.

## Identity

The persistent annotation identity is
`<library type>:<library type ID>/annotation/<annotation key>`. A native note
uses `<library type>:<library type ID>/note/<note key>`. Neither identity uses
Zotero's local numeric item ID. Group libraries with the same item key
therefore remain distinct.

Annotation and native-note Markdown files have YAML frontmatter containing:

| Field               | Owner  | Meaning                                                      |
| ------------------- | ------ | ------------------------------------------------------------ |
| `bridge_schema`     | Bridge | File-format version; currently `1`                           |
| `bridge_card_id`    | Bridge | UUID that stays with the card when the file is moved         |
| `bridge_source_id`  | Bridge | Stable Zotero library/annotation or note identity            |
| `bridge_updated_at` | Bridge | Last bridge metadata update timestamp                        |
| `zotero_*`          | Bridge | Source library, item, attachment/note, title, and URI fields |
| `type`              | Bridge | `zotero-note` for native Zotero note cards                   |
| `note_title`        | User   | Optional title edited in the Zotero Markdown window          |
| Other fields        | User   | Preserved by source-field updates                            |

The Zotero data directory stores `storage/zotero-obsidian-bridge/cards.json`
and `sync-tasks.json`. The card index maps source IDs to card UUIDs and
vault-relative paths. A `suspendedCards` map stores tombstones for cards missing
from the output folder. When an indexed card is moved inside the output folder,
frontmatter is scanned to repair its path; a suspended card resumes only after
the same UUID returns inside the output folder. Missing task/index files start
empty, but malformed data is reported instead of silently reset. Vault paths
in the index are relative, not absolute.

## Ownership boundary

Annotation cards place Zotero-derived excerpt, comment, page, and source link;
native-note cards place the converted Zotero note body and source link between
these exact markers:

```md
<!-- zotero-obsidian-bridge:source:start -->

...

<!-- zotero-obsidian-bridge:source:end -->
```

`## My notes` follows the source block and is user-owned. Source updates parse
the leading YAML document and the marker pair outside Markdown code fences.
They preserve all non-bridge frontmatter fields and every byte of the
user-owned body. Missing, duplicate, malformed, or ambiguous boundaries are
conflicts, not permission to overwrite. Native-note imports use the same
boundary: a re-import refreshes only Zotero-owned note content and preserves
the Obsidian-owned section. Markdown edits are not written back to Zotero's
rich-text note.

The Zotero Markdown editor can change `note_title` and the content following
`## My notes`; the source block is displayed read-only. Before a save, it
compares the current user-owned content with the editor's baseline. A conflicting
external edit is not overwritten automatically. The user can adopt the Obsidian
version or explicitly keep the Zotero version. The editor shows baseline-to-disk
and baseline-to-local line diffs; either choice first archives the
baseline, disk content, and local draft under Zotero's
`storage/zotero-obsidian-bridge/editor-conflicts/` directory. Recoverable drafts
are stored separately under `editor-drafts/` and removed after a clean save.
All plugin-originated writes to the same card are serialized in the Zotero host,
so notifier-driven source updates cannot race the editor's user-content save.

While the editor is open, it checks the vault at bounded intervals and when the
window regains focus. Changes to Zotero-owned source metadata are merged without
conflicting with the note body. If the vault becomes unavailable, the local
draft remains editable and is retried when the vault can be read again.

Markdown preview disables raw HTML and does not load remote images. Inline
`$...$` and block `$$...$$` math are rendered through KaTeX with trust disabled
and finite expansion/size limits. The Markdown itself remains ordinary text in
the Obsidian card.

When a source-field update is performed, `IOUtils.writeUTF8` writes through a
same-directory temporary path and keeps the previous version in a hidden
`.bridge-recovery` directory. New cards use a temporary file plus an exclusive
move, so a collision never overwrites an existing note.

The task log is stored at
`<Zotero data directory>/storage/zotero-obsidian-bridge/sync-tasks.json`.
Zotero item/trash notifications are deferred out of the notifier callback,
coalesced by annotation identity for one second, and followed by a fresh read of
the current Zotero item. A SHA-256 hash of the source metadata avoids rewriting
unchanged cards. Tasks move through `pending`, `running`, `done`, `retry`, and
`conflict`; interrupted tasks are returned to `pending` on restart, and
transient errors use bounded exponential retry. Preferences exposes status,
manual retry, and full reconciliation actions.

When Zotero deletes an annotation or native note, or it becomes unavailable,
its card remains in place and receives `bridge_source_status: missing`;
restoration makes the source available again. If a card disappears from the configured output folder,
the card index records a suspension and synchronization reports a conflict
instead of recreating the note. Moving a card within the output folder is
supported by its immutable card UUID. Temporary write failures keep the prior
file and a recovery copy; replaying an already-applied update is idempotent.

## Links

- `zotero_uri` links to the item or the PDF page.
- Opening a card uses the Obsidian URI with the absolute file path URL-encoded.
- The plugin does not create concept-to-concept Obsidian wikilinks. Such links
  remain under the user's control.

The Preferences sync status reports pending/running/completed tasks and the
latest retry/conflict details. Reconciliation scans linked cards in the
configured output folder; it does not create cards for unrelated notes.
