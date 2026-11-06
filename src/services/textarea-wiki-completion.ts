import {
  wikiCompletionContext,
  wikiCompletionText,
} from "../core/wiki-completion.ts";
import {
  createZoteroNoteQueryClient,
  type NoteQueryClient,
} from "../adapters/note-query-client.ts";
import {
  WikiCompletionQuery,
  type WikiCompletionOption,
} from "./wiki-completion-query.ts";
import {
  highlightedLabel,
  installNoteUIStyles,
  noteElement,
  noteIconButton,
  noteLabels,
  attachOwnedNotePanel,
  positionNotePanel,
} from "./note-ui.ts";

/** Native insertText retains Gecko's undo stack; never fall back to resetting value. */
export function replaceTextareaRange(
  editor: HTMLTextAreaElement,
  from: number,
  to: number,
  text: string,
  caret = from + text.length,
): boolean {
  if (editor.readOnly || editor.disabled) return false;
  const doc = editor.ownerDocument!;
  const before = editor.value;
  editor.focus();
  editor.setSelectionRange(from, to);
  let inputSeen = false;
  const observe = () => {
    inputSeen = true;
  };
  editor.addEventListener("input", observe);
  try {
    if (!doc.execCommand("insertText", false, text)) return false;
    if (editor.value !== before.slice(0, from) + text + before.slice(to))
      return false;
    editor.setSelectionRange(caret, caret);
    if (!inputSeen)
      editor.dispatchEvent(
        new doc.defaultView!.Event("input", { bubbles: true }),
      );
    return true;
  } finally {
    editor.removeEventListener("input", observe);
  }
}

