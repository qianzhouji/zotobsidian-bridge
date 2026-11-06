import {
  X,
  RefreshCw,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  Layers2,
  MoveDiagonal2,
  type IconNode,
} from "lucide";

export function noteElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className = "",
): HTMLElementTagNameMap[K] {
  const node = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    tag,
  ) as HTMLElementTagNameMap[K];
  node.className = className;
  return node;
}

export function noteLabels(doc: Document) {
  const zh = (
    doc.documentElement?.getAttribute("lang") ||
    doc.defaultView?.navigator.language ||
    ""
  ).startsWith("zh");
  return zh
    ? {
        loading: "正在读取",
        empty: "没有匹配的笔记",
        offline: "离线，无法检索",
        error: "读取失败",
        forbidden: "未获读取权限",
        unsupported: "不支持此目标",
        indexing: "索引准备中",
        stale: "内容已变化，请刷新",
        cached: "缓存，可能过期",
        ready: "已读取",
        readonly: "只读",
        close: "关闭知识卡",
        refresh: "刷新",
        open: "在 Obsidian 中打开",
        more: "下一页",
        back: "上一页",
        missing: "笔记不存在",
        anchor: "未定位到唯一锚点",
        image: "图片不可用",
        tooLarge: "超过大小限制",
        link: "双链候选",
        insertFailed: "无法保留撤销记录，本次未插入",
        pending: "待建卡：使用明确笔记路径",
        dynamic: "动态内容未执行",
        collapse: "收起关联知识卡",
        cardLimit: "已达到关联知识卡数量上限",
        resize: "调整知识卡大小",
      }
    : {
        loading: "Loading",
        empty: "No matching notes",
        offline: "Offline; search unavailable",
        error: "Read failed",
        forbidden: "Read access denied",
        unsupported: "Unsupported target",
        indexing: "Index preparing",
        stale: "Content changed; refresh",
        cached: "Cached; may be outdated",
        ready: "Ready",
        readonly: "Read only",
        close: "Close knowledge card",
        refresh: "Refresh",
        open: "Open in Obsidian",
        more: "Next page",
        back: "Previous page",
        missing: "Note not found",
        anchor: "No unique matching anchor",
        image: "Image unavailable",
        tooLarge: "Size limit exceeded",
        link: "Link suggestions",
        insertFailed: "Insertion cancelled: undo-safe editing unavailable",
        pending: "Pending card: explicit note paths",
        dynamic: "Dynamic content not executed",
        collapse: "Collapse linked knowledge cards",
        cardLimit: "Linked-card limit reached",
        resize: "Resize knowledge card",
      };
}

export function noteIconButton(
  doc: Document,
  kind: "close" | "refresh" | "open" | "more" | "back" | "collapse" | "resize",
  label: string,
): HTMLButtonElement {
  const button = noteElement(doc, "button", "zob-note-icon");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  const icons: Record<typeof kind, IconNode> = {
    close: X,
    refresh: RefreshCw,
    open: ArrowUpRight,
    more: ChevronDown,
    back: ChevronLeft,
    collapse: Layers2,
    resize: MoveDiagonal2,
  };
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(name, value);
  for (const [tag, attrs] of icons[kind][2] ?? []) {
    const child = doc.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attrs))
      child.setAttribute(name, String(value));
    svg.append(child);
  }
  button.append(svg);
  return button;
}

