import type { NoteQueryClient } from "../adapters/note-query-client.ts";
import {
  createKnowledgeRenderer,
  knowledgeNoteSource,
} from "../core/knowledge-note.ts";
import { internalLinkTarget } from "../core/note-links.ts";
import { detectImageFormat } from "../core/image-resource.ts";
import type { RenderedCardMarkdown } from "./card-markdown-preview.ts";
import type { NoteQueryResultMap } from "../core/note-query-protocol.ts";

/** Only resource responses can mint image URLs; no raw Markdown URL reaches src. */
export async function renderKnowledgeMarkdown(
  markdown: string,
  path: string,
  doc: Document,
  client: NoteQueryClient,
  signal: AbortSignal,
  cache = new Map<string, NoteQueryResultMap["read-note-resource"]>(),
  offline = false,
): Promise<RenderedCardMarkdown> {
  const renderer = createKnowledgeRenderer();
  const tokens = renderer.parse(knowledgeNoteSource(markdown), {});
  const urls = new Set<string>();
  const imageResources = new Map<string, Blob>();
  const view = doc.defaultView!;
  const dispose = () => {
    for (const url of urls) view.URL.revokeObjectURL(url);
    urls.clear();
  };
  const check = () => {
    if (signal.aborted) throw new Error("cancelled");
  };
  let bytesUsed = 0;
  let resources = 0;
  try {
    for (const token of tokens) {
      check();
      for (const child of token.children ?? []) {
        const wikiImage =
          child.type === "zob_wikilink" &&
          child.attrGet("data-zob-embed") === "true" &&
          /\.(?:png|jpe?g|gif|webp)$/i.test(
            String(child.attrGet("data-zob-note-link") ?? ""),
          );
        if (child.type !== "image" && !wikiImage) continue;
        const raw = String(
          wikiImage
            ? child.attrGet("data-zob-note-link")!
            : (child.attrGet("src") ?? ""),
        );
        const target = internalLinkTarget(raw, !wikiImage);
        if (wikiImage) {
          child.type = "knowledge_embed";
          child.content = String(child.content || raw.split("/").at(-1));
          child.attrSet("src", raw);
        }
        if (
          !target ||
          target.startsWith("#") ||
          !/\.(?:png|jpe?g|gif|webp)$/i.test(target) ||
          ++resources > 16
        )
          continue;
        try {
          const key = `${path}\0${target}`;
          const response = offline
            ? undefined
            : await client.query(
                "read-note-resource",
                { linkpath: target, sourcePath: path },
                { signal, channel: "knowledge-resource" },
              );
          check();
          const result = offline
            ? cache.get(key)
            : response?.status === "ok"
              ? response.result
              : undefined;
          if (!result) continue;
          bytesUsed += result.byteLength;
          if (bytesUsed > 10 * 1024 * 1024) continue;
          const data = Uint8Array.from(view.atob(result.base64), (char) =>
            char.charCodeAt(0),
          );
          if (detectImageFormat(data).mimeType !== result.mimeType) continue;
          cache.delete(key);
          cache.set(key, result);
          let size = [...cache.values()].reduce(
            (sum, value) => sum + value.base64.length * 2,
            0,
          );
          while (size > 16 * 1024 * 1024) {
            const oldest = cache.keys().next().value!;
            size -= cache.get(oldest)!.base64.length * 2;
            cache.delete(oldest);
          }
          const blob = new view.Blob([data], { type: result.mimeType });
          const url = view.URL.createObjectURL(blob);
          urls.add(url);
          imageResources.set(url, blob);
          child.attrSet("src", url);
        } catch {
          check();
        }
      }
      // Yield between blocks so closing a long note can cancel resource/render work.
      if (token.type === "paragraph_close")
        await new Promise<void>((resolve) => view.setTimeout(resolve, 0));
    }
    check();
    const renderImage = (children: typeof tokens, index: number) => {
      const child = children[index];
      const src = String(child.attrGet("src") ?? "");
      const alt = renderer.utils.escapeHtml(child.content);
      return urls.has(src)
        ? `<img src="${renderer.utils.escapeHtml(src)}" alt="${alt}" loading="lazy">`
        : `<span class="image-placeholder">[Image unavailable: ${alt}]</span>`;
    };
    renderer.renderer.rules.image = renderImage;
    renderer.renderer.rules.knowledge_embed = renderImage;
    return {
      html: renderer.renderer.render(tokens, renderer.options, {}),
      imageResources,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
