import { parseMarkdownFrontmatter } from "./markdown.ts";

const sourceStart = "<!-- zotero-obsidian-bridge:source:start -->";
const sourceEnd = "<!-- zotero-obsidian-bridge:source:end -->";
const notesHeading = "## My notes";

export interface UserNoteContent {
  title: string;
  markdown: string;
}

function locateSourceMarkers(body: string): { start: number; end: number } {
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const markers: Array<{ index: number; marker: string }> = [];
  let fence: "```" | "~~~" | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/\r?\n$/, "");
    const fenceMatch = /^\s*(```|~~~)/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1] as "```" | "~~~";
      else if (fenceMatch[1] === fence) fence = null;
      continue;
    }
    if (!fence && (line === sourceStart || line === sourceEnd)) {
      markers.push({ index, marker: line });
    }
  }
  if (
    markers.length !== 2 ||
    markers[0].marker !== sourceStart ||
    markers[1].marker !== sourceEnd
  ) {
    throw new Error("Card source section is missing or ambiguous.");
  }
  return { start: markers[0].index, end: markers[1].index };
}

export function readUserNoteContent(markdown: string): UserNoteContent {
  const parsed = parseMarkdownFrontmatter(markdown);
  const markers = locateSourceMarkers(parsed.body);
  const lines = parsed.body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let headingLine = -1;
  for (let index = markers.end + 1; index < lines.length; index++) {
    if (lines[index].replace(/\r?\n$/, "") === notesHeading) {
      headingLine = index;
      break;
    }
  }
  if (headingLine < 0) {
    throw new Error("Card has no user-owned 'My notes' section.");
  }

  let userMarkdown = lines.slice(headingLine + 1).join("");
  if (userMarkdown.startsWith("\n")) userMarkdown = userMarkdown.slice(1);
  const title = parsed.document.get("note_title");
  return {
    title: typeof title === "string" ? title : "",
    markdown: userMarkdown,
  };
}

export function readSourceMarkdown(markdown: string): string {
  const { body } = parseMarkdownFrontmatter(markdown);
  const markers = locateSourceMarkers(body);
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return lines
    .slice(markers.start + 1, markers.end)
    .join("")
    .trim();
}

export function replaceUserNoteContent(
  markdown: string,
  content: UserNoteContent,
): string {
  const parsed = parseMarkdownFrontmatter(markdown);
  const markers = locateSourceMarkers(parsed.body);
  const lines = parsed.body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let headingLine = -1;
  for (let index = markers.end + 1; index < lines.length; index++) {
    if (lines[index].replace(/\r?\n$/, "") === notesHeading) {
      headingLine = index;
      break;
    }
  }
  if (headingLine < 0) {
    throw new Error("Card has no user-owned 'My notes' section.");
  }

  parsed.document.set("note_title", content.title.trim() || null);
  const body = `${lines.slice(0, headingLine).join("")}${notesHeading}\n${content.markdown}`;
  return `---\n${parsed.document.toString({ lineWidth: 0 })}---${body}`;
}

export function sameUserNoteContent(
  left: UserNoteContent,
  right: UserNoteContent,
): boolean {
  return left.title === right.title && left.markdown === right.markdown;
}
