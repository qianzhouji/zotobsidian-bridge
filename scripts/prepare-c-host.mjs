import { promises as fs, constants } from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { build } from "esbuild";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scaffold = await fs.realpath(path.join(repo, ".scaffold"));
const paths = Object.fromEntries(
  ["profile", "data", "vault", "queue", "obsidian-profile"].map((key) => [
    key,
    path.join(scaffold, `c-${key}`),
  ]),
);
const manifestPath = path.join(scaffold, "c-host-manifest.json");
const command = process.argv[2];
if (!["prepare", "launch"].includes(command)) {
  console.log(
    "Usage: node scripts/prepare-c-host.mjs prepare|launch (C isolation only; explicit approval required)",
  );
} else if (command === "prepare") {
  execFileSync(process.execPath, ["scripts/create-c0-fixture.mjs", "--check"], {
    cwd: repo,
    stdio: "inherit",
  });
  for (const name of ["profile", "data", "obsidian-profile"]) {
    try {
      await fs.lstat(paths[name]);
      throw new Error(`Refusing existing ${name}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const xpi = path.join(scaffold, "build/zotero-obsidian-bridge.xpi");
  const xpiBytes = await fs.readFile(xpi);
  const vaultId = randomUUID();
  for (const name of ["profile", "data", "obsidian-profile"])
    await fs.mkdir(paths[name]);
  await fs.mkdir(path.join(paths.profile, "extensions"));
  await fs.copyFile(
    xpi,
    path.join(paths.profile, "extensions/zotobsidian-bridge@qianzhouji.xpi"),
    constants.COPYFILE_EXCL,
  );
  const prefix = "extensions.zotero.zoteroobsidianbridge";
  const prefs = {
    "extensions.zotero.useDataDir": true,
    "extensions.zotero.dataDir": paths.data,
    "extensions.zotero.httpServer.port": 23127,
    "extensions.zotero.httpServer.enabled": true,
    "extensions.zotero.httpServer.localAPI.enabled": true,
    "extensions.zotero.firstRun2": false,
    "extensions.autoDisableScopes": 0,
    [`${prefix}.vaultPath`]: paths.vault,
    [`${prefix}.outputFolder`]: "Zotero Literature",
    [`${prefix}.writerMode`]: "companion",
    [`${prefix}.readerMode`]: "bridge",
    [`${prefix}.companionQueuePath`]: paths.queue,
    [`${prefix}.companionVaultId`]: vaultId,
  };
  await fs.writeFile(
    path.join(paths.profile, "user.js"),
    Object.entries(prefs)
      .map(
        ([key, value]) =>
          `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
      )
      .join("\n") + "\n",
    { flag: "wx" },
  );
  const pluginDir = path.join(
    paths.vault,
    ".obsidian/plugins/zotero-card-bridge",
  );
  await fs.mkdir(pluginDir, { recursive: true });
  for (const name of ["main.js", "manifest.json", "LICENSE"])
    await fs.copyFile(
      path.join(scaffold, "obsidian-plugin", name),
      path.join(pluginDir, name),
      constants.COPYFILE_EXCL,
    );
  await fs.writeFile(
    path.join(pluginDir, "data.json"),
    JSON.stringify(
      {
        queueDirectory: paths.queue,
        vaultId,
        outputFolder: "Zotero Literature",
        notePreviewEnabled: true,
        noteReadFolders: [],
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  await fs.writeFile(
    path.join(paths.vault, ".obsidian/community-plugins.json"),
    '["zotero-card-bridge"]\n',
    { flag: "wx" },
  );
  await fs.writeFile(
    path.join(paths.vault, ".obsidian/core-plugins.json"),
    '["file-explorer","search","backlink","outgoing-link","page-preview"]\n',
    { flag: "wx" },
  );
  await fs.writeFile(
    path.join(paths["obsidian-profile"], "obsidian.json"),
    JSON.stringify({
      vaults: { c0fixture: { path: paths.vault, ts: Date.now(), open: true } },
    }),
    { flag: "wx" },
  );
  await build({
    entryPoints: [path.join(repo, "scripts/c0-overlay-probe.js")],
    bundle: true,
    format: "iife",
    globalName: "ZobC0Probe",
    outfile: path.join(scaffold, "c0-overlay-probe.js"),
  });
  const manifest = {
    paths,
    vaultId,
    xpiSHA256: createHash("sha256").update(xpiBytes).digest("hex"),
    preparedAt: new Date().toISOString(),
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
    flag: "wx",
  });
  console.log(JSON.stringify(manifest, null, 2));
} else {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (JSON.stringify(manifest.paths) !== JSON.stringify(paths))
    throw new Error("Isolation paths changed");
  for (const value of Object.values(paths))
    if ((await fs.realpath(value)) !== value)
      throw new Error("Unsafe isolation path");
  const ps = execFileSync("ps", ["-axo", "pid,args"], { encoding: "utf8" });
  for (const [app, args, marker] of [
    [
      "/Applications/Zotero.app/Contents/MacOS/zotero",
      ["-no-remote", "-profile", paths.profile, "--dataDir", paths.data],
      paths.profile,
    ],
    [
      "/Applications/Obsidian.app/Contents/MacOS/Obsidian",
      [`--user-data-dir=${paths["obsidian-profile"]}`, paths.vault],
      paths["obsidian-profile"],
    ],
  ]) {
    if (
      ps.split("\n").some((line) => line.includes(app) && line.includes(marker))
    ) {
      console.log(`Already running: ${marker}`);
      continue;
    }
    const child = spawn(app, args, { detached: true, stdio: "ignore" });
    child.unref();
    console.log(`Started PID ${child.pid}: ${marker}`);
  }
}
