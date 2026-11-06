import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import console from "node:console";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { NoteQueryClient } from "../src/adapters/note-query-client.ts";

const root = await fs.realpath(path.resolve(".scaffold"));
const manifest = JSON.parse(
  await fs.readFile(path.join(root, "c-host-manifest.json"), "utf8"),
);
assert.equal(manifest.paths.queue, path.join(root, "c-queue"));
assert.equal(manifest.paths.vault, path.join(root, "c-vault"));
assert.equal(await fs.realpath(manifest.paths.queue), manifest.paths.queue);
const namespace = path.join(manifest.paths.queue, "note-query");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function inventory(directory, relative = "") {
  const entries = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    if (item.name.startsWith(".")) continue;
    assert.equal(item.isSymbolicLink(), false);
    const name = path.posix.join(relative, item.name);
    const full = path.join(directory, item.name);
    if (item.isDirectory()) entries.push(...(await inventory(full, name)));
    else entries.push([name, digest(await fs.readFile(full))]);
  }
  return entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
const before = await inventory(manifest.paths.vault);
const client = new NoteQueryClient(
  {
    async read(relative, limit) {
      try {
        const bytes = await fs.readFile(path.join(namespace, relative));
        assert.ok(bytes.length <= limit);
        return JSON.parse(bytes);
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    async publish(relative, value) {
      const target = path.join(namespace, relative);
      await fs.writeFile(target + ".tmp", JSON.stringify(value), {
        flag: "wx",
      });
      await fs.rename(target + ".tmp", target);
    },
    async remove(relative) {
      await fs.rm(path.join(namespace, relative), { force: true });
    },
  },
  manifest.vaultId,
);
const outcomes = [];
async function query(operation, input) {
  const start = performance.now();
  const response = await client.query(operation, input);
  outcomes.push({
    operation,
    input,
    status: response.status,
    ms: performance.now() - start,
    ...(response.status === "ok"
      ? {
          path: response.result.path,
          anchorState: response.result.anchorState,
          metadataValid: response.result.metadata?.valid,
          candidates: response.result.items?.map((item) => item.path),
        }
      : {}),
  });
  assert.equal(response.status, "ok");
  return response.result;
}
try {
  const sourcePath = "C0 Root Demo.md";
  const search = await query("search-notes", { query: "Bayesian", sourcePath });
  assert.ok(
    search.items.some(
      (item) =>
        item.path === "Mathematics/Bayes.md" &&
        item.matchedAlias === "Bayesian inference",
    ),
  );
  assert.equal(
    (
      await query("resolve-link", {
        linkpath: "Shared",
        sourcePath: "Mathematics/Bayes.md",
      })
    ).path,
    "Mathematics/Shared.md",
  );
  assert.equal(
    (
      await query("resolve-link", {
        linkpath: "Shared",
        sourcePath: "Physics/Motion.md",
      })
    ).path,
    "Physics/Shared.md",
  );
  assert.equal(
    (
      await query("resolve-link", {
        linkpath: "../Mathematics/Bayes.md",
        sourcePath: "Physics/Motion.md",
      })
    ).path,
    "Mathematics/Bayes.md",
  );
  assert.equal(
    (
      await query("resolve-link", {
        linkpath: "Mathematics/Bayes#Posterior#Worked example",
        sourcePath,
      })
    ).anchorState,
    "found",
  );
  assert.equal(
    (
      await query("resolve-link", {
        linkpath: "Mathematics/Bayes#^bayes-rule",
        sourcePath,
      })
    ).anchorState,
    "found",
  );
  assert.equal(
    (
      await query("resolve-link", {
        linkpath: "Mathematics/Bayes#Example",
        sourcePath,
      })
    ).anchorState,
    "ambiguous",
  );
  assert.equal(
    (
      await query("resolve-link", {
        linkpath: "Mathematics/Bayes#Missing anchor",
        sourcePath,
      })
    ).anchorState,
    "missing",
  );
  assert.equal(
    (await query("read-note", { path: "Mathematics/Bayes.md" })).metadata.valid,
    true,
  );
  const image = await query("read-note-resource", {
    linkpath: "../assets/c0-colors.png",
    sourcePath: "Physics/Motion.md",
  });
  assert.equal(image.mimeType, "image/png");
  const missing = await client.query("resolve-link", {
    linkpath: "Missing C0 Note",
    sourcePath,
  });
  assert.equal(missing.status, "not-found");
  assert.equal(
    await fs.stat(path.join(manifest.paths.vault, "Missing C0 Note.md")).then(
      () => true,
      () => false,
    ),
    false,
  );
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    const result = await client.query("search-notes", {
      query: "Bayesian",
      sourcePath,
    });
    assert.equal(result.status, "ok");
    assert.equal(result.result.items[0].path, "Mathematics/Bayes.md");
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  assert.deepEqual(
    await inventory(manifest.paths.vault),
    before,
    "Read queries must not alter or create notes/resources",
  );
  const report = {
    result: "PASS",
    at: new Date().toISOString(),
    kind: "live Obsidian companion, filesystem client (not Zotero UI)",
    xpiSHA256: manifest.xpiSHA256,
    companionSHA256: manifest.companionSHA256,
    contentFilesUnchanged: before.length,
    contentDigest: digest(JSON.stringify(before)),
    missingNoteNotCreated: true,
    outcomes,
    searchRoundTrip: {
      kind: "100 sequential warm-index queries, local filesystem; excludes UI rendering",
      count: samples.length,
      p50: samples[49],
      p95: samples[94],
      max: samples[99],
    },
  };
  await fs.writeFile(
    path.join(root, "c-live-query-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  client.close();
}
