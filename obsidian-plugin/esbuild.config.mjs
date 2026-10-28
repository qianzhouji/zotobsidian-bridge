import { builtinModules } from "node:module";
import { mkdir, copyFile } from "node:fs/promises";
import esbuild from "esbuild";

const output = "../.scaffold/obsidian-plugin";
await mkdir(output, { recursive: true });
await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtinModules],
  format: "cjs",
  target: "es2021",
  platform: "node",
  outfile: `${output}/main.js`,
});
await copyFile("manifest.json", `${output}/manifest.json`);
