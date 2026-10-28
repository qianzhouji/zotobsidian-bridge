import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixtureRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "zob-release-config-test-"),
);

try {
  await fs.mkdir(path.join(fixtureRoot, "scripts"), { recursive: true });
  await fs.mkdir(path.join(fixtureRoot, "obsidian-plugin"), {
    recursive: true,
  });
  await Promise.all([
    fs.copyFile(
      path.join(projectRoot, "scripts/verify-release-config.mjs"),
      path.join(fixtureRoot, "scripts/verify-release-config.mjs"),
    ),
    fs.copyFile(
      path.join(projectRoot, "LICENSE"),
      path.join(fixtureRoot, "LICENSE"),
    ),
    fs.copyFile(
      path.join(projectRoot, "obsidian-plugin/manifest.json"),
      path.join(fixtureRoot, "obsidian-plugin/manifest.json"),
    ),
    fs.copyFile(
      path.join(projectRoot, "obsidian-plugin/package.json"),
      path.join(fixtureRoot, "obsidian-plugin/package.json"),
    ),
  ]);

  const rootPackage = JSON.parse(
    await fs.readFile(path.join(projectRoot, "package.json"), "utf8"),
  );
  rootPackage.repository.url =
    "git+https://github.com/test-owner/test-project.git";
  rootPackage.homepage = "https://github.com/test-owner/test-project";
  rootPackage.config.addonID = "org.zotero.obsidianbridge";
  await fs.writeFile(
    path.join(fixtureRoot, "package.json"),
    `${JSON.stringify(rootPackage, null, 2)}\n`,
  );

  const companionPackagePath = path.join(
    fixtureRoot,
    "obsidian-plugin/package.json",
  );
  const companionPackage = JSON.parse(
    await fs.readFile(companionPackagePath, "utf8"),
  );

  const runPreflight = (environment = {}) =>
    spawnSync(
      process.execPath,
      [path.join(fixtureRoot, "scripts/verify-release-config.mjs")],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REPOSITORY: "test-owner/test-project",
          GITHUB_REF_NAME: `v${rootPackage.version}`,
          ...environment,
        },
      },
    );

  const valid = runPreflight();
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Release configuration is consistent/);

  const wrongTag = runPreflight({ GITHUB_REF_NAME: "v999.0.0" });
  assert.notEqual(wrongTag.status, 0);
  assert.ok(wrongTag.stderr.includes(`must match v${rootPackage.version}`));

  const wrongRepository = runPreflight({
    GITHUB_REPOSITORY: "another-owner/another-project",
  });
  assert.notEqual(wrongRepository.status, 0);
  assert.match(wrongRepository.stderr, /repository must match/);

  rootPackage.config.addonID = "zotero-obsidian-bridge@local.dev";
  await fs.writeFile(
    path.join(fixtureRoot, "package.json"),
    `${JSON.stringify(rootPackage, null, 2)}\n`,
  );
  const placeholderId = runPreflight();
  assert.notEqual(placeholderId.status, 0);
  assert.match(placeholderId.stderr, /development placeholder/);

  rootPackage.config.addonID = "org.zotero.obsidianbridge";
  const manifestPath = path.join(fixtureRoot, "obsidian-plugin/manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.id = "zotobsidian-bridge";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(
    path.join(fixtureRoot, "package.json"),
    `${JSON.stringify(rootPackage, null, 2)}\n`,
  );
  const invalidObsidianId = runPreflight();
  assert.notEqual(invalidObsidianId.status, 0);
  assert.match(invalidObsidianId.stderr, /violates Obsidian ID rules/);

  manifest.id = "zotero-card-bridge";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await fs.writeFile(
    path.join(fixtureRoot, "package.json"),
    `${JSON.stringify(rootPackage, null, 2)}\n`,
  );
  companionPackage.license = "MIT";
  await fs.writeFile(
    companionPackagePath,
    `${JSON.stringify(companionPackage, null, 2)}\n`,
  );
  const wrongLicense = runPreflight();
  assert.notEqual(wrongLicense.status, 0);
  assert.match(wrongLicense.stderr, /package licenses must match/);

  process.stdout.write(
    "Release preflight tests passed: valid config, tag/repository mismatch, placeholder and invalid Obsidian IDs, and license mismatch.\n",
  );
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
