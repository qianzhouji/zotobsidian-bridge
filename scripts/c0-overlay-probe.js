// Test-only: bundle as an IIFE, then call mount(root) inside an isolated Reader/editor.
export function mount(root) {
  if (!root?.isConnected)
    throw new Error("A connected Bridge root is required.");
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const source =
    root.getAttribute("data-annotation-i-d") ?? root.dataset.annotationID;
  const oldOverflow = root.style.overflow;
  root.style.overflow = "visible";
  const layer = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  layer.className = "zob-c0-overlay-probe";
  layer.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483000;";
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  const defs = doc.createElementNS(svg.namespaceURI, "defs");
  const marker = doc.createElementNS(svg.namespaceURI, "marker");
  const markerId = `c0-arrow-${Math.random().toString(36).slice(2)}`;
  for (const [key, value] of Object.entries({
    id: markerId,
    viewBox: "0 0 10 10",
    refX: "5",
    refY: "5",
    markerWidth: "6",
    markerHeight: "6",
    orient: "auto-start-reverse",
  }))
    marker.setAttribute(key, value);
  const shape = doc.createElementNS(svg.namespaceURI, "path");
  shape.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  shape.setAttribute("fill", "#78bfe9");
  marker.append(shape);
  defs.append(marker);
  svg.append(defs);
  layer.append(svg);
  const panels = [];
  const lines = [];
  const metrics = {
    pointer: 0,
    click: 0,
    wheel: 0,
    key: 0,
    drag: 0,
    disposed: false,
  };
  const cleanups = [];
  const make = (tag, text) => {
    const el = doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
    if (text) el.textContent = text;
    return el;
  };
  for (let i = 0; i < 2; i++) {
    const panel = make("section");
    panel.className = "label-popup zob-c0-child";
    panel.tabIndex = 0;
    panel.setAttribute("aria-label", `C0 read-only probe ${i + 1}`);
    panel.style.cssText = `position:absolute;left:${Math.max(8, win.innerWidth - 290)}px;top:${50 + i * 230}px;width:270px;height:210px;box-sizing:border-box;display:flex;flex-direction:column;pointer-events:auto;background:#fff;color:#111;border:1px solid #78bfe9;border-radius:6px;padding:0;box-shadow:0 4px 12px #0002;resize:both;overflow:hidden;min-width:180px;min-height:120px;font:13px/1.5 system-ui;`;
    const header = make(
      "header",
      `C0 ${i ? "Physics" : "Mathematics"} · Read only`,
    );
    header.style.cssText =
      "padding:8px;border-bottom:1px solid #d5e7f3;background:#e8f5fd;cursor:move;user-select:none;flex:0 0 auto";
    const content = make(
      "div",
      `Synthetic ${i ? "physics" : "mathematics"} note. Select this text.\n\n`.repeat(
        30,
      ),
    );
    content.style.cssText =
      "padding:10px;overflow:auto;white-space:pre-wrap;flex:1;min-height:0;user-select:text";
    panel.append(header, content);
    panels.push(panel);
    layer.append(panel);
    const line = doc.createElementNS(svg.namespaceURI, "line");
    for (const [key, value] of Object.entries({
      stroke: "#78bfe9",
      "stroke-width": "2",
      "stroke-dasharray": "6 5",
      "marker-start": `url(#${markerId})`,
      "marker-end": `url(#${markerId})`,
    }))
      line.setAttribute(key, value);
    svg.append(line);
    lines.push(line);
    for (const type of [
      "pointerdown",
      "mousedown",
      "click",
      "wheel",
      "keydown",
      "keyup",
    ])
      panel.addEventListener(type, (event) => {
        event.stopPropagation();
        if (type === "click") metrics.click++;
        if (type === "pointerdown") metrics.pointer++;
        if (type === "wheel") metrics.wheel++;
        if (type === "keydown") {
          metrics.key++;
          if (["Backspace", "Delete"].includes(event.key))
            event.preventDefault();
        }
      });
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      header.setPointerCapture(event.pointerId);
      const x = event.clientX,
        y = event.clientY;
      const left = parseFloat(panel.style.left),
        top = parseFloat(panel.style.top);
      const move = (next) => {
        panel.style.left = `${Math.max(0, Math.min(win.innerWidth - panel.offsetWidth, left + next.clientX - x))}px`;
        panel.style.top = `${Math.max(0, Math.min(win.innerHeight - panel.offsetHeight, top + next.clientY - y))}px`;
        draw();
      };
      const stop = (event) => {
        if (event?.type === "pointerup") metrics.drag++;
        header.removeEventListener("pointermove", move);
        header.removeEventListener("pointerup", stop);
        header.removeEventListener("pointercancel", stop);
      };
      header.addEventListener("pointermove", move);
      header.addEventListener("pointerup", stop);
      header.addEventListener("pointercancel", stop);
      cleanups.push(stop);
    });
  }
  root.append(layer);
  function draw() {
    const origin = root.getBoundingClientRect();
    const base = layer.getBoundingClientRect();
    panels.forEach((panel, index) => {
      const rect = panel.getBoundingClientRect();
      for (const [key, value] of Object.entries({
        x1: origin.left + origin.width / 2 - base.left,
        y1: origin.top + 14 - base.top,
        x2: rect.left + rect.width / 2 - base.left,
        y2: rect.top + 14 - base.top,
      }))
        lines[index].setAttribute(key, String(value));
    });
  }
  const resize = new win.ResizeObserver(draw);
  resize.observe(root);
  panels.forEach((panel) => resize.observe(panel));
  const observer = new win.MutationObserver(() => {
    if (!root.isConnected || root.dataset.annotationID !== source) dispose();
  });
  observer.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-annotation-i-d"],
  });
  function dispose() {
    if (metrics.disposed) return;
    metrics.disposed = true;
    observer.disconnect();
    resize.disconnect();
    cleanups.forEach((fn) => fn());
    layer.remove();
    root.style.overflow = oldOverflow;
  }
  draw();
  return { metrics, dispose, panels, layer };
}
