import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scaffold = await fs.realpath(path.join(repo, ".scaffold"));
const manifest = JSON.parse(
  await fs.readFile(path.join(scaffold, "c-host-manifest.json"), "utf8"),
);
const expected = {
  vault: path.join(scaffold, "c-vault"),
  "obsidian-profile": path.join(scaffold, "c-obsidian-profile"),
};
assert.deepEqual(manifest.paths.vault, expected.vault);
assert.deepEqual(
  manifest.paths["obsidian-profile"],
  expected["obsidian-profile"],
);
for (const target of Object.values(expected))
  assert.equal(await fs.realpath(target), target);

const app = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const args = [
  `--user-data-dir=${expected["obsidian-profile"]}`,
  expected.vault,
];
const expectedCommand = `${app} ${args.join(" ")}`;
const running = () => {
  const matches = execFileSync("ps", ["-axo", "pid=,args="], {
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match?.[2] === expectedCommand)
    .map((match) => Number(match[1]));
  return matches;
};
const pidList = running();
assert.equal(
  pidList.length,
  1,
  "expected exactly one C-isolated Obsidian process",
);

const source = path.join(scaffold, "obsidian-plugin/main.js");
const target = path.join(
  expected.vault,
  ".obsidian/plugins/zotero-card-bridge/main.js",
);
assert.equal(await fs.realpath(source), source);
assert.equal(await fs.realpath(target), target);
const bytes = await fs.readFile(source);
const backup = path.join(
  scaffold,
  "c-install-backups",
  `${Date.now()}-obsidian-refresh`,
);
await fs.mkdir(backup, { recursive: true });
await fs.copyFile(target, path.join(backup, "main.js"));

process.kill(pidList[0], "SIGTERM");
for (let i = 0; running().length && i < 100; i++) await delay(100);
assert.deepEqual(
  running(),
  [],
  "C Obsidian did not exit; package not replaced",
);

const temporary = `${target}.new`;
await fs.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
await fs.rename(temporary, target);
const companionSHA256 = createHash("sha256").update(bytes).digest("hex");
manifest.companionSHA256 = companionSHA256;
manifest.refreshedAt = new Date().toISOString();
await fs.writeFile(
  path.join(scaffold, "c-host-manifest.json"),
  JSON.stringify(manifest, null, 2),
);

const child = spawn(app, args, { detached: true, stdio: "ignore" });
child.unref();
for (let i = 0; i < 100 && running().length !== 1; i++) await delay(100);
assert.equal(
  running().length,
  1,
  "C Obsidian did not restart with isolated arguments",
);
console.log(
  JSON.stringify(
    { result: "C Obsidian companion refreshed", companionSHA256, backup },
    null,
    2,
  ),
);
