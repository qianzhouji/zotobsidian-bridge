import {
  detectImageFormat,
  MAX_IMAGE_RESOURCE_BYTES,
} from "../core/image-resource.ts";
import { createMarkdownRenderer } from "../core/markdown-preview.ts";
import { readVaultImage } from "../adapters/vault-storage.ts";
import type { AnnotationCardReference } from "./annotation-card.ts";

export interface RenderedCardMarkdown {
  html: string;
  dispose(): void;
}

export function setMarkdownPreviewHTML(
  target: HTMLElement,
  html: string,
): void {
  const document = target.ownerDocument;
  if (!document) throw new Error("Markdown preview target has no document.");
  const Parser = document.defaultView?.DOMParser ?? DOMParser;
  const parsed = new Parser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  );
  const fragment = document.createDocumentFragment();
  for (let child = parsed.body.firstChild; child; child = child.nextSibling) {
    fragment.appendChild(document.importNode(child, true));
  }
  target.replaceChildren(fragment);
}

export function resolveCardImagePath(
  cardRelativePath: string,
  source: string,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(source);
  } catch {
    return null;
  }
  if (
    !decoded ||
    decoded.includes("\\") ||
    decoded.includes("?") ||
    decoded.includes("#") ||
    decoded.startsWith("/") ||
    /^[a-z][a-z\d+.-]*:/i.test(decoded)
  ) {
    return null;
  }
  const parts = decoded.split("/");
  if (
    parts.length !== 2 ||
    parts[0] !== "assets" ||
    parts.some((part) => !part || part === "." || part === "..") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|gif|webp|bmp)$/i.test(parts[1])
  ) {
    return null;
  }
  const cardParts = cardRelativePath.replace(/\\/g, "/").split("/");
  const cardName = cardParts.pop();
  if (!cardName?.toLowerCase().endsWith(".md") || cardParts.includes("..")) {
    return null;
  }
  return [...cardParts, ...parts].join("/");
}

export async function renderCardMarkdown(
  markdown: string,
  reference: Pick<AnnotationCardReference, "vaultPath" | "relativePath">,
  doc: Document,
  readImage: typeof readVaultImage = readVaultImage,
): Promise<RenderedCardMarkdown> {
  const renderer = createMarkdownRenderer();
  const tokens = renderer.parse(markdown, {});
  const objectURLs = new Set<string>();
  const view = doc.defaultView;
  const url = view?.URL ?? URL;
  const BlobConstructor = view?.Blob ?? Blob;

  for (const token of tokens) {
    if (!token.children) continue;
    for (const child of token.children) {
      if (child.type !== "image") continue;
      const source = String(child.attrGet("src") || "");
      const relativePath = resolveCardImagePath(reference.relativePath, source);
      if (!relativePath) continue;
      try {
        const bytes = await readImage(reference.vaultPath, relativePath);
        if (bytes.byteLength > MAX_IMAGE_RESOURCE_BYTES) continue;
        const format = detectImageFormat(bytes);
        const blobURL = url.createObjectURL(
          new BlobConstructor([new Uint8Array(bytes)], {
            type: format.mimeType,
          }),
        );
        objectURLs.add(blobURL);
        child.attrSet("src", blobURL);
      } catch {
        // Missing, unsafe, or unsupported local assets remain inert placeholders.
      }
    }
  }

  renderer.renderer.rules.image = (imageTokens, index) => {
    const token = imageTokens[index];
    const source = String(token.attrGet("src") || "");
    const alt = renderer.utils.escapeHtml(token.content);
    if (!objectURLs.has(source)) {
      return `<span class="image-placeholder">[Image: ${alt}]</span>`;
    }
    return `<img src="${renderer.utils.escapeHtml(source)}" alt="${alt}" loading="lazy">`;
  };

  return {
    html: renderer.renderer.render(tokens, renderer.options, {}),
    dispose() {
      for (const objectURL of objectURLs) url.revokeObjectURL(objectURL);
      objectURLs.clear();
    },
  };
}
