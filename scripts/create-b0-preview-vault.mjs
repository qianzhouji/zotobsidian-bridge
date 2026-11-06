import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createMarkdownWithHiddenMetadata } from "../src/core/markdown.ts";

const root = resolve(".scaffold/b0-vault");
await mkdir(resolve(root, ".obsidian"), { recursive: true });
await writeFile(resolve(root, ".obsidian/app.json"), "{}\n");

const markdown = createMarkdownWithHiddenMetadata(
  { paper_title: "B0 Preview Fixture: Metadata Must Stay Hidden" },
  {
    type: "zotero-annotation",
    bridge_schema: 1,
    bridge_card_id: "c25eef8b-7d53-42c0-b7e5-b50f8394e48e",
    bridge_source_id: "user:0/annotation/B0FIXTURE",
    bridge_updated_at: "2026-10-30T00:00:00.000Z",
    zotero_library: "user:0",
    zotero_library_id: 0,
    zotero_paper_key: "B0PAPER",
    zotero_paper_title: "B0 Preview Fixture: Metadata Must Stay Hidden",
    zotero_attachment_key: "B0PDF001",
    zotero_annotation_key: "B0FIXTURE",
    zotero_page_index: 1,
    zotero_page_label: "ii",
  },
  `\n<!-- zotero-obsidian-bridge:source:start -->\n` +
    `### Highlight\n\nA fixture excerpt from the physical second PDF page.\n` +
    `<!-- zotero-obsidian-bridge:source:end -->\n\n` +
    `## My notes\n\nThis user-authored note should remain visible.\n`,
);
await writeFile(resolve(root, "P02N01.md"), markdown);
await writeFile(
  resolve(root, "Rendering.md"),
  `# Isolated Obsidian rendering probes\n\n` +
    `## Empty inline element with data attribute\n\n` +
    `Before <span data-zotero-obsidian-bridge="metadata" data-payload="SYNTHETIC_ATTRIBUTE_PAYLOAD"></span> after.\n\n` +
    `## Empty inline element with hidden style\n\n` +
    `Before <span style="display:none" data-payload="SYNTHETIC_INLINE_HIDDEN_PAYLOAD"></span> after.\n\n` +
    `## Zero-width Markdown link\n\n` +
    `Before [\u200b](data:text/plain;base64,SYNTHETIC_LINK_PAYLOAD) after.\n\n` +
    `## Markdown reference definition\n\n` +
    `Before [\u200b][bridge-meta] after.\n\n[bridge-meta]: data:text/plain;base64,SYNTHETIC_REFERENCE_PAYLOAD "bridge metadata"\n\n` +
    `## Markdown footnote definition\n\n` +
    `Before a footnote[^bridge-meta] after.\n\n[^bridge-meta]: SYNTHETIC_FOOTNOTE_PAYLOAD\n\n` +
    `## Block HTML with display none\n\n` +
    `<div style="display:none">\nSYNTHETIC_DIV_PAYLOAD\n</div>\n\n` +
    `## Obsidian comment\n\n` +
    `%%\nSYNTHETIC_OBSIDIAN_COMMENT_PAYLOAD\n%%\n\n` +
    `## HTML comment\n\n` +
    `<!-- SYNTHETIC_HTML_COMMENT_PAYLOAD -->\n`,
);
globalThis.process.stdout.write(`${root}\n`);
