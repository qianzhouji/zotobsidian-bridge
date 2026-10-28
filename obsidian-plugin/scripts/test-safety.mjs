import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  assertQueueOutsideVault,
  assertVaultPathContained,
} from "../src/path-safety.ts";
import { isRetryableFileError, retryDelayMs } from "../src/retry-policy.ts";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zob-safety-"));
try {
  const vault = path.join(tempRoot, "vault");
  const external = path.join(tempRoot, "external");
  const externalQueue = path.join(tempRoot, "queue");
  await Promise.all([
    fs.mkdir(vault, { recursive: true }),
    fs.mkdir(external, { recursive: true }),
  ]);

  await assertQueueOutsideVault(vault, externalQueue);
  await assert.rejects(
    assertQueueOutsideVault(vault, path.join(vault, "queue")),
    /outside the Obsidian Vault/,
  );

  await fs.symlink(vault, path.join(external, "vault-link"), "dir");
  await assert.rejects(
    assertQueueOutsideVault(vault, path.join(external, "vault-link", "queue")),
    /including through symbolic links/,
  );

  await fs.symlink(external, path.join(vault, "external-link"), "dir");
  await assert.rejects(
    assertVaultPathContained(vault, "external-link/note.md"),
    /outside the configured Vault/,
  );
  await fs.mkdir(path.join(vault, "safe"));
  await assert.doesNotReject(
    assertVaultPathContained(vault, "safe/new-note.md"),
  );

  await fs.symlink(
    path.join(tempRoot, "missing-target"),
    path.join(vault, "broken-link"),
    "dir",
  );
  await assert.rejects(
    assertVaultPathContained(vault, "broken-link/note.md"),
    /Cannot resolve symbolic link/,
  );
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

assert.equal(retryDelayMs(1), 1_000);
assert.equal(retryDelayMs(2), 2_000);
assert.equal(retryDelayMs(9), 30_000);
assert.equal(retryDelayMs(Number.NaN), 1_000);
assert.equal(isRetryableFileError({ code: "EBUSY" }), true);
assert.equal(isRetryableFileError({ code: "ENOSPC" }), true);
assert.equal(isRetryableFileError({ code: "ENOENT" }), true);
assert.equal(isRetryableFileError(new Error("invalid request")), false);

process.stdout.write("Companion path and retry policy checks passed.\n");
