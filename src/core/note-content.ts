import {
  parseMarkdownFrontmatter,
  readFrontmatterValue,
  updateAnnotationCardMetadata,
} from "./markdown.ts";

const sourceStart = "<!-- zotero-obsidian-bridge:source:start -->";
const sourceEnd = "<!-- zotero-obsidian-bridge:source:end -->";
const notesHeading = "## My notes";

export interface UserNoteContent {
  title: string;
  markdown: string;
}

interface NotesSection {
  headingLine: number;
  beforeSource: boolean;
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

function locateNotesSection(
  lines: string[],
  source: { start: number; end: number },
): NotesSection {
  const find = (start: number, end: number) => {
    for (let index = start; index < end; index++) {
      if (lines[index].replace(/\r?\n$/, "") === notesHeading) return index;
    }
    return -1;
  };
  const beforeSource = find(0, source.start);
  if (beforeSource >= 0) {
    return { headingLine: beforeSource, beforeSource: true };
  }
  const afterSource = find(source.end + 1, lines.length);
  if (afterSource >= 0) {
    return { headingLine: afterSource, beforeSource: false };
  }
  throw new Error("Card has no user-owned 'My notes' section.");
}

export function readUserNoteContent(markdown: string): UserNoteContent {
  const parsed = parseMarkdownFrontmatter(markdown);
  const markers = locateSourceMarkers(parsed.body);
  const lines = parsed.body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const section = locateNotesSection(lines, markers);
  let userMarkdown = lines
    .slice(
      section.headingLine + 1,
      section.beforeSource ? markers.start : lines.length,
    )
    .join("");
  if (userMarkdown.startsWith("\n")) userMarkdown = userMarkdown.slice(1);
  if (section.beforeSource && userMarkdown.endsWith("\n\n")) {
    userMarkdown = userMarkdown.slice(0, -2);
  }
  const title = readFrontmatterValue(markdown, "note_title");
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
  const section = locateNotesSection(lines, markers);
  const noteSection = `${notesHeading}\n\n${content.markdown}${content.markdown ? "\n\n" : ""}`;
  const body = section.beforeSource
    ? `${lines.slice(0, section.headingLine).join("")}${noteSection}${lines.slice(markers.start).join("")}`
    : `${lines.slice(0, markers.start).join("")}${noteSection}${lines.slice(markers.start, section.headingLine).join("")}`;
  const withUpdatedBody = `---\n${parsed.document.toString({ lineWidth: 0 })}---${body}`;
  if (readFrontmatterValue(markdown, "type") === "zotero-annotation") {
    return updateAnnotationCardMetadata(withUpdatedBody, {
      note_title: content.title.trim() || null,
    });
  }
  parsed.document.set("note_title", content.title.trim() || null);
  return `---\n${parsed.document.toString({ lineWidth: 0 })}---${body}`;
}

export function sameUserNoteContent(
  left: UserNoteContent,
  right: UserNoteContent,
): boolean {
  return left.title === right.title && left.markdown === right.markdown;
}
