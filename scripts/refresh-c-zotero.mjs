import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = await fs.realpath(path.join(repo, ".scaffold"));
const manifestPath = path.join(base, "c-host-manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
for (const key of ["profile", "data"]) {
  assert.equal(manifest.paths[key], path.join(base, `c-${key}`));
  assert.equal(await fs.realpath(manifest.paths[key]), manifest.paths[key]);
}
const executable = "/Applications/Zotero.app/Contents/MacOS/zotero";
const args = [
  "-no-remote",
  "-profile",
  manifest.paths.profile,
  "--dataDir",
  manifest.paths.data,
];
const command = [executable, ...args].join(" ");
const pids = () =>
  execFileSync("ps", ["-axo", "pid=,args="], { encoding: "utf8" })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match && match[2] === command)
    .map((match) => Number(match[1]));
const target = path.join(
  manifest.paths.profile,
  "extensions/zotobsidian-bridge@qianzhouji.xpi",
);
assert.equal(await fs.realpath(target), target);
assert.equal((await fs.lstat(target)).nlink, 1);
const bytes = await fs.readFile(
  path.join(base, "build/zotero-obsidian-bridge.xpi"),
);
const backup = path.join(
  base,
  "c-install-backups",
  `${Date.now()}-zotero-only`,
);
await fs.mkdir(backup, { recursive: true });
await fs.copyFile(target, path.join(backup, path.basename(target)));
for (const pid of pids()) process.kill(pid, "SIGTERM");
for (let i = 0; pids().length && i < 100; i++) await delay(100);
assert.equal(pids().length, 0, "C Zotero did not exit; nothing installed");
await fs.writeFile(target + ".new", bytes, { flag: "wx" });
await fs.rename(target + ".new", target);
manifest.xpiSHA256 = createHash("sha256").update(bytes).digest("hex");
manifest.refreshedAt = new Date().toISOString();
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const child = spawn(executable, args, { detached: true, stdio: "ignore" });
child.unref();
console.log(
  JSON.stringify({ pid: child.pid, sha256: manifest.xpiSHA256, backup }),
);
