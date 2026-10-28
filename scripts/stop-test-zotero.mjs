import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const expectedProfile = resolve(projectRoot, ".scaffold/profile");
const expectedData = resolve(projectRoot, ".scaffold/data");
const expectedLauncher = resolve(projectRoot, "scripts/zotero-dev-launcher.sh");
const profilePath = process.env.ZOTERO_PLUGIN_PROFILE_PATH;
const dataPath = process.env.ZOTERO_PLUGIN_DATA_DIR;
const launcherPath = process.env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH;
const binaryPath = process.env.BRIDGE_ZOTERO_PROCESS_BIN_PATH;

if (
  !profilePath ||
  !dataPath ||
  !launcherPath ||
  !binaryPath ||
  resolve(profilePath) !== expectedProfile ||
  resolve(dataPath) !== expectedData ||
  resolve(launcherPath) !== expectedLauncher
) {
  throw new Error(
    "Refusing to stop Zotero: development paths are not isolated.",
  );
}

const processes = execFileSync("ps", ["-axo", "pid=,command="], {
  encoding: "utf8",
});

for (const line of processes.split("\n")) {
  const match = line.match(/^\s*(\d+)\s+(.*)$/);
  if (!match) continue;

  const [, pidText, command] = match;
  if (
    !command.startsWith(`${binaryPath} `) ||
    !command.includes(`-profile ${profilePath}`) ||
    !command.includes(`--dataDir ${dataPath}`)
  ) {
    continue;
  }

  process.kill(Number(pidText), "SIGTERM");
}
