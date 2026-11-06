import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { lstatSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { DOMParser, parseHTML } from "linkedom";
import { MAX_IMAGE_RESOURCE_BYTES } from "../src/core/image-resource.ts";
import { readVaultImage } from "../src/adapters/vault-storage.ts";
import {
  renderCardMarkdown,
  resolveCardImagePath,
  setMarkdownPreviewHTML,
} from "../src/services/card-markdown-preview.ts";

const cardPath = "Zotero Literature/Paper/Annotations/P01N01.md";
const editorMarkup = await readFile(
  new URL("../addon/content/editor.xhtml", import.meta.url),
  "utf8",
);
const editorDocument = new DOMParser().parseFromString(
  editorMarkup,
  "application/xml",
);
assert.equal(
  editorDocument.documentElement.localName,
  "html",
  "CodeMirror must run in an XHTML document, not a XUL window with broken selection",
);
assert.equal(
  editorDocument.documentElement.getAttribute("xmlns"),
  "http://www.w3.org/1999/xhtml",
);
assert.equal(
  resolveCardImagePath(cardPath, "assets/ANN001-deadbeef.png"),
  "Zotero Literature/Paper/Annotations/assets/ANN001-deadbeef.png",
);
for (const source of [
  "https://example.com/private.png",
  "javascript:alert(1)",
  "data:image/png;base64,AAAA",
  "/etc/passwd",
  "assets/../../private.png",
  "assets/%2e%2e/private.png",
  "assets%2f..%2fprivate.png",
  "assets\\..\\private.png",
  "assets/file.svg",
]) {
  assert.equal(resolveCardImagePath(cardPath, source), null, source);
}
assert.equal(resolveCardImagePath("../outside.md", "assets/a.png"), null);

const objectURLs = [];
let blobRealmUsed = false;
class PreviewBlob {
  constructor(parts, options) {
    this.parts = parts;
    this.type = options.type;
    blobRealmUsed = true;
  }
}
const previewURL = {
  createObjectURL(blob) {
    assert.ok(blob instanceof PreviewBlob);
    objectURLs.push(`blob:reader-preview-${objectURLs.length + 1}`);
    return objectURLs.at(-1);
  },
  revokeObjectURL(value) {
    revoked.push(value);
  },
};
const revoked = [];
const { document } = parseHTML("<html><head></head><body></body></html>");
Object.defineProperty(document, "defaultView", {
  configurable: true,
  value: { URL: previewURL, Blob: PreviewBlob, DOMParser },
});
const requested = [];
const previewSource = [
  "# 中文标题",
  "",
  "<script>globalThis.compromised = true</script>",
  "",
  "[unsafe](javascript:alert(1))",
  "",
  "![local](assets/ANN001-deadbeef.png)",
  "![remote](https://example.com/private.png)",
  "![traversal](assets/%2e%2e/private.png)",
  "",
  "[safe link](https://example.org) and inline math $\\alpha + \\beta$:",
  "",
  "$$",
  "E = mc^2",
  "$$",
  "",
  "中文说明。".repeat(120),
  "",
  "List:",
  "- one",
  "- two",
  "",
  "```js",
  "alert(1)",
  "```",
].join("\n");
const rendered = await renderCardMarkdown(
  previewSource,
  { vaultPath: "/isolated/vault", relativePath: cardPath },
  document,
  async (_root, relativePath) => {
    requested.push(relativePath);
    return new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
  },
);
assert.deepEqual(requested, [
  "Zotero Literature/Paper/Annotations/assets/ANN001-deadbeef.png",
]);
assert.equal(blobRealmUsed, true);
assert.match(rendered.html, /<h1>中文标题<\/h1>/);
assert.match(rendered.html, /blob:reader-preview-1/);
assert.match(rendered.html, /\[Image: remote\]/);
assert.match(rendered.html, /\[Image: traversal\]/);
assert.doesNotMatch(rendered.html, /<script/i);
assert.doesNotMatch(rendered.html, /href="javascript:/i);
assert.doesNotMatch(rendered.html, /https:\/\/example\.com\/private\.png/);
assert.match(rendered.html, /katex/);
assert.match(rendered.html, /katex-display/);
assert.match(rendered.html, /href="https:\/\/example\.org"/);
assert.match(rendered.html, /<ul>/);
assert.match(rendered.html, /<pre>/);
assert.equal(
  previewSource.includes("![local](assets/ANN001-deadbeef.png)"),
  true,
);
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const previewTarget = document.createElementNS(XHTML_NAMESPACE, "html:div");
const parseFromString = DOMParser.prototype.parseFromString;
let parserMimeType = "";
DOMParser.prototype.parseFromString = function (markup, mimeType) {
  parserMimeType = mimeType;
  assert.match(markup, /^<html><body>/);
  return parseFromString.call(this, markup, mimeType);
};
setMarkdownPreviewHTML(previewTarget, rendered.html);
DOMParser.prototype.parseFromString = parseFromString;
assert.equal(parserMimeType, "text/html");
assert.equal(previewTarget.querySelector("h1")?.textContent, "中文标题");
assert.equal(previewTarget.querySelector("ul li")?.textContent, "one");
assert.equal(
  previewTarget.querySelector("pre code")?.textContent.trimEnd(),
  "alert(1)",
);
assert.equal(
  previewTarget.querySelector("img")?.getAttribute("src"),
  "blob:reader-preview-1",
);
assert.ok(previewTarget.querySelector(".katex"));
assert.equal(previewTarget.querySelector("script"), null);
rendered.dispose();
assert.deepEqual(revoked, ["blob:reader-preview-1"]);

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "zob-b3-images-"));
const vaultRoot = path.join(tempRoot, "vault");
await mkdir(path.join(vaultRoot, "Paper", "Annotations", "assets"), {
  recursive: true,
});
await writeFile(
  path.join(vaultRoot, "Paper", "Annotations", "assets", "safe.png"),
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
);
await writeFile(path.join(tempRoot, "outside.png"), Buffer.from("outside"));
await symlink(
  path.join(tempRoot, "outside.png"),
  path.join(vaultRoot, "Paper", "Annotations", "assets", "linked.png"),
);
await writeFile(
  path.join(vaultRoot, "Paper", "Annotations", "assets", "large.png"),
  Buffer.from("large"),
);

