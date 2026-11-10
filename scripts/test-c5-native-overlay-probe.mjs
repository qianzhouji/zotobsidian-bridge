import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(
  join(root, "native/macos/desktop-overlay-probe.swift"),
  "utf8",
);

for (const requirement of [
  ".nonactivatingPanel",
  "ignoresMouseEvents = true",
  "isOpaque = false",
  "orderFrontRegardless()",
  ".canJoinAllSpaces",
  ".fullScreenAuxiliary",
  "seconds <= 30",
  "command-too-large",
]) {
  assert.ok(
    source.includes(requirement),
    `native helper is missing ${requirement}`,
  );
}

await execFileAsync("node", [
  join(root, "scripts/build-c5-native-overlay-probe.mjs"),
]);
process.stdout.write("Native overlay probe build and guard checks passed.\n");