export function installNoteUIStyles(doc: Document): void {
  if (doc.getElementById("zob-note-ui-style")) return;
  const style = noteElement(doc, "style");
  style.id = "zob-note-ui-style";
  style.textContent = `
    .zob-completions,.zob-knowledge-card{box-sizing:border-box;background:#fff;color:#1f252a;border:1px solid #bed3e2;border-radius:6px;box-shadow:0 6px 22px #0003;font:14px/1.5 system-ui;letter-spacing:0;text-align:left}
    .zob-completions{position:fixed;z-index:2147483600;width:360px;max-width:calc(100vw - 16px);max-height:280px;overflow:auto;padding:4px}
    .zob-completion-row{display:block;width:100%;border:0;border-radius:3px;padding:6px 8px;text-align:left;background:#fff;color:#222;white-space:normal;overflow-wrap:anywhere;cursor:pointer}
    .zob-completion-row[aria-selected=true],.zob-completion-row:hover{background:#e5f3ff}
    .zob-completion-path{display:block;font-size:11px;color:#526673;overflow-wrap:anywhere}
    .zob-completions mark,.zob-completion-match{background:#d9edff;color:inherit}
    .zob-note-state{font-size:12px;overflow-wrap:anywhere;color:#526673;padding:4px 8px}
    .zob-note-icon{display:inline-flex!important;align-items:center;justify-content:center;flex:0 0 28px;width:28px;height:28px;padding:4px!important;border:0!important;border-radius:4px;background:transparent;color:#365f78;cursor:pointer}
    .zob-note-icon:hover{background:#e5f3ff}.zob-note-icon:disabled{opacity:.45;cursor:default}
    .zob-note-icon[hidden]{display:none!important}
    .zob-note-icon:focus-visible,.zob-completion-row:focus-visible{outline:2px solid #70b5e8;outline-offset:-2px}
    .zob-knowledge-card{position:fixed;z-index:2147483500;width:420px;height:430px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);display:flex;flex-direction:column;overflow:hidden}
    .zob-knowledge-layer{position:fixed;inset:0;z-index:2147483601;pointer-events:none;overflow:hidden;contain:layout style}
    .zob-knowledge-edges{position:absolute;inset:0;overflow:visible;pointer-events:none}
    .zob-knowledge-edge{fill:none;stroke:#78add2;stroke-width:1.5;stroke-dasharray:6 5;vector-effect:non-scaling-stroke}
    .zob-knowledge-header{display:flex;align-items:center;gap:4px;padding:8px;border-bottom:1px solid #d7e0e6;flex:none;cursor:grab;touch-action:none;user-select:none}
    .zob-knowledge-header:active{cursor:grabbing}
    .zob-knowledge-title{flex:1;min-width:0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .zob-knowledge-body{min-height:0;flex:1;overflow:auto;padding:12px;overflow-wrap:anywhere;background:#fff;color:#20252a;user-select:text}
    .zob-knowledge-body h1{font-size:22px}.zob-knowledge-body h2{font-size:19px}.zob-knowledge-body h3{font-size:16px}
    .zob-knowledge-body img{max-width:100%;height:auto}.zob-knowledge-body pre{overflow:auto;padding:8px;background:#f1f5f8}
    .zob-knowledge-body table{border-collapse:collapse;display:block;overflow:auto}.zob-knowledge-body td,.zob-knowledge-body th{border:1px solid #d7e0e6;padding:4px 8px}
    .zob-knowledge-body a{color:#276d9d}.zob-knowledge-body blockquote{border-left:3px solid #9dc9e8;margin-left:0;padding-left:10px}
    .zob-knowledge-body .zob-anchor-target{outline:2px solid #83bae4;background:#edf7ff}
    .zob-knowledge-body .math-block{overflow-x:auto}.zob-knowledge-body input[type=checkbox]{pointer-events:none}
    .zob-knowledge-card{position:absolute;inset:auto;min-width:0;min-height:0;max-width:none;max-height:none;box-sizing:border-box}
    .zob-knowledge-resize{position:absolute;right:2px;bottom:2px;z-index:2;touch-action:none;cursor:nwse-resize;background:#fff}
    .zob-card-group-message{position:absolute;max-width:min(360px,calc(100vw - 16px));padding:8px 12px;border:1px solid #bed3e2;border-radius:5px;background:#fff;color:#1f252a;box-shadow:0 4px 16px #0003;font:13px/1.4 system-ui;overflow-wrap:anywhere;pointer-events:auto}
    .cm-tooltip.zob-cm-completions{max-width:min(520px,calc(100vw - 16px));background:#fff;color:#222;border-color:#bed3e2;border-radius:4px}
    .zob-cm-completions ul{max-height:280px!important}.zob-cm-completions li{white-space:normal!important;overflow-wrap:anywhere}
    .zob-cm-completions .cm-completionLabel{display:none}.zob-cm-completions li[aria-selected]{background:#e5f3ff!important;color:#222!important}
  `;
  (doc.head ?? doc.documentElement)!.append(style);
}

const owners = new WeakMap<HTMLElement, { count: number; overflow: string }>();
/** Keep owned panels within Reader's popup ancestry, not an unrelated body portal. */
export function attachOwnedNotePanel(
  owner: HTMLElement,
  panel: HTMLElement,
): () => void {
  const state = owners.get(owner) ?? {
    count: 0,
    overflow: owner.style.overflow,
  };
  state.count++;
  owners.set(owner, state);
  owner.style.overflow = "visible";
  owner.append(panel);
  const stop = (event: Event) => event.stopPropagation();
  for (const type of [
    "pointerdown",
    "mousedown",
    "click",
    "wheel",
    "keydown",
    "keyup",
  ])
    panel.addEventListener(type, stop);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    panel.remove();
    if (--state.count === 0) {
      owner.style.overflow = state.overflow;
      owners.delete(owner);
    }
  };
}

export function positionNotePanel(
  panel: HTMLElement,
  x: number,
  y: number,
): void {
  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
  const actual = panel.getBoundingClientRect();
  // Native Reader popups can establish a transformed fixed-position container.
  panel.style.left = `${x + x - actual.left}px`;
  panel.style.top = `${y + y - actual.top}px`;
}

export function highlightedLabel(
  doc: Document,
  label: string,
  query: string,
): HTMLElement {
  const span = noteElement(doc, "span");
  const index = query
    ? label.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
    : -1;
  if (index < 0) span.textContent = label;
  else {
    span.append(doc.createTextNode(label.slice(0, index)));
    const mark = noteElement(doc, "mark", "zob-completion-match");
    mark.textContent = label.slice(index, index + query.length);
    span.append(mark, doc.createTextNode(label.slice(index + query.length)));
  }
  return span;
}
