import MarkdownIt from "markdown-it";
import type { CachedMetadata, Loc, Pos } from "obsidian";
import { maskNoteComments } from "../../src/core/note-links.ts";

const parser = new MarkdownIt({ html: false });

/** Verify only navigation metadata, without assuming the host cache has a content hash. */
export function verifyColdNavigationCache(
  markdown: string,
  cache: CachedMetadata | null,
): CachedMetadata | null {
  if (!cache) return null;
  const masked = maskNoteComments(markdown).replace(
    /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/,
    (frontmatter) => frontmatter.replace(/[^\r\n]/g, " "),
  );
  const lines = markdown.split("\n");
  const starts = [0];
  for (let i = 0; i < markdown.length; i++)
    if (markdown[i] === "\n") starts.push(i + 1);
  const validPoint = (point: Loc) =>
    Number.isInteger(point.line) &&
    Number.isInteger(point.col) &&
    point.line >= 0 &&
    point.line < starts.length &&
    point.col >= 0 &&
    point.col <= lines[point.line].length &&
    starts[point.line] + point.col === point.offset;
  const validPosition = (position: Pos) =>
    validPoint(position.start) &&
    validPoint(position.end) &&
    position.start.offset <= position.end.offset;
  const tokens = parser.parse(masked, {});
  const headings = cache.headings ?? [];
  const blocks = cache.blocks ?? {};
  const foundBlocks = new Set<string>();
  let headingIndex = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const content = tokens[i + 1];
    if (token.type === "heading_open" && content?.type === "inline") {
      const current = headings[headingIndex++];
      const plain = (content.children ?? [])
        .filter((child) => ["text", "code_inline"].includes(child.type))
        .map((child) => child.content)
        .join("");
      if (
        !current ||
        !token.map ||
        !validPosition(current.position) ||
        current.level !== Number(token.tag.slice(1)) ||
        ![content.content, plain].includes(current.heading) ||
        current.position.start.line !== token.map[0] ||
        current.position.start.col !== 0 ||
        current.position.end.line !== token.map[1] - 1
      )
        return null;
    }
    if (token.type !== "inline" || !token.map) continue;
    const last = token.children?.at(-1);
    if (last?.type !== "text") continue;
    const match = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(last.content);
    if (!match) continue;
    const id = match[1];
    const current = blocks[id];
    // Complex/standalone blocks without a provable range wait for a native changed event.
    if (foundBlocks.has(id) || !current || !validPosition(current.position))
      return null;
    const range = masked.slice(
      current.position.start.offset,
      current.position.end.offset,
    );
    if (
      !range.trimEnd().endsWith(`^${id}`) ||
      current.position.start.line !== token.map[0] ||
      current.position.start.col !== 0 ||
      current.position.end.line !== token.map[1] - 1
    )
      return null;
    foundBlocks.add(id);
  }
  if (
    headingIndex !== headings.length ||
    foundBlocks.size !== Object.keys(blocks).length
  )
    return null;
  return structuredClone({ headings, blocks });
}
