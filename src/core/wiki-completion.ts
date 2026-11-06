import { collectNoteLinks } from "./note-links.ts";

export interface WikiCompletionContext {
  from: number;
  to: number;
  query: string;
  target: string;
  fragment: string | null;
  mode: "note" | "heading" | "block";
  closed: boolean;
  alias?: string;
}

/** Identify only a live wikilink at the caret; never replace an alias. */
export function wikiCompletionContext(
  text: string,
  caret: number,
): WikiCompletionContext | null {
  if (caret < 0 || caret > text.length) return null;
  const start = text.lastIndexOf("[[", caret - 1);
  if (start < 0 || caret < start + 2) return null;
  const before = text.slice(start + 2, caret);
  if (/[\n\r|[\]]/.test(before)) return null;
  const close = text.indexOf("]]", caret);
  const lineEnd = text.slice(caret).search(/[\n\r]/);
  const closed = close >= 0 && (lineEnd < 0 || close < caret + lineEnd);
  const remainder = closed ? text.slice(caret, close) : "";
  if (/[[\]]/.test(remainder)) return null;
  const candidate = before + remainder;
  // Parse a temporary valid link so fenced/inline code and comments are excluded.
  const virtual = `${text.slice(0, start)}[[${candidate || "zob-placeholder"}]]${text.slice(closed ? close + 2 : caret)}`;
  if (
    !collectNoteLinks(virtual).some(
      (link) => link.syntax === "wiki" && link.from === start,
    )
  ) {
    return null;
  }
  const hash = before.indexOf("#");
  const target = hash < 0 ? before : before.slice(0, hash);
  const fragment = hash < 0 ? null : before.slice(hash + 1);
  return {
    from: start,
    to: closed ? close + 2 : caret,
    query: hash < 0 ? before : fragment!.replace(/^\^/, ""),
    target,
    fragment,
    mode: hash < 0 ? "note" : fragment!.startsWith("^") ? "block" : "heading",
    closed,
    ...(remainder.includes("|")
      ? { alias: remainder.slice(remainder.indexOf("|") + 1) }
      : {}),
  };
}

/** Explicit paths avoid silently selecting a different duplicate basename. */
export function wikiCompletionText(
  path: string,
  fragment?: string,
  alias?: string,
): string {
  const target = path.replace(/\.md$/i, "");
  return `[[${target}${fragment ? `#${fragment}` : ""}${alias !== undefined ? `|${alias}` : ""}]]`;
}

export function wikiCompletionEdit(
  from: number,
  to: number,
  item: { path: string; fragment?: string },
  alias?: string,
) {
  const insert = wikiCompletionText(item.path, item.fragment, alias);
  return { from, to, insert, cursor: from + insert.length };
}

export class CompletionGeneration {
  private current = 0;
  next(): number {
    return ++this.current;
  }
  isCurrent(generation: number): boolean {
    return generation === this.current;
  }
  cancel(): void {
    this.current++;
  }
}
