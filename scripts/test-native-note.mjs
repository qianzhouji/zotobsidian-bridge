import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import {
  convertZoteroNoteHTML,
  formatZoteroNoteSourceBlock,
} from "../src/core/zotero-note-markdown.ts";

const html = `
<html><body data-schema-version="9">
  <h1>Research note</h1>
  <p>A <strong>bold</strong> and <em>emphasized</em> paragraph with
    <a href="https://example.org/paper">a link</a> and <code>inline()</code>.</p>
  <blockquote><p>Quoted text.</p></blockquote>
  <ol><li>First item</li><li>Second item</li></ol>
  <table><thead><tr><th>Term</th><th>Meaning</th></tr></thead>
    <tbody><tr><td>Kernel</td><td>Similarity function</td></tr></tbody></table>
  <pre><code>const answer = 42;</code></pre>
  <span class="math" data-tex="x^2 + y^2">formula</span>
  <span class="citation" data-citation='{"citationItems":[{"id":"REF1","label":"Smith"}]}'> (Smith, 2024) </span>
  <img alt="brain diagram" src="zotero://attachment/ABC123/image.png">
  <a href="javascript:alert(1)">unsafe link</a>
  <iframe src="https://example.org/embed"></iframe>
  <script>must not be imported</script>
</body></html>`;
const document = new DOMParser().parseFromString(html, "text/html");
const converted = convertZoteroNoteHTML(html, document);

assert.match(converted.markdown, /^# Research note/m);
assert.match(converted.markdown, /\*\*bold\*\*/);
assert.match(converted.markdown, /\*emphasized\*/);
assert.match(converted.markdown, /\[a link\]\(https:\/\/example\.org\/paper\)/);
assert.match(converted.markdown, /> Quoted text\./);
assert.match(converted.markdown, /1\.\s+First item/);
assert.match(converted.markdown, /\| Term \| Meaning \|/);
assert.match(converted.markdown, /\| --- \| --- \|/);
assert.match(converted.markdown, /```[\s\S]*const answer = 42;[\s\S]*```/);
assert.match(converted.markdown, /\$x\^2 \+ y\^2\$/);
assert.match(converted.markdown, /\(Smith, 2024\)/);
assert.match(converted.markdown, /zotero-citation:%7B/);
assert.match(converted.markdown, /image not imported: brain diagram/i);
assert.match(converted.markdown, /zotero:\/\/attachment\/ABC123\/image\.png/);
assert.match(converted.markdown, /unsafe link \(link omitted\)/);
assert.doesNotMatch(converted.markdown, /javascript:/i);
assert.doesNotMatch(converted.markdown, /must not be imported/);
assert.match(converted.markdown, /Embedded iframe content was not imported/);
assert.equal(converted.warnings.length, 3);

const mappedImage = convertZoteroNoteHTML(
  html,
  document,
  new Map([
    [
      "zotero://attachment/ABC123/image.png",
      "assets/ABC123-0123456789abcdef.png",
    ],
  ]),
);
assert.match(
  mappedImage.markdown,
  /!\[brain diagram\]\(assets\/ABC123-0123456789abcdef\.png\)/,
);
assert.equal(mappedImage.warnings.length, 2);

const headerless = convertZoteroNoteHTML(
  "<html><body><table><tr><td>Alpha</td><td>1</td></tr><tr><td>Beta</td><td>2</td></tr></table></body></html>",
  new DOMParser().parseFromString(
    "<html><body><table><tr><td>Alpha</td><td>1</td></tr><tr><td>Beta</td><td>2</td></tr></table></body></html>",
    "text/html",
  ),
);
assert.match(headerless.markdown, /\| Column 1 \| Column 2 \|/);
assert.match(headerless.markdown, /\| Beta \| 2 \|/);
assert.match(headerless.warnings[0], /generic column headings/);

const block = formatZoteroNoteSourceBlock(
  "Research note",
  "zotero://select/library/items/ABC123",
  converted,
);
assert.match(block, /zotero-obsidian-bridge:source:start/);
assert.match(block, /\*\*Title:\*\* Research note/);
assert.match(block, /\[Open in Zotero\]/);
assert.match(block, /zotero-obsidian-bridge:source:end/);

globalThis.process.stdout.write("Native-note HTML conversion tests passed.\n");
