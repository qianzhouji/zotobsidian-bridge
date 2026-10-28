import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const lock = JSON.parse(
  await fs.readFile(path.join(projectRoot, "package-lock.json"), "utf8"),
);
const packages = Object.entries(lock.packages ?? {})
  .filter(
    ([packagePath, metadata]) =>
      packagePath.startsWith("node_modules/") && metadata.dev !== true,
  )
  .sort(([left], [right]) => left.localeCompare(right));
const sections = [
  "THIRD-PARTY SOFTWARE NOTICES",
  "",
  "The Zotero package bundles the runtime packages listed below. License files are reproduced from their respective installed package distributions.",
  "",
];

for (const [packagePath, metadata] of packages) {
  const packageDirectory = path.resolve(projectRoot, packagePath);
  if (!packageDirectory.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Package path escapes the project root: ${packagePath}`);
  }

  const packageJson = JSON.parse(
    await fs.readFile(path.join(packageDirectory, "package.json"), "utf8"),
  );
  const licenseFiles = (
    await fs.readdir(packageDirectory, {
      withFileTypes: true,
    })
  )
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(license|licence|copying|notice)([-_.].*)?$/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();

  if (licenseFiles.length === 0) {
    throw new Error(
      `No license or notice file found for ${packageJson.name}@${packageJson.version} (${metadata.license ?? "license unspecified"}).`,
    );
  }

  sections.push(
    `## ${packageJson.name}@${packageJson.version}`,
    `Declared license: ${packageJson.license ?? metadata.license ?? "unspecified"}`,
    "",
  );
  for (const licenseFile of licenseFiles) {
    sections.push(`### ${licenseFile}`, "");
    sections.push(
      await fs.readFile(path.join(packageDirectory, licenseFile), "utf8"),
      "",
    );
  }
}

await fs.writeFile(
  path.join(projectRoot, "THIRD_PARTY_NOTICES.txt"),
  `${sections
    .join("\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`,
  "utf8",
);
process.stdout.write(
  `Generated third-party notices for ${packages.length} production packages.\n`,
);
