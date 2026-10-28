import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageInfo = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const maxBuffer = 32 * 1024 * 1024;

export function verifyPackage(xpiPath) {
  const absoluteXpiPath = path.resolve(xpiPath);
  if (!fs.existsSync(absoluteXpiPath)) {
    throw new Error(`XPI does not exist: ${absoluteXpiPath}`);
  }

  const entries = execFileSync("unzip", ["-Z1", absoluteXpiPath], {
    encoding: "utf8",
    maxBuffer,
  })
    .split(/\r?\n/)
    .filter(Boolean);
  const entrySet = new Set(entries);
  if (entrySet.size !== entries.length) {
    throw new Error("The XPI contains duplicate archive paths.");
  }

  for (const entry of entries) {
    const segments = entry.replaceAll("\\", "/").split("/");
    if (
      entry.startsWith("/") ||
      /^[A-Za-z]:/.test(entry) ||
      segments.includes("..")
    ) {
      throw new Error(`Unsafe archive path: ${entry}`);
    }
    if (
      /(^|\/)(?:\.env(?:\..*)?|\.git|node_modules|\.scaffold|test(?:s)?|test-vault|test-data|profile|fixtures|cache|editor-drafts)(\/|$)/i.test(
        entry,
      )
    ) {
      throw new Error(`Development or test data leaked into XPI: ${entry}`);
    }
    if (/\.(?:pdf|sqlite|db|bak|tmp|map|pem)$/i.test(entry)) {
      throw new Error(
        `Non-runtime or sensitive file leaked into XPI: ${entry}`,
      );
    }
  }

  const requiredEntries = [
    "bootstrap.js",
    "manifest.json",
    "LICENSE",
    "THIRD_PARTY_NOTICES.txt",
    "prefs.js",
    "content/editor.xhtml",
    "content/editor.css",
    "content/batch-progress.xhtml",
    "content/batch-progress.css",
    "content/katex.min.css",
    "content/katex-LICENSE.txt",
    "content/scripts/zoteroobsidianbridge.js",
    "content/scripts/zoteroobsidianbridge-editor.js",
    "content/scripts/zoteroobsidianbridge-batch-progress.js",
    "locale/en-US/zoteroobsidianbridge-preferences.ftl",
    "locale/zh-CN/zoteroobsidianbridge-preferences.ftl",
  ];
  for (const entry of requiredEntries) {
    if (!entrySet.has(entry)) {
      throw new Error(`Required XPI entry is missing: ${entry}`);
    }
  }

  const licenseText = execFileSync(
    "unzip",
    ["-p", absoluteXpiPath, "LICENSE"],
    {
      encoding: "utf8",
      maxBuffer,
    },
  );
  if (!licenseText.includes("GNU AFFERO GENERAL PUBLIC LICENSE")) {
    throw new Error("The XPI does not contain the declared AGPL license text.");
  }
  const thirdPartyNotices = execFileSync(
    "unzip",
    ["-p", absoluteXpiPath, "THIRD_PARTY_NOTICES.txt"],
    { encoding: "utf8", maxBuffer },
  );
  if (!thirdPartyNotices.includes("THIRD-PARTY SOFTWARE NOTICES")) {
    throw new Error("The XPI is missing its third-party software notices.");
  }

  const manifest = JSON.parse(
    execFileSync("unzip", ["-p", absoluteXpiPath, "manifest.json"], {
      encoding: "utf8",
      maxBuffer,
    }),
  );
  if (manifest.version !== packageInfo.version) {
    throw new Error(
      `XPI version ${manifest.version} does not match package ${packageInfo.version}.`,
    );
  }
  const zoteroManifest = manifest.applications?.zotero;
  if (
    zoteroManifest?.strict_min_version !== "10.0.0" ||
    zoteroManifest?.strict_max_version !== "10.0.*"
  ) {
    throw new Error("Unexpected Zotero compatibility range in XPI manifest.");
  }

  const textEntries = entries.filter((entry) =>
    /\.(?:js|xhtml|css|json|rdf|ftl|txt|xml)$/i.test(entry),
  );
  const localPrefixes = [...new Set([os.homedir(), projectRoot])]
    .filter((prefix) => prefix && prefix !== path.parse(prefix).root)
    .map((prefix) => prefix.replaceAll(path.sep, "/"));
  for (const entry of textEntries) {
    const contents = execFileSync("unzip", ["-p", absoluteXpiPath, entry], {
      encoding: "utf8",
      maxBuffer,
    });
    for (const prefix of localPrefixes) {
      if (contents.includes(prefix)) {
        throw new Error(`Local absolute path leaked into ${entry}: ${prefix}`);
      }
    }
  }

  const warnings = [];
  if (zoteroManifest.id?.endsWith("@local.dev")) {
    warnings.push("The add-on ID is still a development placeholder.");
  }
  if (
    /github\.com\/(?:example|\{\{owner\}\})/i.test(manifest.homepage_url ?? "")
  ) {
    warnings.push("The GitHub repository URL is still a placeholder.");
  }
  if (
    /github\.com\/(?:example|\{\{owner\}\})/i.test(
      zoteroManifest.update_url ?? "",
    )
  ) {
    warnings.push(
      "Automatic updates are not configured for a real repository.",
    );
  }

  return { entries: entries.length, warnings };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const xpiPath =
    process.argv[2] ??
    path.join(projectRoot, ".scaffold/build/zotero-obsidian-bridge.xpi");
  const result = verifyPackage(xpiPath);
  process.stdout.write(
    `Package audit passed: ${result.entries} archive entries in ${path.resolve(xpiPath)}.\n`,
  );
  for (const warning of result.warnings) {
    process.stdout.write(`Release gate: ${warning}\n`);
  }
}
