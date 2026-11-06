# B3 Reader Markdown Preview

The Reader card edits and saves the original Markdown body. Preview rendering is
temporary and does not rewrite that source.

## Supported

- Headings, paragraphs, emphasis, blockquotes, ordered and unordered lists,
  tables, fenced code blocks, and ordinary Markdown links.
- Inline math delimited by `$...$` and display math delimited by `$$` blocks,
  rendered with KaTeX.
- Local raster images referenced from the card's sibling `assets/` folder:
  PNG, JPEG, GIF, WebP, and BMP. Image files must be regular files inside the
  configured Vault, must not be symbolic links, and may not exceed 20 MiB.
- `zotero://` and `obsidian://` links, which are opened only after an explicit
  click.

## Deliberate Limits

- Raw HTML is disabled. HTML text is escaped rather than inserted into the
  preview; scripts, event handlers, and embedded active content do not run.
- Remote images, absolute paths, `data:` URLs, unsupported formats, missing
  images, and paths that leave `assets/` are not loaded. They remain inert image
  placeholders. No request is made to a remote image host.
- Obsidian-only extensions such as `[[wikilinks]]`, `![[embeds]]`, callouts,
  and plugin-provided syntax are not promised to render in Zotero's preview.
  Their Markdown remains unchanged in the editor and the saved card.
- Links are limited to safe protocols accepted by the renderer. A link is never
  opened automatically during preview.

## Verification

`npm run test:card-markdown-preview` checks common Markdown and KaTeX output,
local image resolution, HTML and dangerous-link handling, remote/traversal
image rejection, symlink rejection, the 20 MiB limit, and temporary object URL
cleanup.
