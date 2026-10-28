import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const rootPackage = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const companionPackage = JSON.parse(
  fs.readFileSync(
    path.join(projectRoot, "obsidian-plugin/package.json"),
    "utf8",
  ),
);
const companionManifest = JSON.parse(
  fs.readFileSync(
    path.join(projectRoot, "obsidian-plugin/manifest.json"),
    "utf8",
  ),
);
const errors = [];
const actualRepository = process.env.GITHUB_REPOSITORY;
const releaseTag = process.env.GITHUB_REF_NAME;
const placeholder = /(example|placeholder|local\.dev|your[-_ ]?name|todo)/i;

if (!actualRepository || !/^[^/]+\/[^/]+$/.test(actualRepository)) {
  errors.push("GITHUB_REPOSITORY must identify the actual owner/repository.");
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rootPackage.version)) {
  errors.push(`Invalid root package version: ${rootPackage.version}`);
}
if (releaseTag !== `v${rootPackage.version}`) {
  errors.push(
    `Release tag ${releaseTag ?? "(missing)"} must match v${rootPackage.version}.`,
  );
}
if (rootPackage.version !== companionPackage.version) {
  errors.push(
    `Zotero (${rootPackage.version}) and companion (${companionPackage.version}) package versions differ.`,
  );
}
if (companionManifest.version !== companionPackage.version) {
  errors.push(
    `Obsidian manifest (${companionManifest.version}) and package (${companionPackage.version}) versions differ.`,
  );
}
if (
  !rootPackage.license ||
  rootPackage.license !== companionPackage.license ||
  !fs.existsSync(path.join(projectRoot, "LICENSE"))
) {
  errors.push(
    "The Zotero and companion package licenses must match and the root LICENSE file must exist.",
  );
}

const repositoryUrl = rootPackage.repository?.url
  ?.replace(/^git\+/, "")
  .replace(/\.git$/, "")
  .replace(/\/$/, "");
const expectedRepositoryUrl = actualRepository
  ? `https://github.com/${actualRepository}`
  : undefined;
if (!expectedRepositoryUrl || repositoryUrl !== expectedRepositoryUrl) {
  errors.push(
    `package.json repository must match ${expectedRepositoryUrl ?? "GITHUB_REPOSITORY"}.`,
  );
}
if (rootPackage.homepage !== expectedRepositoryUrl) {
  errors.push(
    `package.json homepage must match ${expectedRepositoryUrl ?? "GITHUB_REPOSITORY"}.`,
  );
}

const addonId = rootPackage.config?.addonID;
if (
  typeof addonId !== "string" ||
  !addonId.trim() ||
  placeholder.test(addonId)
) {
  errors.push(
    "The Zotero add-on ID is missing or still a development placeholder.",
  );
}
if (
  typeof companionManifest.id !== "string" ||
  !companionManifest.id.trim() ||
  placeholder.test(companionManifest.id) ||
  !/^[a-z-]+$/.test(companionManifest.id) ||
  companionManifest.id.includes("obsidian") ||
  companionManifest.id.endsWith("plugin")
) {
  errors.push(
    "The Obsidian plugin ID is missing, a placeholder, or violates Obsidian ID rules.",
  );
}
if (!companionManifest.isDesktopOnly) {
  errors.push(
    "The companion manifest must retain its desktop-only declaration.",
  );
}

if (errors.length) {
  process.stderr.write(
    `Release configuration is not ready:\n- ${errors.join("\n- ")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Release configuration is consistent for ${actualRepository} at version ${rootPackage.version}.\n`,
  );
}