export function bindTextareaWikiCompletion(
  editor: HTMLTextAreaElement,
  sourcePath: string,
  createClient: () => NoteQueryClient = createZoteroNoteQueryClient,
): () => void {
  const doc = editor.ownerDocument!;
  const win = doc.defaultView!;
  installNoteUIStyles(doc);
  const labels = noteLabels(doc);
  const popup = noteElement(doc, "div", "zob-completions label-popup");
  popup.id = `zob-completion-${Math.random().toString(36).slice(2)}`;
  popup.setAttribute("role", "listbox");
  popup.setAttribute("aria-label", labels.link);
  popup.hidden = true;
  let detach: (() => void) | undefined;
  const owner = () =>
    (editor.closest(".zob-reader-card") ??
      editor.parentElement!) as HTMLElement;
  editor.setAttribute("aria-controls", popup.id);
  editor.setAttribute("aria-autocomplete", "list");
  let query: WikiCompletionQuery | undefined;
  let disposed = false;
  let composing = false;
  let mutating = false;
  let epoch = 0;
  let selected = 0;
  let items: WikiCompletionOption[] = [];
  let rows: HTMLElement[] = [];
  let pages: (string | undefined)[] = [undefined];
  let next: string | undefined;
  let signature = "";
  let timer: number | undefined;
  let suppressed = "";
  const context = () =>
    editor.selectionStart === editor.selectionEnd &&
    !editor.readOnly &&
    !editor.hidden &&
    !editor.closest("[hidden]")
      ? wikiCompletionContext(editor.value, editor.selectionStart ?? 0)
      : null;
  const hide = () => {
    epoch++;
    if (timer) win.clearTimeout(timer);
    query?.cancel();
    popup.hidden = true;
    detach?.();
    detach = undefined;
    items = [];
    rows = [];
    editor.setAttribute("aria-expanded", "false");
    editor.removeAttribute("aria-activedescendant");
  };
  const position = () => {
    if (popup.hidden) return;
    const rect = editor.getBoundingClientRect();
    const computed = win.getComputedStyle(editor)!;
    const mirror = noteElement(doc, "div");
    for (const property of [
      "font",
      "line-height",
      "padding",
      "border",
      "box-sizing",
      "letter-spacing",
      "tab-size",
      "word-spacing",
    ])
      mirror.style.setProperty(property, computed.getPropertyValue(property));
    mirror.style.cssText += `;position:fixed;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;left:${rect.left}px;top:${rect.top - editor.scrollTop}px;width:${rect.width}px;pointer-events:none`;
    mirror.textContent = editor.value.slice(0, editor.selectionStart ?? 0);
    const caret = noteElement(doc, "span");
    caret.textContent = "\u200b";
    mirror.append(caret);
    doc.documentElement!.append(mirror);
    const point = caret.getBoundingClientRect();
    mirror.remove();
    const width = Math.min(360, win.innerWidth - 16);
    popup.style.width = `${width}px`;
    const height = Math.min(
      popup.scrollHeight || 160,
      280,
      win.innerHeight - 16,
    );
    popup.style.maxHeight = `${height}px`;
    const y = Math.max(rect.top, Math.min(point.bottom, rect.bottom));
    positionNotePanel(
      popup,
      Math.max(8, Math.min(point.left, win.innerWidth - width - 8)),
      Math.max(
        8,
        Math.min(
          y + height < win.innerHeight - 8 ? y : point.top - height,
          win.innerHeight - height - 8,
        ),
      ),
    );
  };
  const select = (index: number) => {
    selected = (index + items.length) % Math.max(1, items.length);
    rows.forEach((row, i) =>
      row.setAttribute("aria-selected", String(i === selected)),
    );
    if (rows[selected]) {
      editor.setAttribute("aria-activedescendant", rows[selected].id);
      rows[selected].scrollIntoView({ block: "nearest" });
    }
  };
  const accept = (index: number) => {
    const current = context();
    const item = items[index];
    if (!current || !item || composing) return;
    const text = wikiCompletionText(item.path, item.fragment, current.alias);
    hide();
    mutating = true;
    const inserted = replaceTextareaRange(
      editor,
      current.from,
      current.to,
      text,
    );
    mutating = false;
    if (!inserted) {
      popup.textContent = labels.insertFailed;
      popup.hidden = false;
      position();
    }
  };
  const run = async () => {
    const current = context();
    if (!current || composing || disposed || doc.activeElement !== editor) {
      hide();
      return;
    }
    const id = ++epoch;
    popup.replaceChildren();
    popup.hidden = false;
    detach ??= attachOwnedNotePanel(owner(), popup);
    editor.setAttribute("aria-expanded", "true");
    const status = noteElement(doc, "div", "zob-note-state");
    status.setAttribute("role", "status");
    status.textContent = labels.loading;
    popup.append(status);
    position();
    try {
      query ??= new WikiCompletionQuery(createClient());
      const result = await query.search(
        current,
        sourcePath || "pending.md",
        pages.at(-1),
        editor.value,
      );
      if (disposed || id !== epoch || composing) return;
      popup.replaceChildren();
      items = result.items;
      rows = [];
      next = result.status === "ok" ? result.cursor : undefined;
      if (!items.length) {
        status.textContent =
          result.status === "ok"
            ? labels.empty
            : result.status === "cancelled"
              ? ""
              : labels[result.status];
        popup.append(status);
      }
      items.forEach((item, i) => {
        const row = noteElement(doc, "div", "zob-completion-row");
        row.id = `${popup.id}-${i}`;
        row.setAttribute("role", "option");
        row.append(highlightedLabel(doc, item.label, current.query));
        const path = noteElement(doc, "span", "zob-completion-path");
        path.textContent = [item.path, item.fragment, item.alias]
          .filter(Boolean)
          .join(" · ");
        row.append(path);
        row.addEventListener("mousedown", (e) => e.preventDefault());
        row.addEventListener("click", () => accept(i));
        popup.append(row);
        rows.push(row);
      });
      if (pages.length > 1) {
        const back = noteIconButton(doc, "back", labels.back);
        back.onclick = () => {
          pages.pop();
          void run();
        };
        popup.append(back);
      }
      if (next) {
        const more = noteIconButton(doc, "more", labels.more);
        more.onclick = () => {
          pages.push(next);
          void run();
        };
        popup.append(more);
      }
      select(0);
      position();
    } catch {
      if (id === epoch && !disposed) {
        popup.textContent = labels.offline;
        position();
      }
    }
  };
  const update = () => {
    if (mutating) return;
    const c = context();
    const key = c ? JSON.stringify([c, editor.selectionStart]) : "";
    if (composing || !c || key === suppressed || doc.activeElement !== editor) {
      hide();
      return;
    }
    if (signature !== key) {
      pages = [undefined];
      signature = key;
      hide();
      timer = win.setTimeout(() => void run(), 120);
    }
  };
  const input = () => {
    suppressed = "";
    update();
  };
  const keydown = (event: KeyboardEvent) => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    if (
      event.key === "[" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !editor.readOnly &&
      editor.selectionStart === editor.selectionEnd
    ) {
      const at = editor.selectionStart ?? 0;
      if (
        editor.value[at - 1] === "[" &&
        wikiCompletionContext(
          editor.value.slice(0, at) + "[" + editor.value.slice(at),
          at + 1,
        )
      ) {
        const tail = editor.value.slice(at);
        const text =
          "[" +
          (tail.startsWith("]]") ? "" : tail.startsWith("]") ? "]" : "]]");
        event.preventDefault();
        event.stopPropagation();
        mutating = true;
        replaceTextareaRange(editor, at, at, text, at + 1);
        mutating = false;
        input();
        return;
      }
    }
    if (popup.hidden) return;
    if (
      [
        "ArrowDown",
        "ArrowUp",
        "Enter",
        "Escape",
        "PageDown",
        "PageUp",
      ].includes(event.key)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        suppressed = signature;
        hide();
      } else if (event.key === "Enter") accept(selected);
      else if (event.key === "PageDown" && next) {
        pages.push(next);
        void run();
      } else if (event.key === "PageUp" && pages.length > 1) {
        pages.pop();
        void run();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp")
        select(selected + (event.key === "ArrowDown" ? 1 : -1));
    }
  };
  const start = () => {
    composing = true;
    hide();
  };
  const end = () => {
    composing = false;
    signature = "";
    input();
  };
  const blur = () => {
    signature = "";
    hide();
  };
  const preventBlur = (event: MouseEvent) => event.preventDefault();
  popup.addEventListener("mousedown", preventBlur);
  editor.addEventListener("input", input);
  editor.addEventListener("keydown", keydown, true);
  editor.addEventListener("click", update);
  editor.addEventListener("keyup", update);
  editor.addEventListener("select", update);
  editor.addEventListener("blur", blur);
  editor.addEventListener("compositionstart", start);
  editor.addEventListener("compositionend", end);
  win.addEventListener("resize", position);
  doc.addEventListener("scroll", position, true);
  return () => {
    disposed = true;
    hide();
    query?.close();
    popup.remove();
    editor.removeAttribute("aria-controls");
    editor.removeAttribute("aria-autocomplete");
    editor.removeAttribute("aria-expanded");
    editor.removeEventListener("input", input);
    editor.removeEventListener("keydown", keydown, true);
    editor.removeEventListener("click", update);
    editor.removeEventListener("keyup", update);
    editor.removeEventListener("select", update);
    editor.removeEventListener("blur", blur);
    editor.removeEventListener("compositionstart", start);
    editor.removeEventListener("compositionend", end);
    win.removeEventListener("resize", position);
    doc.removeEventListener("scroll", position, true);
  };
}
