# Zotero and Obsidian Interface Spike

This document records the current implementation path and the host checks that
remain for Zotero 10.0.6.

## Zotero reader entry points

The plugin registers these Zotero Reader events:

- `renderTextSelectionPopup`: adds a button to the selection popup. The current
  code requires the annotation to have been saved in Zotero before a card can
  be created.
- `renderSidebarAnnotationHeader`: adds the same button beside a saved
  annotation in the reader sidebar.
- `createAnnotationContextMenu`: adds an item to an annotation context menu.

The API provides a reader, annotation payload or selected annotation IDs, and
an append function. The plugin resolves the stored annotation item from its
library/key or from the reader's parent attachment before reading metadata.
The existing small popup shown when clicking a highlight is not represented by
these API events and remains a separate host verification item.

Each reader entry point now offers both the Obsidian-card action and an
**Edit Markdown in Zotero** action. The latter opens a separate XUL window with
CodeMirror, a KaTeX-capable preview, and read-only annotation context. This
window is implemented but its exact popup placement and behavior inside the
supported Zotero build have not yet been manually verified.

## Markdown target

For a test vault at `<vault>`, a saved annotation creates:

```text
Zotero Literature/<paper title> (<library type>-<library ID>-<item key>)/
  Paper.md
  Annotations/<annotation key>.md
```

The paper note contains basic Zotero metadata and a Zotero item link. The
annotation card contains stable bridge identity, quote, comment, page label,
user-owned notes section, and a link to the PDF page. Existing files are not
overwritten; an existing card is reopened instead. The editor changes only
`note_title` and `My notes`, with local draft recovery and explicit conflict
resolution. See
[`card-format.md`](card-format.md) for the schema.

## Host verification record

Run the following checks against disposable records only:

- Create one saved PDF highlight with a parent bibliographic item and one in a
  standalone PDF.
- Confirm the three UI entry points appear in their intended locations.
- Confirm each action resolves the same saved annotation and source attachment.
- Confirm the test vault receives a paper folder and one card with quote,
  comment, and page label.
- Open the Obsidian card and follow its Zotero link back to the PDF page.
- Repeat the action and confirm existing Markdown is not replaced.
- Open the Zotero editor and confirm the source is read-only while title and
  notes are editable.
- Test Chinese IME composition, inline and block math, lists, code blocks, and
  CodeMirror undo/redo.
- Edit the same note in Obsidian and Zotero; verify both versions remain
  available and neither is silently overwritten.
- Close Zotero with a pending draft, restart, and confirm recovery. Repeat with
  the vault temporarily unavailable, then reconnect it.
- Keep the editor open for 30 minutes and verify polling, memory use, and saves.
- Exercise Unicode and spaces in the vault path and paper title.
- Stop development mode and confirm the ordinary Zotero process remains alive.

Until those checks pass, the popup placement and annotation/page URI behavior
are prototypes rather than confirmed Zotero 10 behavior.
