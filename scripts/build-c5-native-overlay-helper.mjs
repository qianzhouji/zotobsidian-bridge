import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "native/macos/desktop-overlay-helper.swift");
const stage = join(root, ".scaffold/c5-native-helper-stage");
const binary = join(stage, "desktop-overlay-helper");
const manifest = join(stage, "manifest.json");
const packagedDirectory = "content/native/macos";

export async function stageNativeOverlayHelper() {
  if (process.platform !== "darwin") return false;
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const perArchitecture = [];
  for (const architecture of ["arm64", "x86_64"]) {
    const output = join(stage, `desktop-overlay-helper-${architecture}`);
    await execFileAsync("swiftc", [
      "-parse-as-library",
      "-O",
      "-target",
      `${architecture}-apple-macosx10.15`,
      source,
      "-framework",
      "AppKit",
      "-o",
      output,
    ]);
    perArchitecture.push(output);
  }
  await execFileAsync("lipo", [
    "-create",
    ...perArchitecture,
    "-output",
    binary,
  ]);
  await chmod(binary, 0o755);
  const selfTest = await execFileAsync(binary, ["--self-test"]);
  if (selfTest.stdout.trim() !== "self-test passed")
    throw new Error("The native overlay helper self-test failed.");
  const bytes = await readFile(binary);
  await writeFile(
    manifest,
    JSON.stringify(
      {
        protocolVersion: 1,
        binary: "desktop-overlay-helper",
        architectures: ["arm64", "x86_64"],
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(
    `Staged universal AppKit overlay helper (${bytes.byteLength} bytes).\n`,
  );
  return true;
}

export async function copyNativeOverlayHelperToPackage(dist) {
  if (process.platform !== "darwin") return false;
  const directory = join(dist, "addon", packagedDirectory);
  await mkdir(directory, { recursive: true });
  await copyFile(binary, join(directory, "desktop-overlay-helper"));
  await chmod(join(directory, "desktop-overlay-helper"), 0o755);
  await copyFile(manifest, join(directory, "manifest.json"));
  return true;
}

export async function cleanNativeOverlayHelperStage() {
  await rm(stage, { recursive: true, force: true });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await stageNativeOverlayHelper();
}
