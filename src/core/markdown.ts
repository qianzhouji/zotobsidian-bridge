import { Document, parseDocument } from "yaml";

export interface ParsedMarkdown {
  document: Document;
  body: string;
}

export function parseMarkdownFrontmatter(markdown: string): ParsedMarkdown {
  const normalized = markdown.startsWith("\uFEFF")
    ? markdown.slice(1)
    : markdown;
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    throw new Error("Markdown card has no leading YAML frontmatter.");
  }

  const firstLineEnd = normalized.indexOf("\n") + 1;
  const close = /^(?:---|\.\.\.)[ \t]*\r?$/gm;
  close.lastIndex = firstLineEnd;
  const closing = close.exec(normalized);
  if (!closing) throw new Error("Markdown card frontmatter is not closed.");

  const yamlText = normalized.slice(firstLineEnd, closing.index);
  const document = parseDocument(yamlText, {
    strict: true,
    uniqueKeys: true,
    version: "1.2",
  });
  if (document.errors.length) {
    throw new Error(`Invalid YAML frontmatter: ${document.errors[0].message}`);
  }
  if (!document.contents || typeof document.contents !== "object") {
    throw new Error("Markdown card frontmatter must be a YAML mapping.");
  }

  return {
    document,
    body: normalized.slice(closing.index + closing[0].length),
  };
}

export function readFrontmatterValue(markdown: string, key: string): unknown {
  const value = parseMarkdownFrontmatter(markdown).document.toJS();
  return value && typeof value === "object" ? value[key] : undefined;
}

export function updateBridgeFrontmatter(
  markdown: string,
  updates: Record<string, unknown>,
): string {
  const parsed = parseMarkdownFrontmatter(markdown);
  for (const [key, value] of Object.entries(updates)) {
    if (!key.startsWith("bridge_") && !key.startsWith("zotero_")) {
      throw new Error(
        `Refusing to modify non-bridge frontmatter field: ${key}`,
      );
    }
    if (["bridge_schema", "bridge_card_id", "bridge_source_id"].includes(key)) {
      throw new Error(
        `Refusing to modify immutable card identity field: ${key}`,
      );
    }
    parsed.document.set(key, value);
  }
  return `---\n${parsed.document.toString({ lineWidth: 0 })}---${parsed.body}`;
}

export function createMarkdownWithFrontmatter(
  fields: Record<string, unknown>,
  body: string,
): string {
  const document = new Document(fields, { version: "1.2" });
  return `---\n${document.toString({ lineWidth: 0 })}---\n${body}`;
}

const sourceStart = "<!-- zotero-obsidian-bridge:source:start -->";
const sourceEnd = "<!-- zotero-obsidian-bridge:source:end -->";
const paperSourceStart = "<!-- zotero-obsidian-bridge:paper-source:start -->";
const paperSourceEnd = "<!-- zotero-obsidian-bridge:paper-source:end -->";

function headingText(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/(\\|`|\*|_|\{|\}|\[|\]|\(|\)|#|\+|-|\.|!|>)/g, "\\$1");
}

export function replaceSourceBlock(
  markdown: string,
  replacement: string,
): string {
  return replaceMarkedBlock(markdown, sourceStart, sourceEnd, replacement);
}

export function replacePaperSourceBlock(
  markdown: string,
  replacement: string,
): string {
  return replaceMarkedBlock(
    markdown,
    paperSourceStart,
    paperSourceEnd,
    replacement,
  );
}

function replaceMarkedBlock(
  markdown: string,
  startMarker: string,
  endMarker: string,
  replacement: string,
): string {
  const { body } = parseMarkdownFrontmatter(markdown);
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const sourceMarkers: { index: number; marker: string }[] = [];
  let fence: "```" | "~~~" | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/\r?\n$/, "");
    const fenceMatch = /^\s*(```|~~~)/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1] as "```" | "~~~";
      else if (fenceMatch[1] === fence) fence = null;
      continue;
    }
    if (!fence && (line === startMarker || line === endMarker)) {
      sourceMarkers.push({ index, marker: line });
    }
  }

  if (
    sourceMarkers.length !== 2 ||
    sourceMarkers[0].marker !== startMarker ||
    sourceMarkers[1].marker !== endMarker
  ) {
    throw new Error(
      "Card source section is missing or ambiguous; refusing update.",
    );
  }

  const start = sourceMarkers[0].index;
  const end = sourceMarkers[1].index;
  const prefix = lines.slice(0, start).join("");
  const suffix = lines.slice(end + 1).join("");
  const normalizedReplacement = replacement.replace(/\n*$/, "\n");
  return `${markdown.slice(0, markdown.length - body.length)}${prefix}${normalizedReplacement}${suffix}`;
}

export function formatSourceBlock(
  text: string,
  comment: string,
  pageLabel: string,
  zoteroURI: string,
  color = "",
  imageMarkdown = "",
): string {
  const lines = [
    sourceStart,
    `## ${headingText(pageLabel || "Annotation")}`,
    "",
  ];
  if (text) lines.push(...text.split("\n").map((line) => `> ${line}`), "");
  if (color) lines.push(`**Highlight color:** ${color}`, "");
  if (comment) lines.push("### Zotero comment", "", comment, "");
  if (imageMarkdown) lines.push(imageMarkdown, "");
  lines.push(`[Open in Zotero](${zoteroURI})`, "", sourceEnd, "");
  return lines.join("\n");
}

export function formatPaperSourceBlock(
  title: string,
  zoteroURI: string,
): string {
  return [
    paperSourceStart,
    `# ${headingText(title || "Untitled paper")}`,
    "",
    `[Open in Zotero](${zoteroURI})`,
    "",
    paperSourceEnd,
    "",
  ].join("\n");
}
