import assert from "node:assert/strict";
import console from "node:console";
import { promises as fs } from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers";
import {
  NoteQueryService,
  allowedNotePath,
} from "../obsidian-plugin/src/note-query-service.ts";
import { verifyColdNavigationCache } from "../obsidian-plugin/src/note-query-metadata.ts";
import { NoteQueryClient } from "../src/adapters/note-query-client.ts";
import { clearKnowledgeNoteMemoryCache } from "../src/core/note-query-cache.ts";
import {
  NOTE_QUERY_CAPABILITIES_TTL,
  validateNoteQueryRequest,
  validateNoteQueryResponse,
  validateNoteQueryCapabilities,
  NOTE_QUERY_LIMITS as L,
} from "../src/core/note-query-protocol.ts";

const root = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "zob-c1-")),
);
const vault = path.join(root, "vault");
const queue = path.join(root, "queue");
await fs.mkdir(path.join(vault, "Math"), { recursive: true });
await fs.mkdir(path.join(vault, "Physics"));
await fs.mkdir(queue);
const files = new Map();
const file = (name) => ({
  path: name,
  basename: path.basename(name, path.extname(name)),
  extension: path.extname(name).slice(1),
});
const text =
  "# Bayes\n\n## Parent\n\n### Child\n\nBody ^rule\n\n## Duplicate\n\n## Duplicate\n";
