import assert from "node:assert/strict";
import console from "node:console";
import {
  collectNoteLinks,
  noteLinkAtOffset,
  maskNoteComments,
  internalLinkTarget,
  localNoteAnchor,
} from "../src/core/note-links.ts";
import { renderMarkdown } from "../src/core/markdown-preview.ts";

const examples = [
  ["[[Note]]", "Note", "Note", false],
  ["[[目录/笔记|显示名]]", "目录/笔记", "显示名", false],
  ["[[Note#Parent#Child]]", "Note#Parent#Child", "Note#Parent#Child", false],
  ["[[Note#^block-id]]", "Note#^block-id", "Note#^block-id", false],
  ["[[#Heading]]", "#Heading", "#Heading", false],
  ["![[Note]]", "Note", "Note", true],
  [
    "[label](../Notes/My%20note.md#Section)",
    "../Notes/My note.md#Section",
    "label",
    false,
  ],
  ['[label](<My%20note.md> "title")', "My note.md", "label", false],
];
for (const [source, target, label, embed] of examples) {
  for (const prefix of [
    "",
    "text ",
    "- ",
    "> ",
    "1. ",
    "# ",
    "First\r\n\r\n",
  ]) {
    const text = prefix + source;
    const links = collectNoteLinks(text);
    assert.equal(links.length, 1, text);
    assert.deepEqual(
      [links[0].target, links[0].label, links[0].embed],
      [target, label, embed],
    );
    assert.equal(text.slice(links[0].from, links[0].to), source);
    assert.equal(noteLinkAtOffset(text, links[0].from + 2)?.target, target);
    assert.equal(noteLinkAtOffset(text, links[0].to), null);
    assert.match(renderMarkdown(text), /data-zob-note-link=/);
  }
}
for (const source of [
  "`[[No]]`",
  "``[[No]]``",
  "```md\n[[No]]\n```",
  "    [[No]]",
  "\\[[No]]",
  "%% [[No]] %%",
  "before %%\n\n[[No]]\n\n%% after",
  "<!-- [[No]] -->",
  "<!--\n\n[[No]]\n-->",
  "[[javascript:alert(1)]]",
  "[[/etc/passwd]]",
  "[bad](javascript:alert(1))",
  "![image](safe.png)",
]) {
  assert.deepEqual(collectNoteLinks(source), [], source);
  assert.doesNotMatch(renderMarkdown(source), /data-zob-note-link=/, source);
}
assert.equal(maskNoteComments("`%%literal%%`"), "`%%literal%%`");
assert.equal(
  maskNoteComments("```\n<!--literal-->\n```"),
  "```\n<!--literal-->\n```",
);
assert.equal(collectNoteLinks("[[A]] [[A]]").length, 2);
assert.equal(collectNoteLinks("- a\n  [[B]]")[0].from, 6);
assert.equal(collectNoteLinks("😀 [[数学]]")[0].from, 3);
assert.match(
  renderMarkdown("[[Note|<img src=x onerror=alert(1)>]]"),
  /&lt;img/,
);
assert.doesNotMatch(
  renderMarkdown("[[Note|<img src=x onerror=alert(1)>]]"),
  /<img/,
);
assert.match(
  renderMarkdown("[web](https://example.org)"),
  /href="https:\/\/example.org"/,
);
assert.equal(internalLinkTarget("%252e%252e/secret.md", true), null);
assert.deepEqual(localNoteAnchor("# Unsaved\n\n## New\n", "Unsaved#New"), {
  state: "found",
  offset: 11,
});
assert.equal(
  localNoteAnchor("# Repeat\n\n# Repeat\n", "Repeat").state,
  "ambiguous",
);
assert.equal(localNoteAnchor("# Unsaved\n", "Missing").state, "missing");
console.log(
  "C2 parser: syntax/context matrix, source spans, local unsaved anchors, code/comments, escaping and URL safety passed.",
);
