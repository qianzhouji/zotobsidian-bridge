import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "native/macos/desktop-overlay-probe.swift");
const outputDirectory = join(root, ".scaffold/c5-native-overlay");
const output = join(outputDirectory, "desktop-overlay-probe");

if (process.platform !== "darwin") {
  throw new Error("The AppKit overlay probe can only be built on macOS.");
}

await mkdir(outputDirectory, { recursive: true });
await execFileAsync("swiftc", [
  "-parse-as-library",
  "-O",
  source,
  "-framework",
  "AppKit",
  "-o",
  output,
]);
const selfTest = await execFileAsync(output, ["--self-test"]);
if (selfTest.stdout.trim() !== "self-test passed") {
  throw new Error("The native overlay helper self-test did not pass.");
}
const hash = await execFileAsync("shasum", ["-a", "256", output]);
process.stdout.write(`Built ${output}\n${hash.stdout.trim()}\n`);
