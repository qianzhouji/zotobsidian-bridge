import { Document, parseDocument } from "yaml";

export interface ParsedMarkdown {
  document: Document;
  body: string;
}

const legacyMetadataStart = "<!-- zotero-obsidian-bridge:metadata:start -->";
const legacyMetadataEnd = "<!-- zotero-obsidian-bridge:metadata:end -->";
const commentMetadataStart = "<!-- zotero-obsidian-bridge:metadata:start";
const commentMetadataEnd = "zotero-obsidian-bridge:metadata:end -->";
const hiddenMetadataStart =
  '<div style="display:none" data-zotero-obsidian-bridge="metadata">';
const hiddenMetadataEnd = "</div>";
const inlineMetadataPrefix =
  '<span data-zotero-obsidian-bridge="metadata" data-payload="';
const inlineMetadataPattern =
  /^<span data-zotero-obsidian-bridge="metadata" data-payload="([A-Za-z0-9+/=]+)"><\/span>$/;
const metadataFormat = 4;
const immutableIdentityFields = new Set([
  "bridge_schema",
  "bridge_card_id",
  "bridge_source_id",
]);

function encodeMetadata(value: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeMetadata(value: string): Record<string, unknown> {
  const binary = atob(value.trim());
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const decoded: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Hidden bridge metadata must be a JSON object.");
  }
  return decoded as Record<string, unknown>;
}

interface MetadataBlock {
  start: number;
  end: number;
  payload: string;
}

