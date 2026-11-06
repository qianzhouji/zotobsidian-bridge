import assert from "node:assert/strict";
import console from "node:console";
import {
  knowledgeNoteBody,
  renderKnowledgeNote,
} from "../src/core/knowledge-note.ts";

const note =
  "---\ntitle: Knowledge\ntags: [math]\n---\n# Heading\n\nBody $x^2$.\n\n![remote](https://example.org/p.png)\n\n<script>alert(1)</script>";
const body = knowledgeNoteBody(note);
assert.ok(body.startsWith("# Heading"));
assert.ok(body.includes("Body $x^2$."));
const html = renderKnowledgeNote(note);
assert.match(html, /<h1[^>]*>Heading<\/h1>/);
assert.match(html, /class="katex"/);
assert.match(html, /image-placeholder/);
assert.doesNotMatch(html, /<img\b|<script\b|src="https:/);
assert.equal(
  knowledgeNoteBody("---\nnot closed\nHello"),
  "---\nnot closed\nHello",
);
assert.equal(
  knowledgeNoteBody("Ordinary note without metadata"),
  "Ordinary note without metadata",
);
console.log("Read-only knowledge note baseline checks passed.");
