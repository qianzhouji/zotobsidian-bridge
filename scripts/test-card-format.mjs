import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import MarkdownIt from "markdown-it";
import { parseHTML } from "linkedom";
import {
  createMarkdownWithHiddenMetadata,
  createMarkdownWithFrontmatter,
  formatSourceBlock,
  hasSameMarkdownExceptUpdatedAt,
  parseMarkdownFrontmatter,
  readFrontmatterValue,
  updateAnnotationCardMetadata,
} from "../src/core/markdown.ts";
import {
  readSourceMarkdown,
  readUserNoteContent,
  replaceUserNoteContent,
} from "../src/core/note-content.ts";

const cardId = "2f1dbb85-7fd7-497d-994e-c342d5225469";
const sourceId = "user:0/annotation/ANN001";
const sourceBlock = `\n<!-- zotero-obsidian-bridge:source:start -->\nExcerpt\n<!-- zotero-obsidian-bridge:source:end -->\n`;
const coloredSource = formatSourceBlock(
  "A highlighted sentence.",
  "Zotero's own comment.",
  "Page 2",
  "zotero://open-pdf/user/0/ANN001",
  "#ffd400",
);
assert.doesNotMatch(coloredSource, /Highlight color/i);
assert.match(coloredSource, /A highlighted sentence\./);
assert.match(coloredSource, /### Zotero comment/);
const newCard = createMarkdownWithHiddenMetadata(
  { paper_title: "Example paper" },
  {
    type: "zotero-annotation",
    bridge_schema: 1,
    bridge_card_id: cardId,
    bridge_source_id: sourceId,
    bridge_updated_at: "2026-10-29T10:00:00.000Z",
    zotero_annotation_key: "ANN001",
    zotero_page_index: 0,
  },
  `## My notes\n\nPersonal note\n\n${sourceBlock.trimStart()}`,
);
const newFrontmatter = parseMarkdownFrontmatter(newCard).document.toJS();
assert.deepEqual(Object.keys(newFrontmatter), ["paper_title"]);
assert.equal(readFrontmatterValue(newCard, "type"), "zotero-annotation");
assert.equal(readFrontmatterValue(newCard, "bridge_card_id"), cardId);
assert.equal(readFrontmatterValue(newCard, "zotero_page_index"), 0);
assert.equal(readFrontmatterValue(newCard, "bridge_metadata_format"), 4);
assert.equal(
  readFrontmatterValue(newCard, "zotero_paper_title"),
  "Example paper",
);
assert.ok(
  parseMarkdownFrontmatter(newCard).body.indexOf("## My notes") <
    parseMarkdownFrontmatter(newCard).body.indexOf(
      "<!-- zotero-obsidian-bridge:source:start -->",
    ),
  "new cards show My notes before the Zotero source section",
);
assert.deepEqual(readUserNoteContent(newCard), {
  title: "",
  markdown: "Personal note",
});
assert.match(readSourceMarkdown(newCard), /Excerpt/);
const metadataPayload = newCard.match(
  /<span data-zotero-obsidian-bridge="metadata" data-payload="([A-Za-z0-9+/=]+)"><\/span>/,
);
assert.ok(metadataPayload, "metadata stays in an empty inline HTML element");
assert.ok(
  parseMarkdownFrontmatter(newCard).body.indexOf(metadataPayload[0]) >
    parseMarkdownFrontmatter(newCard).body.indexOf(
      "<!-- zotero-obsidian-bridge:source:end -->",
    ),
  "metadata block stays outside the user-owned note section",
);
const renderedCardBody = new MarkdownIt({ html: true }).render(
  parseMarkdownFrontmatter(newCard).body,
);
const { document: renderedDocument } = parseHTML(renderedCardBody);
const metadataElement = renderedDocument.querySelector(
  '[data-zotero-obsidian-bridge="metadata"]',
);
assert.ok(metadataElement, "metadata remains available in rendered HTML");
assert.equal(
  metadataElement.textContent,
  "",
  "metadata element has no visible text",
);
assert.equal(
  metadataElement.getAttribute("data-payload"),
  metadataPayload[1],
  "metadata payload remains recoverable from its attribute",
);
assert.doesNotMatch(renderedDocument.body.textContent, /[A-Za-z0-9+/=]{80,}/);
assert.doesNotMatch(
  renderedCardBody,
  new RegExp(`<p>${metadataPayload[1]}</p>`),
);

const transitionMetadata = {
  type: "zotero-annotation",
  bridge_schema: 1,
  bridge_card_id: cardId,
  bridge_source_id: sourceId,
  zotero_annotation_key: "ANN001",
};
const transitionCard = createMarkdownWithFrontmatter(
  { paper_title: "Example paper" },
  `<!-- zotero-obsidian-bridge:metadata:start -->\n${Buffer.from(JSON.stringify(transitionMetadata)).toString("base64")}\n<!-- zotero-obsidian-bridge:metadata:end -->\n\n${sourceBlock}\n## My notes\nKeep transition content.\n`,
);
assert.equal(readFrontmatterValue(transitionCard, "bridge_card_id"), cardId);
const transitionMigrated = updateAnnotationCardMetadata(transitionCard, {
  bridge_updated_at: "2026-10-29T12:00:00.000Z",
});
assert.equal(
  readFrontmatterValue(transitionMigrated, "bridge_metadata_format"),
  4,
);
assert.match(
  transitionMigrated,
  /<span data-zotero-obsidian-bridge="metadata" data-payload="/,
);
assert.doesNotMatch(transitionMigrated, /zotero-obsidian-bridge:metadata:end/);
assert.match(transitionMigrated, /## My notes\nKeep transition content\./);

const priorHiddenBlock = `<div style="display:none" data-zotero-obsidian-bridge="metadata">\n${Buffer.from(JSON.stringify(transitionMetadata)).toString("base64")}\n</div>`;
const priorHiddenCard = createMarkdownWithFrontmatter(
  { paper_title: "Example paper" },
  `${sourceBlock}\n${priorHiddenBlock}\n\n## My notes\nKeep v3 content.\n`,
);
assert.equal(readFrontmatterValue(priorHiddenCard, "bridge_card_id"), cardId);
const priorHiddenMigrated = updateAnnotationCardMetadata(priorHiddenCard, {
  bridge_updated_at: "2026-10-29T12:30:00.000Z",
});
assert.match(
  priorHiddenMigrated,
  /<span data-zotero-obsidian-bridge="metadata" data-payload="/,
);
assert.doesNotMatch(priorHiddenMigrated, /<div style="display:none"/);
assert.equal(
  readFrontmatterValue(priorHiddenMigrated, "bridge_card_id"),
  cardId,
);
assert.match(priorHiddenMigrated, /## My notes\nKeep v3 content\./);

const fencedMarkers = createMarkdownWithFrontmatter(
  { paper_title: "Example paper" },
  `\n\`\`\`html\n<!-- zotero-obsidian-bridge:metadata:start -->\n${Buffer.from(JSON.stringify(transitionMetadata)).toString("base64")}\n<!-- zotero-obsidian-bridge:metadata:end -->\n\`\`\`\n\n## My notes\nFence stays user content.\n`,
);
assert.equal(readFrontmatterValue(fencedMarkers, "bridge_card_id"), undefined);
assert.match(
  updateAnnotationCardMetadata(fencedMarkers, { bridge_updated_at: "now" }),
  /Fence stays user content\./,
);
assert.throws(
  () =>
    readFrontmatterValue(
      createMarkdownWithFrontmatter(
        { paper_title: "Example paper" },
        "<!-- zotero-obsidian-bridge:metadata:start -->\nmissing end\n",
      ),
      "bridge_card_id",
    ),
  /metadata block is malformed/,
);

const edited = replaceUserNoteContent(newCard, {
  title: "My short title",
  markdown: "Edited body\n",
});
assert.deepEqual(
  Object.keys(parseMarkdownFrontmatter(edited).document.toJS()),
  ["paper_title"],
);
assert.equal(readFrontmatterValue(edited, "note_title"), "My short title");
assert.match(edited, /## My notes\n\nEdited body/);
assert.ok(
  edited.indexOf("## My notes") <
    edited.indexOf("<!-- zotero-obsidian-bridge:source:start -->"),
  "editing preserves the notes-first order",
);

const oldOrderCard = createMarkdownWithHiddenMetadata(
  { paper_title: "Example paper" },
  {
    type: "zotero-annotation",
    bridge_schema: 1,
    bridge_card_id: "d55d339d-c5aa-4ad2-94e4-a01c11a957a0",
    bridge_source_id: "user:0/annotation/ANN002",
    zotero_annotation_key: "ANN002",
    note_title: null,
  },
  `${sourceBlock}\n### Zotero comment\n\nOld Zotero comment.\n\n## My notes\n\nMy preserved note.\n`,
);
const oldContent = readUserNoteContent(oldOrderCard);
assert.equal(oldContent.markdown, "My preserved note.\n");
const migratedOrder = replaceUserNoteContent(oldOrderCard, oldContent);
assert.ok(
  migratedOrder.indexOf("## My notes") <
    migratedOrder.indexOf("### Zotero comment"),
  "editing an older source-first card migrates it to notes-first",
);
assert.deepEqual(readUserNoteContent(migratedOrder), oldContent);
assert.match(migratedOrder, /Old Zotero comment\./);

const legacy = `---\ntype: zotero-annotation\nbridge_schema: 1\nbridge_card_id: ${cardId}\nbridge_source_id: ${sourceId}\nbridge_updated_at: 2026-10-28T10:00:00.000Z\nzotero_paper_title: Example paper\nzotero_annotation_key: ANN001\nzotero_page_index: 0\nnote_title: Old title\ncustom_metadata:\n  owner: me\n  flags: [keep, exact]\n---\n\nLegacy source and user-authored content.\n\n## My notes\nKeep these exact words.\n`;
const legacyBody = parseMarkdownFrontmatter(legacy).body;
const migrated = updateAnnotationCardMetadata(legacy, {
  bridge_updated_at: "2026-10-29T10:00:00.000Z",
  zotero_page_index: 1,
});
const migratedFrontmatter = parseMarkdownFrontmatter(migrated).document.toJS();
assert.deepEqual(Object.keys(migratedFrontmatter).sort(), [
  "custom_metadata",
  "paper_title",
]);
assert.equal(readFrontmatterValue(migrated, "bridge_card_id"), cardId);
assert.equal(readFrontmatterValue(migrated, "zotero_page_index"), 1);
assert.equal(readFrontmatterValue(migrated, "note_title"), "Old title");
assert.deepEqual(migratedFrontmatter.custom_metadata, {
  owner: "me",
  flags: ["keep", "exact"],
});
assert.ok(parseMarkdownFrontmatter(migrated).body.includes(legacyBody));
assert.throws(
  () => updateAnnotationCardMetadata(migrated, { bridge_card_id: "changed" }),
  /immutable card identity field/,
);

const timestampOnlyChange = updateAnnotationCardMetadata(migrated, {
  bridge_updated_at: "2026-10-29T11:00:00.000Z",
});
assert.equal(
  hasSameMarkdownExceptUpdatedAt(migrated, timestampOnlyChange),
  true,
);
assert.equal(
  hasSameMarkdownExceptUpdatedAt(
    legacy,
    updateAnnotationCardMetadata(legacy, {
      bridge_updated_at: "2026-10-29T11:00:00.000Z",
    }),
  ),
  false,
);

process.stdout.write(
  "Card format checks passed: clean visible properties, hidden metadata access, legacy migration, note editing, and body preservation.\n",
);