globalThis.PathUtils = {
  normalize: (value) => path.normalize(value),
  isAbsolute: (value) => path.isAbsolute(value),
  join: (...parts) => path.join(...parts),
};
globalThis.Zotero = {
  File: {
    pathToFile(filePath) {
      return { isSymlink: () => lstatSync(filePath).isSymbolicLink() };
    },
  },
};
globalThis.IOUtils = {
  async exists(filePath) {
    try {
      await statSync(filePath);
      return true;
    } catch {
      return false;
    }
  },
  async stat(filePath) {
    const info = statSync(filePath);
    return {
      size:
        path.basename(filePath) === "large.png"
          ? MAX_IMAGE_RESOURCE_BYTES + 1
          : info.size,
    };
  },
  async read(filePath, options) {
    const bytes = await readFile(filePath);
    if (bytes.byteLength > options.maxBytes) {
      throw new Error("maxBytes exceeded");
    }
    return new Uint8Array(bytes);
  },
};
const safeBytes = await readVaultImage(
  vaultRoot,
  "Paper/Annotations/assets/safe.png",
);
assert.equal(safeBytes.byteLength, 8);
await assert.rejects(
  readVaultImage(vaultRoot, "../outside.png"),
  /normalized relative paths/,
);
await assert.rejects(
  readVaultImage(vaultRoot, "Paper/Annotations/assets/linked.png"),
  /symbolic link/,
);
await assert.rejects(
  readVaultImage(vaultRoot, "Paper/Annotations/assets/large.png"),
  /preview limit/,
);
await rm(tempRoot, { recursive: true, force: true });

process.stdout.write(
  "Card Markdown preview checks passed: safe relative assets, inert remote/traversal images, escaped HTML, rejected script links, math, lists, code, object URL cleanup, Vault containment, symlink rejection, and image size limits.\n",
);
