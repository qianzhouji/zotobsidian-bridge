import { parseMarkdownFrontmatter, maskBridgeMetadata } from "./markdown.ts";
import { createMarkdownRenderer } from "./markdown-preview.ts";

/** Display the entire saved note, never the annotation-card My notes slice. */
export function knowledgeNoteBody(markdown: string): string {
  if (!/^\uFEFF?---\r?\n/.test(markdown)) return markdown;
  try {
    return parseMarkdownFrontmatter(markdown).body.replace(/^\r?\n/, "");
  } catch {
    // Invalid frontmatter remains visible; no potentially meaningful text is lost.
    return markdown;
  }
}

export function knowledgeNoteTitle(markdown: string, path: string): string {
  try {
    const fields = parseMarkdownFrontmatter(markdown).document.toJS();
    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
      const title = (fields as Record<string, unknown>).title;
      if (typeof title === "string" && title.trim()) return title.trim();
    }
  } catch {
    // Notes without valid frontmatter can still provide a heading title.
  }

  const tokens = createKnowledgeRenderer().parse(
    knowledgeNoteSource(markdown),
    {},
  );
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "heading_open" || tokens[i].tag !== "h1") continue;
    const inline = tokens[i + 1];
    if (inline?.type !== "inline") continue;
    const text = (inline.children ?? [])
      .map((token) => {
        if (
          token.type === "text" ||
          token.type === "code_inline" ||
          token.type === "math_inline" ||
          token.type === "image"
        )
          return token.content;
        return token.type === "softbreak" || token.type === "hardbreak"
          ? " "
          : "";
      })
      .join("")
      .trim();
    if (text) return text;
  }

  return path.split("/").at(-1)!.replace(/\.md$/i, "");
}

/** Safe baseline: HTML is escaped and every image remains an inert placeholder. */
export function renderKnowledgeNote(markdown: string): string {
  return createKnowledgeRenderer().render(knowledgeNoteSource(markdown));
}

export function knowledgeNoteSource(markdown: string): string {
  const body = knowledgeNoteBody(markdown);
  const start = markdown.length - body.length;
  return (
    markdown.slice(0, start).replace(/[^\r\n]/g, " ") + maskBridgeMetadata(body)
  );
}

export function createKnowledgeRenderer() {
  const renderer = createMarkdownRenderer();
  renderer.core.ruler.after("inline", "knowledge_positions_tasks", (state) => {
    let listDepth = 0;
    for (const token of state.tokens) {
      if (token.type === "list_item_open") listDepth++;
      if (token.type === "list_item_close") listDepth--;
      if (token.map && token.nesting >= 0)
        token.attrSet("data-note-line", String(token.map[0]));
      if (
        listDepth &&
        token.type === "inline" &&
        token.children?.[0]?.type === "text"
      ) {
        const first = token.children[0];
        const task = /^\[([ xX])\]\s/.exec(first.content);
        if (task) {
          first.content = first.content.slice(task[0].length);
          const checkbox = new state.Token("knowledge_task", "input", 0);
          checkbox.content = task[1] !== " " ? "checked" : "";
          token.children.unshift(checkbox);
        }
      }
    }
  });
  renderer.renderer.rules.knowledge_task = (tokens, i) =>
    `<input type="checkbox" disabled="disabled" aria-readonly="true"${tokens[i].content ? ' checked="checked"' : ""}> `;
  return renderer;
}
