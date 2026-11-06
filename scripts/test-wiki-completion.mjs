import assert from "node:assert/strict";
import console from "node:console";
import {
  CompletionGeneration,
  wikiCompletionContext,
  wikiCompletionEdit,
  wikiCompletionText,
} from "../src/core/wiki-completion.ts";

assert.deepEqual(wikiCompletionContext("before [[中文", 11), {
  from: 7,
  to: 11,
  query: "中文",
  target: "中文",
  fragment: null,
  mode: "note",
  closed: false,
});
assert.equal(wikiCompletionContext("[[Math/Space#^bl]]", 16)?.mode, "block");
assert.equal(wikiCompletionContext("[[A|alias]]", 9), null);
assert.equal(wikiCompletionContext("\\[[escaped", 10), null);
assert.equal(wikiCompletionContext("`[[code]]`", 7), null);
assert.equal(wikiCompletionContext("```\n[[code\n```", 10), null);
assert.equal(wikiCompletionContext("<!-- [[hidden -->", 12), null);
assert.equal(wikiCompletionContext("[[A]] text", 10), null);
assert.equal(
  wikiCompletionText("Math/Space Name.md", "^block"),
  "[[Math/Space Name#^block]]",
);
const typed = "[[bay]]";
const edit = wikiCompletionEdit(0, typed.length, {
  path: "Mathematics/Bayes.md",
});
assert.equal(
  typed.slice(0, edit.from) + edit.insert + typed.slice(edit.to),
  "[[Mathematics/Bayes]]",
);
assert.equal(edit.cursor, "[[Mathematics/Bayes]]".length);
const aliased = "[[bay|Bayesian statistics]]";
const aliasEdit = wikiCompletionEdit(
  0,
  aliased.length,
  { path: "Mathematics/Bayes.md" },
  "Bayesian statistics",
);
assert.equal(
  aliased.slice(0, aliasEdit.from) +
    aliasEdit.insert +
    aliased.slice(aliasEdit.to),
  "[[Mathematics/Bayes|Bayesian statistics]]",
);
const generation = new CompletionGeneration();
const requests = Array.from({ length: 50 }, () => generation.next());
assert.deepEqual(
  requests.reverse().filter((n) => generation.isCurrent(n)),
  [50],
);
generation.cancel();
assert.equal(generation.isCurrent(50), false);
console.log("Wiki completion parsing and stale-generation checks passed.");
