import katex from "katex";
import MarkdownIt from "markdown-it";
import type { MarkdownIt as MarkdownItType } from "markdown-it";

export function createMarkdownRenderer(): MarkdownItType {
  const renderer = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
    breaks: false,
  });
  const validateLink = renderer.validateLink.bind(renderer);
  renderer.validateLink = (url) =>
    /^(?:zotero|obsidian):\/\//i.test(url) || validateLink(url);

  renderer.inline.ruler.before("escape", "math_inline", (state, silent) => {
    const start = state.pos;
    if (
      state.src.charCodeAt(start) !== 36 ||
      state.src.charCodeAt(start + 1) === 36 ||
      (start > 0 && state.src.charCodeAt(start - 1) === 92)
    ) {
      return false;
    }
    const end = state.src.indexOf("$", start + 1);
    if (end < 0 || end === start + 1) return false;
    const content = state.src.slice(start + 1, end);
    if (/^\s|\s$/.test(content)) return false;
    if (!silent) {
      const token = state.push("math_inline", "", 0);
      token.content = content;
    }
    state.pos = end + 1;
    return true;
  });

  renderer.block.ruler.before(
    "fence",
    "math_block",
    (state, startLine, endLine, silent) => {
      const firstLine = state
        .getLines(startLine, startLine + 1, state.blkIndent, false)
        .trim();
      if (!firstLine.startsWith("$$")) return false;

      let content = "";
      let nextLine = startLine + 1;
      const inlineClose = /^\$\$(.*)\$\$$/.exec(firstLine);
      if (inlineClose) {
        content = inlineClose[1].trim();
      } else {
        const initial = firstLine.slice(2).trim();
        if (initial) content = initial;
        let closed = false;
        while (nextLine < endLine) {
          const line = state.getLines(nextLine, nextLine + 1, 0, false).trim();
          if (line === "$$") {
            closed = true;
            nextLine++;
            break;
          }
          content = content ? `${content}\n${line}` : line;
          nextLine++;
        }
        if (!closed) return false;
      }
      if (silent) return true;

      const token = state.push("math_block", "", 0);
      token.block = true;
      token.content = content;
      token.map = [startLine, nextLine];
      state.line = nextLine;
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );

  const renderMath = (content: string, displayMode: boolean): string =>
    katex.renderToString(content, {
      displayMode,
      throwOnError: false,
      trust: false,
      maxExpand: 1000,
      maxSize: 20,
      strict: "warn",
    });
  renderer.renderer.rules.math_inline = (tokens, index) =>
    renderMath(tokens[index].content, false);
  renderer.renderer.rules.math_block = (tokens, index) =>
    `<div class="math-block">${renderMath(tokens[index].content, true)}</div>\n`;
  renderer.renderer.rules.image = (tokens, index) =>
    `<span class="image-placeholder">[Image: ${renderer.utils.escapeHtml(tokens[index].content)}]</span>`;
  return renderer;
}

export function renderMarkdown(markdownText: string): string {
  return createMarkdownRenderer().render(markdownText);
}
