import {
  createZoteroNoteQueryClient,
  type NoteQueryClient,
} from "../adapters/note-query-client.ts";
import {
  internalLinkTarget,
  noteLinkAtOffset,
  localNoteAnchor,
} from "../core/note-links.ts";

/** C2 resolves navigation only. C4/C5 subscribe to the resolved event for child-card UI. */
export function bindNoteLinkNavigation(options: {
  previews: HTMLElement[];
  editor: HTMLElement;
  sourcePath: string;
  markdown(): string;
  offset(event: MouseEvent): number | null;
  status: HTMLElement;
  locateLocal(offset: number): void;
  createClient?: () => NoteQueryClient;
  onNavigate?(target: string, sourcePath: string, anchor?: HTMLElement): void;
}): () => void {
  let client: NoteQueryClient | undefined;
  let disposed = false;
  let sequence = 0;
  const navigate = async (target: string, anchor?: HTMLElement) => {
    const current = ++sequence;
    try {
      if (target.startsWith("#")) {
        const local = localNoteAnchor(options.markdown(), target.slice(1));
        options.status.textContent = `${target} (${local.state})`;
        if (local.offset !== undefined) options.locateLocal(local.offset);
        return;
      }
      if (options.onNavigate) {
        options.onNavigate(target, options.sourcePath, anchor);
        return;
      }
      client ??= (options.createClient ?? createZoteroNoteQueryClient)();
      options.status.textContent = "Resolving link...";
      const response = await client.query(
        "resolve-link",
        { linkpath: target, sourcePath: options.sourcePath },
        { channel: "navigation" },
      );
      if (disposed || current !== sequence) return;
      if (response.status !== "ok") {
        options.status.textContent = `Linked note: ${response.status}`;
        return;
      }
      const result = response.result;
      options.status.textContent = `${result.path}${result.fragment ? ` #${result.fragment} (${result.anchorState})` : ""}`;
      const view = options.editor.ownerDocument?.defaultView;
      if (view)
        options.editor.dispatchEvent(
          new view.CustomEvent("zob-note-link-resolved", {
            bubbles: true,
            detail: { sourcePath: options.sourcePath, target, ...result },
          }),
        );
    } catch (error) {
      if (!disposed && current === sequence)
        options.status.textContent = String(
          (error as { message?: unknown } | null)?.message ??
            error ??
            "Linked note unavailable",
        );
    }
  };
  const previewClick = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest?.(
      "a[data-zob-note-link]",
    );
    const target = internalLinkTarget(
      anchor?.getAttribute("data-zob-note-link") ?? "",
    );
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void navigate(target, anchor as HTMLElement);
  };
  const editorClick = (event: MouseEvent) => {
    if (!event.metaKey || event.button !== 0) return;
    const offset = options.offset(event);
    if (offset === null) return;
    const link = noteLinkAtOffset(options.markdown(), offset);
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    void navigate(link.target);
  };
  options.previews.forEach((preview) =>
    preview.addEventListener("click", previewClick, true),
  );
  options.editor.addEventListener("click", editorClick);
  return () => {
    disposed = true;
    sequence++;
    client?.close();
    options.previews.forEach((preview) =>
      preview.removeEventListener("click", previewClick, true),
    );
    options.editor.removeEventListener("click", editorClick);
    options.status.remove();
  };
}

export function createLinkStatus(parent: HTMLElement): HTMLElement {
  const document = parent.ownerDocument;
  if (!document) throw new Error("Link status requires a document.");
  const status = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "span",
  ) as HTMLElement;
  status.className = "zob-note-link-status";
  status.setAttribute("role", "status");
  status.style.cssText =
    "display:block;max-width:100%;overflow-wrap:anywhere;font-size:11px;color:#285e7b";
  parent.append(status);
  return status;
}
