# C2 Obsidian Link Support

The parser records source offsets from Markdown-it tokens. It does not infer
links from rendered HTML, rewrite note content, or create child cards. Zotero
preview clicks and editor Cmd-clicks resolve a target and emit
`zob-note-link-resolved`; child-card UI is a later C4/C5 feature.

## Supported syntax

| Syntax                            | Current behavior                                                                  | Notes                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `[[Note]]`                        | Parsed and resolved                                                               | Obsidian resolves by its normal Vault path rules.                                    |
| `[[Note                           | Label]]`                                                                          | Parsed and resolved                                                                  | The label is display text; the target remains the note path. |
| `![[Note]]`                       | Parsed as an embed reference and resolved                                         | Preview currently displays a placeholder; it does not render an embedded child card. |
| `[[Note#Heading]]`                | Resolved with heading state                                                       | A unique match returns a position; missing and duplicate matches are distinguished.  |
| `[[Note#Heading#Subheading]]`     | Resolved with nested heading fragment                                             | Resolution uses Obsidian metadata and matching saved-body revision.                  |
| `[[Note#^block-id]]`              | Resolved with block state                                                         | A stale/unverifiable block position is not guessed.                                  |
| `[[#Heading]]`                    | Resolved locally against the current editor buffer                                | Uses unsaved Markdown without forcing a save.                                        |
| `[Label](Note.md)`                | Parsed as an internal Markdown link when the target is a safe Vault-relative path | URL encoding is decoded once before validation.                                      |
| Links inside a list or blockquote | Parsed with original source offsets                                               | Container prefixes are excluded from the recorded link span.                         |

## Excluded or constrained syntax

- Links inside fenced code, indented code, inline code, Obsidian `%%` comments,
  HTML comments, and escaped link syntax are ignored by the link collector.
- Absolute paths, traversal, backslashes, control characters, URL schemes, and
  unsafe encoded targets are rejected as internal paths.
- HTML rendering is disabled in the Markdown preview. External links remain
  on the existing safe-link path and are not sent to the note resolver.
- `[[target|label]]` currently splits on the first `|`; nested brackets and
  multiline wiki links are not supported.
- Embedded-note contents, images as child-card relationships, recursive card
  groups, and connector lines are not implemented by C2.

## Interaction model

- Clicking an internal link in a rendered preview prevents the default anchor
  navigation, resolves it through the read-only query service, updates the
  status line, and emits `zob-note-link-resolved`.
- In the Markdown editor, Cmd-click resolves the link under the current source
  offset. A normal click remains text selection/editing.
- A request is cancelled on view disposal. A late result cannot update a
  disposed view or supersede a newer navigation.
- Successful resolution does not yet open a floating knowledge card; the event
  is the hand-off point for later C4/C5 UI.

## Verification

`npm run test:note-links` covers source spans, aliases, embeds, nested heading
fragments, block anchors, same-note anchors, comments/code, escapes, containers,
and URL safety. `npm run test:note-navigation` covers preview click, Cmd-click,
local unsaved anchors, cancellation, disposal, and late responses in a DOM
fixture. Real C-isolated Reader and expanded preview clicks passed the supported
link matrix; expanded source Cmd-click passed the same matrix. Reader textarea
Cmd-click now passed all 12 supported target/status cases, including aliases,
nested headings, blocks and error results. A controlled local unsynced heading
was found while absent from the Vault file. Inline/fenced/indented code, HTML
and Obsidian comments, and escaped syntax did not trigger navigation; ordinary
click stayed editable, and list/blockquote link offsets worked. This pure
navigation replay changed none of the 46 content-file hashes and left no
write requests. These Reader checks used XPI 7975d1e3... in C isolation.

Native Obsidian 1.15.0 comparison passed for existing wiki/alias/Markdown file
targets, nested headings, blocks, same-note headings and a duplicate basename.
Native duplicate headings select the first match, whereas Bridge reports
`ambiguous`; native missing headings open the file without a matching anchor,
whereas Bridge reports `missing`. Native embed rendering is not claimed by
Bridge's placeholder. Missing-note native navigation was not invoked, to avoid
creating a note. All 38 Vault content files remained unchanged. See the
[host follow-up](c0-c2-host-follow-up-2026-11-06.md) for scope and remaining gates.
