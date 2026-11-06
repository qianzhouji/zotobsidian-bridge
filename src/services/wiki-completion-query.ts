import type { NoteQueryClient } from "../adapters/note-query-client.ts";
import type { WikiCompletionContext } from "../core/wiki-completion.ts";
import { CompletionGeneration } from "../core/wiki-completion.ts";
import { createMarkdownRenderer } from "../core/markdown-preview.ts";
import { localNoteAnchor } from "../core/note-links.ts";

export interface WikiCompletionOption {
  label: string;
  path: string;
  fragment?: string;
  alias?: string;
}

export type WikiCompletionResult =
  | { status: "ok"; items: WikiCompletionOption[]; cursor?: string }
  | {
      status:
        | "cancelled"
        | "offline"
        | "error"
        | "forbidden"
        | "unsupported"
        | "indexing"
        | "stale";
      items: [];
    };

/** Each editor owns a client; late results cannot cross a caret change or close. */
export class WikiCompletionQuery {
  private readonly generation = new CompletionGeneration();
  private closed = false;
  private readonly client: NoteQueryClient;

  constructor(client: NoteQueryClient) {
    this.client = client;
  }

  cancel(): void {
    this.generation.cancel();
    this.client.cancel("search");
    this.client.cancel("completion");
  }

  close(): void {
    this.closed = true;
    this.cancel();
    this.client.close();
  }

  async search(
    context: WikiCompletionContext,
    sourcePath: string,
    cursor?: string,
    localMarkdown?: string,
  ): Promise<WikiCompletionResult> {
    if (this.closed) return { status: "cancelled", items: [] };
    const generation = this.generation.next();
    const current = () => !this.closed && this.generation.isCurrent(generation);
    try {
      if (context.mode === "note") {
        const response = await this.client.search({
          query: context.query,
          sourcePath,
          limit: 20,
          ...(cursor ? { cursor } : {}),
        });
        if (!current()) return { status: "cancelled", items: [] };
        if (response.status !== "ok") return failure(response.status);
        return {
          status: "ok",
          items: response.result.items
            .filter((item) => !/[[\]|#]/.test(item.path))
            .map((item) => ({
              label: item.title || item.basename,
              path: item.path,
              ...(item.matchedAlias ? { alias: item.matchedAlias } : {}),
            })),
          cursor: response.result.cursor,
        };
      }
      if (!context.target && localMarkdown !== undefined) {
        const tokens = createMarkdownRenderer().parse(localMarkdown, {});
        const values: { heading: string; level: number }[] = [];
        for (let i = 0; i < tokens.length; i++) {
          if (tokens[i].type === "heading_open") {
            const heading = (tokens[i + 1]?.children ?? [])
              .filter((t) => t.type === "text" || t.type === "code_inline")
              .map((t) => t.content)
              .join("");
            values.push({ heading, level: Number(tokens[i].tag.slice(1)) });
          }
        }
        const options =
          context.mode === "heading"
            ? headingOptions(values)
            : tokens
                .filter((t) => t.type === "inline")
                .flatMap((t) => {
                  const id = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(
                    t.content,
                  )?.[1];
                  return id ? [{ label: id, fragment: `^${id}` }] : [];
                });
        return page(
          options.filter(
            (item) =>
              localNoteAnchor(localMarkdown, item.fragment).state === "found",
          ),
          "",
          context.query,
          cursor,
        );
      }
      const resolved = await this.client.query(
        "resolve-link",
        {
          linkpath: context.target || sourcePath,
          sourcePath,
        },
        { channel: "completion" },
      );
      if (!current()) return { status: "cancelled", items: [] };
      if (resolved.status !== "ok") return failure(resolved.status);
      const note = await this.client.query(
        "read-note",
        {
          path: resolved.result.path,
        },
        { channel: "completion" },
      );
      if (!current()) return { status: "cancelled", items: [] };
      if (
        note.status !== "ok" ||
        !note.result.metadata.valid ||
        note.result.revision !== resolved.result.revision ||
        note.result.metadata.revision !== note.result.revision
      ) {
        return { status: "error", items: [] };
      }
      const values =
        context.mode === "block"
          ? note.result.metadata.blocks.map((item) => ({
              label: item.id,
              fragment: `^${item.id}`,
            }))
          : headingOptions(note.result.metadata.headings);
      return page(values, note.result.path, context.query, cursor);
    } catch (error) {
      if (
        !current() ||
        (error as { status?: string })?.status === "cancelled"
      ) {
        return { status: "cancelled", items: [] };
      }
      const status = (error as { status?: string })?.status;
      return failure(status);
    }
  }
}

function failure(status?: string): WikiCompletionResult {
  return {
    status:
      status === "offline" || status === "timeout"
        ? "offline"
        : status === "forbidden" ||
            status === "unsupported" ||
            status === "indexing" ||
            status === "stale"
          ? status
          : "error",
    items: [],
  };
}

function headingOptions(headings: { heading: string; level: number }[]) {
  const ancestry: typeof headings = [];
  const values = headings.map((item) => {
    while (ancestry.length && ancestry[ancestry.length - 1].level >= item.level)
      ancestry.pop();
    ancestry.push(item);
    return {
      label: item.heading,
      fragment: ancestry.map((h) => h.heading).join("#"),
    };
  });
  // Identical hierarchy is ambiguous in Obsidian: do not offer a misleading jump.
  return values.filter(
    (item) =>
      values.filter((other) => other.fragment === item.fragment).length === 1,
  );
}

function page(
  values: { label: string; fragment: string }[],
  path: string,
  query: string,
  cursor?: string,
): WikiCompletionResult {
  const matches = values.filter(
    (item) =>
      !/[[\]|]/.test(item.fragment) &&
      item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const start = /^anchor:\d+$/.test(cursor ?? "")
    ? Number(cursor!.slice(7))
    : 0;
  return {
    status: "ok",
    items: matches.slice(start, start + 20).map((item) => ({ ...item, path })),
    ...(start + 20 < matches.length ? { cursor: `anchor:${start + 20}` } : {}),
  };
}
