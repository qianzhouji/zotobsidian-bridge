import MarkdownIt from "markdown-it";
import type { MarkdownIt as MarkdownItType } from "markdown-it";

export interface NoteLink {
  target: string;
  label: string;
  embed: boolean;
  syntax: "wiki" | "markdown";
  from: number;
  to: number;
}
interface LinkEnvironment {
  [key: string]: unknown;
  [key: symbol]: unknown;
  zobLinks?: NoteLink[];
  zobOffsets?: number[];
  zobSource?: string;
  zobOriginalOffsets?: number[];
}

export function internalLinkTarget(raw: string, decode = false): string | null {
  let target = raw;
  if (decode) {
    try {
      target = decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  if (
    !target ||
    target.length > 1024 ||
    /^(?:[A-Za-z][A-Za-z0-9+.-]*:|[/\\])/.test(target) ||
    target.includes("\\") ||
    [...target].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    /%[0-9a-f]{2}/i.test(target)
  )
    return null;
  return target;
}

// Preserve offsets while hiding Obsidian/HTML comments; code spans/fences remain literal.
export function maskNoteComments(source: string): string {
  const chars = source.split("");
  let i = 0;
  let fence = "";
  while (i < source.length) {
    if (i === 0 || source[i - 1] === "\n") {
      const lineEnd = source.indexOf("\n", i);
      const end = lineEnd < 0 ? source.length : lineEnd;
      const line = source.slice(i, end);
      const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (
        match &&
        (!fence ||
          (match[1][0] === fence[0] && match[1].length >= fence.length))
      ) {
        fence = fence ? "" : match[1];
        i = end + 1;
        continue;
      }
      if (fence || /^(?: {4}|\t)/.test(line)) {
        i = end + 1;
        continue;
      }
    }
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === "`") {
      let end = i + 1;
      while (source[end] === "`") end++;
      const close = source.indexOf(source.slice(i, end), end);
      i = close < 0 ? end : close + end - i;
      continue;
    }
    const opener = source.startsWith("%%", i)
      ? "%%"
      : source.startsWith("<!--", i)
        ? "<!--"
        : "";
    if (opener) {
      const closer = opener === "%%" ? "%%" : "-->";
      const close = source.indexOf(closer, i + opener.length);
      const end = close < 0 ? source.length : close + closer.length;
      for (; i < end; i++)
        if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
    } else i++;
  }
  return chars.join("");
}

export function installNoteLinks(md: MarkdownItType): void {
  md.core.ruler.before("normalize", "zob_comment_mask", (state) => {
    const env = state.env as LinkEnvironment;
    env.zobSource = state.src;
    env.zobOriginalOffsets = [];
    for (let i = 0; i < state.src.length; i++) {
      env.zobOriginalOffsets.push(i);
      if (state.src[i] === "\r" && state.src[i + 1] === "\n") i++;
    }
    env.zobLinks ??= [];
    state.src = maskNoteComments(state.src);
  });
  // Carry source coordinates through the Markdown block parser, including list/quote prefixes.
  md.core.ruler.at("inline", (state) => {
    const env = state.env as LinkEnvironment;
    const lines = state.src.split("\n");
    const starts: number[] = [];
    let offset = 0;
    for (const line of lines) {
      starts.push(offset);
      offset += line.length + 1;
    }
    for (const token of state.tokens) {
      if (token.type !== "inline") continue;
      const offsets: number[] = [];
      let lineIndex = token.map?.[0] ?? 0;
      for (const text of token.content.split("\n")) {
        let at = -1;
        while (lineIndex < (token.map?.[1] ?? lines.length)) {
          at = lines[lineIndex]?.indexOf(text) ?? -1;
          if (at >= 0) break;
          lineIndex++;
        }
        for (let j = 0; j <= text.length; j++)
          offsets.push(at < 0 ? -1 : starts[lineIndex] + at + j);
        lineIndex++;
      }
      env.zobOffsets = offsets;
      token.children = [];
      state.md.inline.parse(token.content, state.md, state.env, token.children);
    }
    delete env.zobOffsets;
  });
  const record = (
    env: LinkEnvironment,
    start: number,
    end: number,
    link: Omit<NoteLink, "from" | "to">,
  ) => {
    const from = env.zobOffsets?.[start];
    const last = env.zobOffsets?.[end - 1];
    if (from !== undefined && last !== undefined && from >= 0 && last >= from)
      env.zobLinks?.push({
        ...link,
        from: env.zobOriginalOffsets?.[from] ?? from,
        to: (env.zobOriginalOffsets?.[last] ?? last) + 1,
      });
  };
  md.inline.ruler.before("link", "zob_wikilink", (state, silent) => {
    const start = state.pos;
    const embed = state.src.startsWith("![[", start);
    const open = start + (embed ? 1 : 0);
    if (state.linkLevel > 0 || !state.src.startsWith("[[", open)) return false;
    const close = state.src.indexOf("]]", open + 2);
    if (close < 0) return false;
    const raw = state.src.slice(open + 2, close);
    if (/[\n\r[\]]/.test(raw)) return false;
    const split = raw.indexOf("|");
    const target = internalLinkTarget(
      (split < 0 ? raw : raw.slice(0, split)).trim(),
    );
    if (!target) return false;
    const label = split < 0 ? target : raw.slice(split + 1);
    if (!silent) {
      const token = state.push("zob_wikilink", "a", 0);
      token.content = label;
      token.attrSet("data-zob-note-link", target);
      token.attrSet("data-zob-embed", String(embed));
      record(state.env as LinkEnvironment, start, close + 2, {
        target,
        label,
        embed,
        syntax: "wiki",
      });
    }
    state.pos = close + 2;
    return true;
  });
  // This rule records standard inline-link source spans; markdown-it still parses/renders them.
  md.inline.ruler.before("link", "zob_markdown_range", (state, silent) => {
    const start = state.pos;
    if (silent || state.linkLevel > 0 || state.src[start] !== "[") return false;
    const labelEnd = md.helpers.parseLinkLabel(state, start, true);
    if (labelEnd < 0 || state.src[labelEnd + 1] !== "(") return false;
    let pos = labelEnd + 2;
    while (/\s/.test(state.src[pos] ?? "") && pos < state.posMax) pos++;
    const dest = md.helpers.parseLinkDestination(state.src, pos, state.posMax);
    if (!dest.ok) return false;
    pos = dest.pos;
    while (pos < state.posMax && /\s/.test(state.src[pos])) pos++;
    if (state.src[pos] !== ")") {
      const title = md.helpers.parseLinkTitle(state.src, pos, state.posMax);
      if (!title.ok) return false;
      pos = title.pos;
      while (pos < state.posMax && /\s/.test(state.src[pos])) pos++;
    }
    if (state.src[pos] !== ")") return false;
    const target = internalLinkTarget(dest.str, true);
    if (target)
      record(state.env as LinkEnvironment, start, pos + 1, {
        target,
        label: state.src.slice(start + 1, labelEnd),
        embed: false,
        syntax: "markdown",
      });
    return false;
  });
  md.renderer.rules.zob_wikilink = (tokens, index) => {
    const token = tokens[index];
    const target = md.utils.escapeHtml(
      String(token.attrGet("data-zob-note-link") ?? ""),
    );
    const label = md.utils.escapeHtml(token.content);
    const embed = token.attrGet("data-zob-embed") === "true";
    return `<a href="#" class="internal-link" data-zob-note-link="${target}"${embed ? ' data-zob-embed="true"' : ""}>${embed ? `[${label}]` : label}</a>`;
  };
  const previous = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const target = internalLinkTarget(
      String(tokens[index].attrGet("href") ?? ""),
      true,
    );
    if (target) {
      tokens[index].attrSet("data-zob-note-link", target);
      tokens[index].attrSet("href", "#");
      tokens[index].attrJoin("class", "internal-link");
    }
    return previous
      ? previous(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
  };
}

export function collectNoteLinks(source: string): NoteLink[] {
  const parser = new MarkdownIt({ html: false, linkify: false });
  installNoteLinks(parser);
  const env: LinkEnvironment = { zobLinks: [] };
  parser.parse(source, env);
  return env.zobLinks ?? [];
}
export function noteLinkAtOffset(
  source: string,
  offset: number,
): NoteLink | null {
  return (
    collectNoteLinks(source).find(
      (link) => offset >= link.from && offset < link.to,
    ) ?? null
  );
}

/** Root-note navigation uses the current unsaved buffer, never forces a save. */
export function localNoteAnchor(
  source: string,
  fragment: string,
): { state: "found" | "missing" | "ambiguous"; offset?: number } {
  const parser = new MarkdownIt({ html: false });
  const tokens = parser.parse(maskNoteComments(source), {});
  const starts = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === "\n") starts.push(i + 1);
  const matches: number[] = [];
  const ancestry: { title: string; level: number }[] = [];
  const parts = fragment.split("#");
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const content = tokens[i + 1];
    if (token.type === "heading_open" && content?.type === "inline") {
      const title = (content.children ?? [])
        .filter((child) => ["text", "code_inline"].includes(child.type))
        .map((child) => child.content)
        .join("");
      const level = Number(token.tag.slice(1));
      while (ancestry.length && ancestry[ancestry.length - 1].level >= level)
        ancestry.pop();
      ancestry.push({ title, level });
      if (
        !fragment.startsWith("^") &&
        parts.length <= ancestry.length &&
        parts.every(
          (part, index) =>
            part === ancestry[ancestry.length - parts.length + index].title,
        )
      )
        matches.push(starts[token.map?.[0] ?? 0]);
    }
    if (
      fragment.startsWith("^") &&
      token.type === "paragraph_open" &&
      content?.type === "inline" &&
      content.content.trimEnd().endsWith(` ${fragment}`)
    )
      matches.push(starts[token.map?.[0] ?? 0]);
  }
  return matches.length === 1
    ? { state: "found", offset: matches[0] }
    : { state: matches.length ? "ambiguous" : "missing" };
}