for (const name of [
  "Root.md",
  "Math/Bayes.md",
  "Math/Shared.md",
  "Physics/Shared.md",
]) {
  await fs.writeFile(path.join(vault, name), text);
  files.set(name, file(name));
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAAR0lEQVR4nO3PIRUAIBBEwSuEQ2BJRw2ikIEmNCDDCVDz3vc7G7v1VGfVVGXMVAEEBAQEBAQE9Bn0eiB7GAgICAgICAjoM+gCRcYIiGP22CMAAAAASUVORK5CYII=",
  "base64",
);
await fs.writeFile(path.join(vault, "Math/image.png"), png);
files.set("Math/image.png", file("Math/image.png"));
const point = (offset) => ({
  offset,
  line: text.slice(0, offset).split("\n").length - 1,
  col: offset - (text.lastIndexOf("\n", offset - 1) + 1),
});
const position = (value) => {
  const offset = text.indexOf(value);
  return { start: point(offset), end: point(offset + value.length) };
};
const headings = [...text.matchAll(/^(#{1,6}) (.+)$/gm)].map((m) => ({
  heading: m[2],
  level: m[1].length,
  position: { start: point(m.index), end: point(m.index + m[0].length) },
}));
const cache = {
  frontmatter: { aliases: ["Bayesian inference"] },
  headings,
  blocks: { rule: { position: position("Body ^rule") } },
};
assert.ok(verifyColdNavigationCache(text, cache));
assert.equal(verifyColdNavigationCache(text, null), null);
assert.equal(
  verifyColdNavigationCache(text + "\n## New heading\n", cache),
  null,
);
assert.equal(
  verifyColdNavigationCache(text + "\nNew block ^new-block\n", cache),
  null,
);
assert.equal(verifyColdNavigationCache("\n" + text, cache), null);
assert.equal(
  verifyColdNavigationCache(text.replace("^rule", "^gone"), cache),
  null,
);
assert.equal(
  verifyColdNavigationCache(text, { ...cache, headings: headings.slice(1) }),
  null,
);
assert.equal(verifyColdNavigationCache(text, { ...cache, blocks: {} }), null);
assert.ok(
  verifyColdNavigationCache(
    text +
      "\n```md\n# not a heading\ntext ^not-a-block\n```\n%%\n# hidden\n%%\n",
    cache,
  ),
);
const wrongPoint = globalThis.structuredClone(cache);
wrongPoint.headings[0].position.end.col++;
assert.equal(verifyColdNavigationCache(text, wrongPoint), null);
const staleBlockStart = globalThis.structuredClone(cache);
staleBlockStart.blocks.rule.position.start = point(0);
assert.equal(verifyColdNavigationCache(text, staleBlockStart), null);
let listCount = 0;
const host = {
  vaultRoot: vault,
  files: () => {
    listCount++;
    return [...files.values()];
  },
  cache: (file) => (file.path === "Math/Bayes.md" ? cache : null),
  file: (value) => files.get(value) ?? null,
  resolve: (link, source) => {
    for (const candidate of [
      path.posix.normalize(path.posix.join(path.posix.dirname(source), link)),
      link,
    ]) {
      const found = files.get(candidate) ?? files.get(candidate + ".md");
      if (found) return found;
    }
    return null;
  },
};
const service = new NoteQueryService(host, {
  queueDirectory: queue,
  vaultId: "vault-c",
  enabled: true,
  readFolders: [],
});
const services = [service];
const request = (operation, input, overrides = {}) => {
  const now = Date.now();
  return {
    readProtocolVersion: 1,
    requestId: randomUUID(),
    targetVaultId: "vault-c",
    pairingEpoch: service.epoch,
    clientSessionId: "test",
    generation: 1,
    operation,
    input,
    issuedAt: now,
    expiresAt: now + L.maxTTL,
    ...overrides,
  };
};
const namespace = path.join(queue, "note-query");
const transport = {
  async read(relative, max) {
    try {
      const bytes = await fs.readFile(path.join(namespace, relative));
      assert.ok(bytes.length <= max);
      return JSON.parse(bytes);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  },
  async publish(relative, value) {
    const target = path.join(namespace, relative);
    await fs.writeFile(target + ".tmp", JSON.stringify(value));
    await fs.rename(target + ".tmp", target);
  },
  async remove(relative) {
    await fs.rm(path.join(namespace, relative), { force: true });
  },
};
const client = new NoteQueryClient(transport, "vault-c");
const extraClients = [];
try {
  await fs.mkdir(path.join(vault, "Bench"));
  for (let i = 0; i < 10000; i++) {
    const name = `Bench/Note-${String(i).padStart(5, "0")}.md`;
    await fs.writeFile(path.join(vault, name), `# Note ${i}\n`);
    files.set(name, file(name));
  }
  await service.start();
  const HostAbortController = globalThis.AbortController;
  const sandboxClient = new NoteQueryClient(
    transport,
    "vault-c",
    () => new HostAbortController(),
  );
  try {
    globalThis.AbortController = undefined;
    const result = await sandboxClient.query("resolve-link", {
      linkpath: "Math/Bayes",
      sourcePath: "Root.md",
    });
    assert.equal(
      result.status,
      "ok",
      "Zotero sandbox uses the host window's AbortController",
    );
  } finally {
    globalThis.AbortController = HostAbortController;
    sandboxClient.close();
  }
  const cachePartition = "c6-offline-roundtrip";
  const cacheClient = new NoteQueryClient(
    transport,
    "vault-c",
    undefined,
    cachePartition,
  );
  extraClients.push(cacheClient);
  const cachedResolution = await cacheClient.query("resolve-link", {
    linkpath: "Math/Bayes",
    sourcePath: "Root.md",
  });
  assert.equal(cachedResolution.status, "ok");
  const cachedNoteResponse = await cacheClient.query("read-note", {
    path: cachedResolution.result.path,
  });
  assert.equal(cachedNoteResponse.status, "ok");
  const cachedResourceResponse = await cacheClient.query("read-note-resource", {
    linkpath: "image.png",
    sourcePath: "Math/Bayes.md",
  });
  assert.equal(cachedResourceResponse.status, "ok");
  const offlineTransport = { ...transport, read: async () => null };
  const offlineClient = new NoteQueryClient(
    offlineTransport,
    "vault-c",
    undefined,
    cachePartition,
  );
  extraClients.push(offlineClient);
  await assert.rejects(
    offlineClient.query("resolve-link", {
      linkpath: "Math/Bayes",
      sourcePath: "Root.md",
    }),
    (error) => error.status === "offline",
  );
  const offlineSnapshot = await offlineClient.cachedResolution(
    "Root.md",
    "Math/Bayes",
  );
  assert.equal(offlineSnapshot.resolved.path, "Math/Bayes.md");
  assert.equal(offlineSnapshot.note.markdown, text);
  assert.equal(
    (
      await offlineClient.cachedResources(
        "Math/Bayes.md",
        offlineSnapshot.note.revision,
      )
    ).get("Math/Bayes.md\0image.png").base64,
    png.toString("base64"),
  );
  const emptyOfflineClient = new NoteQueryClient(
    offlineTransport,
    "vault-c",
    undefined,
    "c6-empty-offline-partition",
  );
  extraClients.push(emptyOfflineClient);
  await assert.rejects(
    emptyOfflineClient.cachedResolution("Root.md", "NeverCached"),
    (error) => error.status === "offline",
  );

  let releaseDelayedResponse;
  let signalDelayedResponse;
  const responseReached = new Promise((resolve) => {
    signalDelayedResponse = resolve;
  });
  const delayedGate = new Promise((resolve) => {
    releaseDelayedResponse = resolve;
  });
  let delayNextResponse = true;
  const delayedClient = new NoteQueryClient(
    {
      ...transport,
      async read(relative, max) {
        if (relative.startsWith("responses/") && delayNextResponse) {
          delayNextResponse = false;
          signalDelayedResponse();
          await delayedGate;
        }
        return transport.read(relative, max);
      },
    },
    "vault-c",
    undefined,
    "c6-late-response-partition",
  );
  extraClients.push(delayedClient);
  const delayedQuery = delayedClient.query("read-note", {
    path: "Root.md",
  });
  await responseReached;
  clearKnowledgeNoteMemoryCache();
  releaseDelayedResponse();
  await assert.rejects(delayedQuery, (error) => error.status === "stale");

  const capabilities = service.capabilities();
  assert.equal(
    capabilities.expiresAt - capabilities.updatedAt,
    NOTE_QUERY_CAPABILITIES_TTL,
  );
  assert.doesNotThrow(() =>
    validateNoteQueryCapabilities(
      capabilities,
      capabilities.updatedAt + 60_000,
    ),
  );
  assert.throws(() =>
    validateNoteQueryCapabilities(capabilities, capabilities.expiresAt + 1),
  );
  assert.throws(() =>
    validateNoteQueryCapabilities(
      { ...capabilities, expiresAt: capabilities.updatedAt + 120_001 },
      capabilities.updatedAt,
    ),
  );
  const original = await fs.readFile(path.join(vault, "Math/Bayes.md"), "utf8");
  let read = await service.handle(
    request("read-note", { path: "Math/Bayes.md" }),
  );
  assert.equal(read.status, "ok");
  assert.equal(
    read.result.metadata.valid,
    true,
    "cold-start navigation cache is verified against saved Markdown",
  );
  service.update(files.get("Math/Bayes.md"), text, cache);
  read = await service.handle(request("read-note", { path: "Math/Bayes.md" }));
  assert.equal(read.result.metadata.valid, true);
  assert.equal(read.result.markdown, text);
  for (const [fragment, state] of [
    ["Parent#Child", "found"],
    ["^rule", "found"],
    ["Missing", "missing"],
    ["Duplicate", "ambiguous"],
  ]) {
    const resolved = await service.handle(
      request("resolve-link", {
        linkpath: `Bayes#${fragment}`,
        sourcePath: "Math/Shared.md",
      }),
    );
    assert.equal(resolved.status, "ok");
    assert.equal(resolved.result.path, "Math/Bayes.md");
    assert.equal(resolved.result.anchorState, state);
  }
  for (const source of ["Math/Bayes.md", "Physics/Shared.md"]) {
    const resolved = await service.handle(
      request("resolve-link", { linkpath: "Shared", sourcePath: source }),
    );
    assert.equal(
      resolved.result.path,
      `${path.posix.dirname(source)}/Shared.md`,
    );
  }
  assert.equal(
    (
      await service.handle(
        request("resolve-link", { linkpath: "Missing", sourcePath: "Root.md" }),
      )
    ).status,
    "not-found",
  );
  const resource = await service.handle(
    request("read-note-resource", {
      linkpath: "image.png",
      sourcePath: "Math/Bayes.md",
    }),
  );
  assert.equal(resource.status, "ok");
  assert.equal(resource.result.base64, png.toString("base64"));
  assert.equal(
    (
      await service.handle(
        request("read-note-resource", {
          linkpath: "Bayes.md",
          sourcePath: "Math/Shared.md",
        }),
      )
    ).status,
    "unsupported",
  );
  for (const overrides of [{ targetVaultId: "other" }, { pairingEpoch: "old" }])
    assert.equal(
      (
        await service.handle(
          request("read-note", { path: "Root.md" }, overrides),
        )
      ).status,
      "forbidden",
    );
  for (const value of [
    "../secret.md",
    "/etc/passwd",
    "Math/../Root.md",
    "a\\b",
    "a/%2e%2e/b",
  ])
    assert.throws(() =>
      validateNoteQueryRequest(request("read-note", { path: value })),
    );
  for (const value of [
    ".obsidian/config.md",
    "Math/.secret.md",
    "recovery/a.md",
    "Bridge Recovery/a.md",
    ".trash/a.md",
  ])
    assert.equal(allowedNotePath(value, []), false);
  await fs.symlink(path.join(vault, "Root.md"), path.join(vault, "alias.md"));
  assert.equal(
    (await service.handle(request("read-note", { path: "alias.md" }))).status,
    "forbidden",
  );
  await fs.symlink(root, path.join(vault, "outside"));
  assert.equal(
    (
      await service.handle(
        request("read-note", { path: "outside/vault/Root.md" }),
      )
    ).status,
    "forbidden",
  );
  await fs.writeFile(
    path.join(vault, "large.md"),
    "x".repeat(L.maxNoteBytes + 1),
  );
  assert.equal(
    (await service.handle(request("read-note", { path: "large.md" }))).status,
    "too-large",
  );
  await fs.writeFile(path.join(vault, "Math/Bayes.md"), text + "changed");
  assert.equal(
    (await service.handle(request("read-note", { path: "Math/Bayes.md" })))
      .result.metadata.valid,
    false,
  );
  await fs.writeFile(path.join(vault, "Math/Bayes.md"), original);

  // A single changed-file event updates the initial 10k index without listing the Vault again.
  service.update(files.get("Bench/Note-00001.md"));
  service.remove("Bench/Note-00002.md");
  const removed = await service.handle(
    request("search-notes", { query: "Note-00002", sourcePath: "Root.md" }),
  );
  assert.deepEqual(removed.result.items, []);
  const timings = [];
  await fs.mkdir(path.join(queue, "requests"));
  await fs.writeFile(
    path.join(queue, "requests", "pending-write.json"),
    "unrelated write queue remains busy",
  );
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    const search = await client.query("search-notes", {
      query: "Bayes",
      sourcePath: "Root.md",
      limit: 20,
    });
    assert.equal(search.status, "ok");
    assert.ok(
      search.result.items.some((item) => item.path === "Math/Bayes.md"),
    );
    timings.push(performance.now() - start);
  }
  assert.equal(listCount, 1);
  assert.equal(service.initialBuilds, 1);
  assert.equal(
    await fs.readFile(
      path.join(queue, "requests", "pending-write.json"),
      "utf8",
    ),
    "unrelated write queue remains busy",
  );
  const first = client
    .search({ query: "never", sourcePath: "Root.md" })
    .catch((e) => e.status);
  const latest = client.search({ query: "Bayes", sourcePath: "Root.md" });
  assert.equal(await first, "cancelled");
  assert.equal((await latest).status, "ok");
  const staleClient = new NoteQueryClient(
    {
      ...transport,
      async read(relative, max) {
        const value = await transport.read(relative, max);
        if (relative.startsWith("responses/") && value) value.generation++;
        return value;
      },
    },
    "vault-c",
  );
  await assert.rejects(
    staleClient.query("read-note", { path: "Root.md" }),
    (error) => error.status === "stale",
  );
  staleClient.close();
  const oldClient = new NoteQueryClient(
    { ...transport, read: async () => null },
    "vault-c",
  );
  await assert.rejects(
    oldClient.query("read-note", { path: "Root.md" }),
    (error) => error.status === "offline",
  );
  oldClient.close();

  const restrictedQueue = path.join(root, "restricted-queue");
  await fs.mkdir(restrictedQueue);
  const restricted = new NoteQueryService(host, {
    queueDirectory: restrictedQueue,
    vaultId: "vault-c",
    enabled: true,
    readFolders: ["Math"],
  });
  services.push(restricted);
  await restricted.start();
  assert.equal(
    (
      await restricted.handle(
        request(
          "read-note",
          { path: "Root.md" },
          { pairingEpoch: restricted.epoch },
        ),
      )
    ).status,
    "forbidden",
  );
  assert.equal(
    (
      await restricted.handle(
        request(
          "read-note",
          { path: "Math/Bayes.md" },
          { pairingEpoch: restricted.epoch },
        ),
      )
    ).status,
    "ok",
  );
  await restricted.stop();

  // Real file transport, but a silent companion for timeout/cancel cleanup.
  await service.stop();
  const caps = service.capabilities();
  caps.enabled = true;
  caps.ready = true;
  await fs.writeFile(
    path.join(namespace, "capabilities.json"),
    JSON.stringify(caps),
  );
  const pending = Array.from({ length: 4 }, () =>
    client
      .query("read-note", { path: "Root.md" }, { timeoutMs: 30 })
      .catch((error) => error.status),
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(
    client.query("read-note", { path: "Root.md" }),
    (error) => error.status === "busy",
  );
  assert.deepEqual(await Promise.all(pending), [
    "timeout",
    "timeout",
    "timeout",
    "timeout",
  ]);
  for (let i = 0; i < 100; i++) {
    const controller = new globalThis.AbortController();
    const promise = client.query(
      "read-note",
      { path: "Root.md" },
      { timeoutMs: 20, signal: controller.signal },
    );
    if (i % 2 === 0) setTimeout(() => controller.abort(), 5);
    await assert.rejects(promise, (error) =>
      ["cancelled", "timeout"].includes(error.status),
    );
  }
  assert.equal(client.inFlight, 0);
  assert.deepEqual(await fs.readdir(path.join(namespace, "requests")), []);
  assert.deepEqual(await fs.readdir(path.join(namespace, "responses")), []);
  await fs.writeFile(path.join(namespace, "responses", "orphan.json"), "{}");
  await service.sweep(Date.now() + 35000);
  assert.deepEqual(await fs.readdir(path.join(namespace, "responses")), []);
  assert.equal(
    await fs.readFile(path.join(vault, "Math/Bayes.md"), "utf8"),
    original,
  );
  assert.throws(() => validateNoteQueryResponse({}));
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        tests:
          "four operations, permissions, symlinks, limits, stale cache/response, anchors, busy write namespace, latest-wins, 100 cancel/timeout cleanup",
        indexEntries: 10004,
        initialBuilds: 1,
        roundTripMs: {
          min: Math.min(...timings),
          max: Math.max(...timings),
          mean: timings.reduce((a, b) => a + b, 0) / timings.length,
        },
      },
      null,
      2,
    ),
  );
} finally {
  client.close();
  for (const extraClient of extraClients) extraClient.close();
  for (const item of services) await item.stop();
  await fs.rm(root, { recursive: true, force: true });
}
