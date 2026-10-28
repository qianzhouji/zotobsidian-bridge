import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

const repository = /^[^/]+\/[^/]+$/.test(process.env.GITHUB_REPOSITORY ?? "")
  ? process.env.GITHUB_REPOSITORY!
  : "qianzhouji/zotobsidian-bridge";
const [repositoryOwner, repositoryName] = repository.split("/");
const updateChannel = pkg.version.includes("-")
  ? "update-beta.json"
  : "update.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  xpiName: "zotero-obsidian-bridge",
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/${repositoryOwner}/${repositoryName}/releases/download/release/${updateChannel}`,
  xpiDownloadLink: `https://github.com/${repositoryOwner}/${repositoryName}/releases/download/v{{version}}/zotero-obsidian-bridge.xpi`,

  build: {
    assets: ["addon/**/*.*", "LICENSE", "THIRD_PARTY_NOTICES.txt"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
      {
        entryPoints: ["src/editor.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}-editor.js`,
      },
      {
        entryPoints: ["src/batch-progress.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}-batch-progress.js`,
      },
      {
        entryPoints: ["src/pending-companion.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}-pending-companion.js`,
      },
    ],
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },

  server: {
    prefs: {
      "extensions.zotero.zoteroobsidianbridge.vaultPath":
        process.env.BRIDGE_TEST_VAULT_PATH ?? "",
    },
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