function findHiddenMetadataBlock(body: string): MetadataBlock | null {
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let offset = 0;
  let fence: { character: string; length: number } | null = null;
  let found: MetadataBlock | null = null;
  let pending: {
    start: number;
    payloadStart: number;
    endMarker: string;
  } | null = null;
  let payloadLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r?\n$/, "");
    const trimmed = line.trim();
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (!pending && fenceMatch) {
      if (!fence) {
        fence = {
          character: fenceMatch[1][0],
          length: fenceMatch[1].length,
        };
      } else if (
        fenceMatch[1][0] === fence.character &&
        fenceMatch[1].length >= fence.length &&
        /^\s{0,3}(?:`{3,}|~{3,})\s*$/.test(line)
      ) {
        fence = null;
      }
      if (!pending) {
        offset += rawLine.length;
        continue;
      }
    }

    if (!fence && !pending) {
      if (trimmed.startsWith(inlineMetadataPrefix)) {
        const match = inlineMetadataPattern.exec(trimmed);
        if (!match)
          throw new Error("Hidden bridge metadata block is malformed.");
        if (found) throw new Error("Duplicate hidden bridge metadata blocks.");
        found = {
          start: offset,
          end: offset + line.length,
          payload: match[1],
        };
        offset += rawLine.length;
        continue;
      }
      const legacyStart = trimmed === legacyMetadataStart;
      const commentStart = trimmed === commentMetadataStart;
      const hiddenStart = trimmed === hiddenMetadataStart;
      if (legacyStart || commentStart || hiddenStart) {
        if (found) throw new Error("Duplicate hidden bridge metadata blocks.");
        pending = {
          start: offset,
          payloadStart: offset + rawLine.length,
          endMarker: hiddenStart
            ? hiddenMetadataEnd
            : legacyStart
              ? legacyMetadataEnd
              : commentMetadataEnd,
        };
        payloadLines = [];
        offset += rawLine.length;
        continue;
      }
      if (trimmed === legacyMetadataEnd || trimmed === commentMetadataEnd) {
        throw new Error("Hidden bridge metadata block is malformed.");
      }
    } else if (pending) {
      if (trimmed === pending.endMarker) {
        found = {
          start: pending.start,
          end: offset + line.length,
          payload: payloadLines.join(""),
        };
        pending = null;
        payloadLines = [];
        offset += rawLine.length;
        continue;
      }
      if (
        trimmed === legacyMetadataStart ||
        trimmed === commentMetadataStart ||
        trimmed === hiddenMetadataStart ||
        trimmed.startsWith(inlineMetadataPrefix)
      ) {
        throw new Error("Nested hidden bridge metadata blocks.");
      }
      payloadLines.push(rawLine);
    }
    offset += rawLine.length;
  }

  if (pending) throw new Error("Hidden bridge metadata block is malformed.");
  return found;
}

function readHiddenMetadata(markdown: string): Record<string, unknown> {
  const { body } = parseMarkdownFrontmatter(markdown);
  const block = findHiddenMetadataBlock(body);
  return block ? decodeMetadata(block.payload) : {};
}

/** Display-only masking preserves source offsets used by read-only anchors. */
export function maskBridgeMetadata(body: string): string {
  try {
    const block = findHiddenMetadataBlock(body);
    if (!block) return body;
    decodeMetadata(block.payload);
    return (
      body.slice(0, block.start) +
      body.slice(block.start, block.end).replace(/[^\r\n]/g, " ") +
      body.slice(block.end)
    );
  } catch {
    return body;
  }
}

function withHiddenMetadata(
  body: string,
  metadata: Record<string, unknown>,
): string {
  const current = findHiddenMetadataBlock(body);
  const inlineBlock = `${inlineMetadataPrefix}${encodeMetadata({
    ...metadata,
    bridge_metadata_format: metadataFormat,
  })}"></span>`;
  const withoutCurrent = current
    ? `${body.slice(0, current.start)}${body.slice(current.end)}`
    : body;
  const sourceEnd = "<!-- zotero-obsidian-bridge:source:end -->";
  const sourceEndIndex = withoutCurrent.indexOf(sourceEnd);
  if (sourceEndIndex < 0) {
    if (!current) return `${inlineBlock}\n${body}`;
    return `${body.slice(0, current.start)}${inlineBlock}${body.slice(current.end)}`;
  }

  let insertionIndex = sourceEndIndex + sourceEnd.length;
  if (withoutCurrent.startsWith("\r\n", insertionIndex)) insertionIndex += 2;
  else if (withoutCurrent[insertionIndex] === "\n") insertionIndex++;
  return `${withoutCurrent.slice(0, insertionIndex)}${inlineBlock}\n${withoutCurrent.slice(insertionIndex)}`;
}

function isBridgeOwnedProperty(key: string): boolean {
  return (
    key === "type" ||
    key === "note_title" ||
    key.startsWith("bridge_") ||
    key.startsWith("zotero_")
  );
}

function serializeMarkdownFrontmatter(
  document: Document,
  body: string,
): string {
  const separator = body.startsWith("\n") || body.startsWith("\r") ? "" : "\n";
  return `---\n${document.toString({ lineWidth: 0 })}---${separator}${body}`;
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
  const fields = value && typeof value === "object" ? value : {};
  if (Object.hasOwn(fields, key)) return fields[key];
  if (key === "zotero_paper_title" && Object.hasOwn(fields, "paper_title")) {
    return fields.paper_title;
  }
  const metadata = readHiddenMetadata(markdown);
  return metadata[key];
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
    if (immutableIdentityFields.has(key)) {
      throw new Error(
        `Refusing to modify immutable card identity field: ${key}`,
      );
    }
    parsed.document.set(key, value);
  }
  return `---\n${parsed.document.toString({ lineWidth: 0 })}---${parsed.body}`;
}

export function updateAnnotationCardMetadata(
  markdown: string,
  updates: Record<string, unknown>,
): string {
  const parsed = parseMarkdownFrontmatter(markdown);
  const metadata = readHiddenMetadata(markdown);
  const visibleFields = parsed.document.toJS() as Record<string, unknown>;

  for (const [key, value] of Object.entries(visibleFields)) {
    if (!isBridgeOwnedProperty(key)) continue;
    if (key === "zotero_paper_title") {
      if (!Object.hasOwn(visibleFields, "paper_title")) {
        parsed.document.set("paper_title", value);
        visibleFields.paper_title = value;
      }
    } else {
      metadata[key] = value;
    }
    parsed.document.delete(key);
  }

  if (Object.hasOwn(metadata, "zotero_paper_title")) {
    if (!Object.hasOwn(visibleFields, "paper_title")) {
      parsed.document.set("paper_title", metadata.zotero_paper_title);
      visibleFields.paper_title = metadata.zotero_paper_title;
    }
    delete metadata.zotero_paper_title;
  }

  for (const [key, value] of Object.entries(updates)) {
    if (
      key !== "note_title" &&
      !key.startsWith("bridge_") &&
      !key.startsWith("zotero_")
    ) {
      throw new Error(
        `Refusing to modify non-bridge frontmatter field: ${key}`,
      );
    }
    if (immutableIdentityFields.has(key)) {
      throw new Error(
        `Refusing to modify immutable card identity field: ${key}`,
      );
    }
    if (key === "zotero_paper_title") {
      parsed.document.set("paper_title", value);
      delete metadata.zotero_paper_title;
    } else {
      metadata[key] = value;
      parsed.document.delete(key);
    }
  }

  const body = withHiddenMetadata(parsed.body, metadata);
  return serializeMarkdownFrontmatter(parsed.document, body);
}

export function createMarkdownWithHiddenMetadata(
  visibleFields: Record<string, unknown>,
  metadata: Record<string, unknown>,
  body: string,
): string {
  return createMarkdownWithFrontmatter(
    visibleFields,
    withHiddenMetadata(body, metadata),
  );
}

export function hasSameMarkdownExceptUpdatedAt(
  left: string,
  right: string,
): boolean {
  const leftUpdatedAt = readFrontmatterValue(left, "bridge_updated_at");
  const rightUpdatedAt = readFrontmatterValue(right, "bridge_updated_at");
  if ((leftUpdatedAt === undefined) !== (rightUpdatedAt === undefined)) {
    return false;
  }
  const normalize = (markdown: string): string => {
    const parsed = parseMarkdownFrontmatter(markdown);
    parsed.document.delete("bridge_updated_at");
    const metadata = readHiddenMetadata(markdown);
    delete metadata.bridge_updated_at;
    const body = withHiddenMetadata(parsed.body, metadata);
    return serializeMarkdownFrontmatter(parsed.document, body);
  };
  try {
    return normalize(left) === normalize(right);
  } catch {
    return left === right;
  }
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
  _color = "",
  imageMarkdown = "",
): string {
  const lines = [
    sourceStart,
    `## ${headingText(pageLabel || "Annotation")}`,
    "",
  ];
  if (text) lines.push(...text.split("\n").map((line) => `> ${line}`), "");
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
