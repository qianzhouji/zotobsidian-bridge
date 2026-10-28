import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { verifyPackage } from "./verify-package.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageInfo = JSON.parse(
  await fs.readFile(path.join(projectRoot, "package.json"), "utf8"),
);
const companionInfo = JSON.parse(
  await fs.readFile(
    path.join(projectRoot, "obsidian-plugin/package.json"),
    "utf8",
  ),
);
const source = path.join(
  projectRoot,
  ".scaffold/build/zotero-obsidian-bridge.xpi",
);
const outputDirectory = path.join(projectRoot, ".scaffold/release");
const fileName = `zotero-obsidian-bridge-v${packageInfo.version}.xpi`;
const destination = path.join(outputDirectory, fileName);
const companionDirectory = path.join(projectRoot, ".scaffold/obsidian-plugin");
const companionZipName = `zotero-obsidian-bridge-companion-v${companionInfo.version}.zip`;
const companionZip = path.join(outputDirectory, companionZipName);

const audit = verifyPackage(source);
for (const file of ["main.js", "manifest.json"]) {
  await fs.access(path.join(companionDirectory, file));
}
await fs.mkdir(outputDirectory, { recursive: true });
await fs.copyFile(source, destination);
const licenseText = await fs.readFile(
  path.join(projectRoot, "LICENSE"),
  "utf8",
);
const noticesText = await fs.readFile(
  path.join(projectRoot, "THIRD_PARTY_NOTICES.txt"),
  "utf8",
);
if (!licenseText.includes("GNU AFFERO GENERAL PUBLIC LICENSE")) {
  throw new Error(
    "The project LICENSE does not contain the declared AGPL text.",
  );
}
if (!noticesText.includes("THIRD-PARTY SOFTWARE NOTICES")) {
  throw new Error("The third-party license inventory is missing or empty.");
}
await fs.copyFile(
  path.join(projectRoot, "LICENSE"),
  path.join(companionDirectory, "LICENSE"),
);
const digest = createHash("sha256")
  .update(await fs.readFile(destination))
  .digest("hex");
await fs.writeFile(`${destination}.sha256`, `${digest}  ${fileName}\n`, "utf8");

await fs.rm(companionZip, { force: true });
execFileSync(
  "zip",
  ["-j", companionZip, "main.js", "manifest.json", "LICENSE"],
  {
    cwd: companionDirectory,
    stdio: "pipe",
  },
);
const companionEntries = execFileSync("unzip", ["-Z1", companionZip], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean)
  .sort();
if (companionEntries.join(",") !== "LICENSE,main.js,manifest.json") {
  throw new Error("Companion package contains unexpected or missing files.");
}
const companionLicense = execFileSync(
  "unzip",
  ["-p", companionZip, "LICENSE"],
  {
    encoding: "utf8",
  },
);
if (!companionLicense.includes("GNU AFFERO GENERAL PUBLIC LICENSE")) {
  throw new Error(
    "The companion package is missing the declared AGPL license text.",
  );
}
const companionManifest = JSON.parse(
  await fs.readFile(path.join(companionDirectory, "manifest.json"), "utf8"),
);
if (
  companionManifest.id !== "zotero-card-bridge" ||
  companionInfo.version !== packageInfo.version ||
  companionManifest.version !== companionInfo.version ||
  companionManifest.isDesktopOnly !== true ||
  companionManifest.main !== undefined
) {
  throw new Error(
    "Companion package identity, paired version, or manifest failed its package audit.",
  );
}
const companionDigest = createHash("sha256")
  .update(await fs.readFile(companionZip))
  .digest("hex");
await fs.writeFile(
  `${companionZip}.sha256`,
  `${companionDigest}  ${companionZipName}\n`,
  "utf8",
);

process.stdout.write(
  `Prepared ${destination}\nSHA-256 ${digest}\nPrepared ${companionZip}\nSHA-256 ${companionDigest}\n`,
);
for (const warning of audit.warnings) {
  process.stdout.write(`Not release-ready: ${warning}\n`);
}
