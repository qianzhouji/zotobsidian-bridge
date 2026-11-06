import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scaffold = await fs.realpath(path.join(repo, ".scaffold"));
const manifestPath = path.join(scaffold, "c-host-manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
for (const [key, value] of Object.entries(manifest.paths)) {
  assert.equal(value, path.join(scaffold, `c-${key}`));
  assert.equal(await fs.realpath(value), value);
}
const appCommands = [
  `/Applications/Zotero.app/Contents/MacOS/zotero -no-remote -profile ${manifest.paths.profile} --dataDir ${manifest.paths.data}`,
  `/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=${manifest.paths["obsidian-profile"]} ${manifest.paths.vault}`,
];
const running = () =>
  execFileSync("ps", ["-axo", "pid=,args="], { encoding: "utf8" })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match && appCommands.includes(match[2]))
    .map((match) => Number(match[1]));
const plugin = path.join(
  manifest.paths.vault,
  ".obsidian/plugins/zotero-card-bridge",
);
const destinations = [
  [
    path.join(scaffold, "build/zotero-obsidian-bridge.xpi"),
    path.join(
      manifest.paths.profile,
      "extensions/zotobsidian-bridge@qianzhouji.xpi",
    ),
  ],
  ...["main.js", "manifest.json", "LICENSE"].map((name) => [
    path.join(scaffold, "obsidian-plugin", name),
    path.join(plugin, name),
  ]),
];
const packages = [];
for (const [source, target] of destinations) {
  assert.equal(await fs.realpath(target), target);
  assert.equal((await fs.lstat(target)).nlink, 1);
  packages.push({ target, bytes: await fs.readFile(source) });
}
// Keep rollback copies before stopping precisely identified isolated processes.
const backup = path.join(scaffold, "c-install-backups", String(Date.now()));
await fs.mkdir(backup, { recursive: true });
for (const { target } of packages)
  await fs.copyFile(target, path.join(backup, path.basename(target)));
for (const pid of running()) {
  if (!running().includes(pid)) continue;
  process.kill(pid, "SIGTERM");
}
for (let i = 0; running().length && i < 100; i++) await delay(100);
assert.deepEqual(
  running(),
  [],
  "C applications did not exit; nothing installed",
);
const hashes = {};
for (const { target, bytes } of packages) {
  await fs.writeFile(target + ".new", bytes, { flag: "wx" });
  await fs.rename(target + ".new", target);
  hashes[path.basename(target)] = createHash("sha256")
    .update(bytes)
    .digest("hex");
}
manifest.xpiSHA256 = hashes["zotobsidian-bridge@qianzhouji.xpi"];
manifest.companionSHA256 = hashes["main.js"];
manifest.refreshedAt = new Date().toISOString();
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
execFileSync(process.execPath, ["scripts/prepare-c-host.mjs", "launch"], {
  cwd: repo,
  stdio: "inherit",
});
console.log(
  JSON.stringify(
    { result: "C isolated packages refreshed", hashes, backup },
    null,
    2,
  ),
);
