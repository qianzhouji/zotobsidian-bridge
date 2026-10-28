import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export interface ZoteroNoteConversion {
  markdown: string;
  warnings: string[];
}

const allowedLinkProtocols = new Set(["http:", "https:", "mailto:", "zotero:"]);

function encodeCommentData(value: string): string {
  return encodeURIComponent(value).replace(/--/g, "%2D%2D");
}

function isCitation(node: HTMLElement): boolean {
  return (
    node.classList.contains("citation") || node.hasAttribute("data-citation")
  );
}

function isMath(node: HTMLElement): boolean {
  return (
    node.tagName.toLowerCase() === "math" ||
    node.hasAttribute("data-math") ||
    node.hasAttribute("data-tex") ||
    node.classList.contains("math") ||
    node.classList.contains("mathjax")
  );
}

function safeLink(href: string): boolean {
  if (
    !href ||
    href.startsWith("#") ||
    (href.startsWith("/") && !href.startsWith("//"))
  ) {
    return true;
  }
  if (href.startsWith("//")) return false;
  try {
    const protocol = new URL(href, "https://zotero.invalid").protocol;
    return (
      (protocol === "https:" && !/^[a-z][a-z\d+.-]*:/i.test(href)) ||
      allowedLinkProtocols.has(protocol)
    );
  } catch {
    return false;
  }
}

function renderMath(node: HTMLElement, content: string): string {
  const tex =
    node.getAttribute("data-tex") ??
    node.getAttribute("data-math") ??
    node.getAttribute("alttext") ??
    (node.tagName.toLowerCase() === "math" ? "" : content.trim());
  if (!tex) return content;
  const delimiter = tex.includes("\n") ? "$$" : "$";
  return `${delimiter}${tex}${delimiter}`;
}

export function convertZoteroNoteHTML(
  html: string,
  parsedDocument?: Document,
  imagePaths: ReadonlyMap<string, string> = new Map(),
): ZoteroNoteConversion {
  const document =
    parsedDocument ?? new DOMParser().parseFromString(html, "text/html");
  const root = (document.body ??
    document.documentElement) as HTMLElement | null;
  if (!root) throw new Error("Zotero note HTML has no document root.");

  const warnings: string[] = [];
  const converter = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });
  converter.use(gfm);
  converter.remove(["script", "style", "noscript"]);
  const tableRows = (table: HTMLElement): Element[] =>
    Array.from(table.querySelectorAll("tr"));
  const headingRow = (table: HTMLElement): Element | null => {
    const rows = tableRows(table);
    const explicitHeader = table.querySelector("thead tr");
    if (explicitHeader) return explicitHeader;
    const first = rows[0];
    return first &&
      Array.from(first.children).every(
        (cell) => cell.tagName.toLowerCase() === "th",
      )
      ? first
      : null;
  };
  converter.addRule("zoteroTableCell", {
    filter: ["th", "td"],
    replacement: (content, node) => {
      const index = Array.prototype.indexOf.call(
        (node.parentNode as HTMLElement | null)?.children ?? [],
        node,
      );
      return `${index === 0 ? "| " : " "}${content.trim()} |`;
    },
  });
  converter.addRule("zoteroTableRow", {
    filter: "tr",
    replacement: (content, node) => {
      const table = node.parentElement?.closest("table") as HTMLElement | null;
      const row = node as HTMLElement;
      const isHeading = table !== null && headingRow(table) === row;
      if (!isHeading) return `\n${content}`;
      const cellCount = row.children.length;
      const separator = `| ${Array.from({ length: cellCount }, () => "---").join(" | ")} |`;
      return `\n${content}\n${separator}`;
    },
  });
  converter.addRule("zoteroTable", {
    filter: "table",
    replacement: (content, node) => {
      const table = node as HTMLElement;
      const rows = tableRows(table);
      if (!rows.length) return "";
      if (!headingRow(table)) {
        const columnCount = rows[0].children.length;
        const headings = Array.from(
          { length: columnCount },
          (_, index) => `Column ${index + 1}`,
        );
        const syntheticHeader = `| ${headings.join(" | ")} |\n| ${headings.map(() => "---").join(" | ")} |`;
        warnings.push(
          "A table without a header row was given generic column headings.",
        );
        return `\n\n${syntheticHeader}${content}\n\n`;
      }
      return `\n\n${content}\n\n`;
    },
  });
  converter.addRule("zoteroCitation", {
    filter: (node) => isCitation(node),
    replacement: (content, node) => {
      const visible = content.trim() || node.textContent?.trim() || "Citation";
      const data = node.getAttribute("data-citation");
      return data
        ? `${visible}<!-- zotero-citation:${encodeCommentData(data)} -->`
        : visible;
    },
  });
  converter.addRule("zoteroMath", {
    filter: (node) => isMath(node),
    replacement: (content, node) => renderMath(node, content),
  });
  converter.addRule("zoteroImage", {
    filter: "img",
    replacement: (_content, node) => {
      const alt = node.getAttribute("alt")?.trim() || "embedded image";
      const source = node.getAttribute("src")?.trim() || "";
      const keys = [
        node.getAttribute("data-attachment-key")?.trim(),
        node.getAttribute("data-attachment")?.trim(),
        source,
        node.getAttribute("data-src")?.trim(),
      ].filter((value): value is string => Boolean(value));
      const markdownPath = keys.map((key) => imagePaths.get(key)).find(Boolean);
      if (markdownPath) return `\n\n![${alt}](${markdownPath})\n\n`;
      warnings.push(`Image not imported: ${alt}.`);
      return `\n\n> [!warning] Image not imported: ${alt}.${source && !source.startsWith("data:") ? ` Source: ${source}` : " The Zotero note still contains the original image."}\n\n`;
    },
  });
  converter.addRule("unsafeLink", {
    filter: (node) =>
      node.tagName.toLowerCase() === "a" &&
      !safeLink(node.getAttribute("href")?.trim() || ""),
    replacement: (content, node) => {
      warnings.push("An unsafe link was retained as plain text.");
      return `${content || node.textContent || "[unsupported link]"} (link omitted)`;
    },
  });
  converter.addRule("unsupportedEmbeddedContent", {
    filter: (node) =>
      ["iframe", "video", "audio", "object", "embed", "canvas"].includes(
        node.tagName.toLowerCase(),
      ),
    replacement: (_content, node) => {
      const kind = node.tagName.toLowerCase();
      const source = node.getAttribute("src") || node.getAttribute("data");
      warnings.push(`Unsupported embedded ${kind} content was not imported.`);
      return `\n\n> [!warning] Embedded ${kind} content was not imported.${source ? ` Source: ${source}` : ""}\n\n`;
    },
  });

  const markdown = converter.turndown(root).trim();
  return { markdown, warnings };
}

export function formatZoteroNoteSourceBlock(
  title: string,
  zoteroURI: string,
  conversion: ZoteroNoteConversion,
): string {
  const body = conversion.markdown || "*(This Zotero note is empty.)*";
  return [
    "<!-- zotero-obsidian-bridge:source:start -->",
    "## Zotero note",
    "",
    `**Title:** ${title || "Untitled note"}`,
    "",
    `[Open in Zotero](${zoteroURI})`,
    "",
    body,
    "",
    "<!-- zotero-obsidian-bridge:source:end -->",
    "",
  ].join("\n");
}
