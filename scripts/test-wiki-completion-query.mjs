import assert from "node:assert/strict";
import console from "node:console";
import { WikiCompletionQuery } from "../src/services/wiki-completion-query.ts";

const waiting = [];
let closed = false;
const client = {
  cancel: () => {},
  search: () => new Promise((resolve) => waiting.push(resolve)),
  query: async (operation) =>
    operation === "resolve-link"
      ? { status: "ok", result: { path: "Math/Note.md", revision: "r1" } }
      : {
          status: "ok",
          result: {
            path: "Math/Note.md",
            revision: "r1",
            metadata: {
              valid: true,
              revision: "r1",
              headings: [{ heading: "Example", level: 1 }],
              blocks: [{ id: "block" }],
            },
          },
        },
  close: () => {
    closed = true;
  },
};
const q = new WikiCompletionQuery(client);
const context = {
  from: 0,
  to: 2,
  query: "",
  target: "",
  fragment: null,
  mode: "note",
  closed: false,
};
const requests = Array.from({ length: 50 }, () =>
  q.search(context, "source.md"),
);
for (let i = waiting.length - 1; i >= 0; i--)
  waiting[i]({
    status: "ok",
    result: {
      items: [{ path: `n${i}.md`, title: `n${i}`, basename: `n${i}` }],
    },
  });
const results = await Promise.all(requests);
assert.ok(
  results.slice(0, -1).every((result) => result.status === "cancelled"),
);
assert.equal(results.at(-1).items[0].path, "n49.md");
const heading = await q.search(
  { ...context, target: "Math/Note", mode: "heading", query: "exa" },
  "source.md",
);
assert.equal(heading.items[0].fragment, "Example");
const block = await q.search(
  { ...context, target: "Math/Note", mode: "block", query: "blo" },
  "source.md",
);
assert.equal(block.items[0].fragment, "^block");
q.close();
assert.ok(closed);
console.log("Wiki completion query generation and metadata checks passed.");
