import type { CardEdge, CardRect } from "../core/linked-card-group.ts";
import {
  initialCardRect,
  clampCardRect,
  resizeCardRect,
  moveCardRect,
  LINKED_CARD_GROUP_LIMIT,
  LINKED_CARD_WINDOW_LIMIT,
} from "../core/linked-card-group.ts";
import {
  attachOwnedNotePanel,
  noteIconButton,
  positionNotePanel,
} from "./note-ui.ts";

interface PanelEntry {
  panel: HTMLElement;
  header: HTMLElement;
  resizeHandle: HTMLElement;
  rect: CardRect;
  zIndex: number;
}

const groupsByDocument = new WeakMap<
  Document,
  Set<KnowledgeCardGroupSurface>
>();
let groupSequence = 0;

/** Owns one isolated set of linked cards and its non-intercepting edge layer. */
export class KnowledgeCardGroupSurface {
  private readonly id = `zob-card-group-${++groupSequence}`;
  private readonly doc: Document;
  private readonly win: Window;
  private readonly owner: HTMLElement;
  private readonly entries = new Map<string, PanelEntry>();
  private readonly pathKeys = new Map<string, string>();
  private readonly rootAnchors = new Map<string, HTMLElement>();
  private readonly edgeAnchors = new Map<string, HTMLElement[]>();
  private readonly controls?: HTMLElement;
  private readonly collapseButton?: HTMLButtonElement;
  private readonly onCollapse: () => void;
  private readonly panelCleanup = new Map<string, (() => void)[]>();
  private groupSet: Set<KnowledgeCardGroupSurface>;
  private layer?: HTMLElement;
  private detachLayer?: () => void;
  private svg?: SVGSVGElement;
  private lines?: SVGGElement;
  private message?: HTMLElement;
  private messageTimer?: number;
  private frame?: number;
  private topZ = 0;
  private disposed = false;
  private readonly onViewportChange = () => {
    this.constrainAll();
    this.scheduleEdges();
  };

  constructor(options: {
    owner: HTMLElement;
    controlHost?: HTMLElement;
    collapseLabel: string;
    limitLabel: string;
    onCollapse(): void;
  }) {
    this.doc = options.owner.ownerDocument!;
    this.win = this.doc.defaultView!;
    this.owner = options.owner;
    this.controls = options.controlHost;
    this.onCollapse = options.onCollapse;
    this.limitLabel = options.limitLabel;
    this.groupSet = groupsByDocument.get(this.doc) ?? new Set();
    groupsByDocument.set(this.doc, this.groupSet);
    this.groupSet.add(this);
    if (this.controls) {
      const button = noteIconButton(
        this.doc,
        "collapse",
        options.collapseLabel,
      );
      button.hidden = true;
      button.addEventListener("click", this.onCollapse);
      this.controls.append(button);
      this.collapseButton = button;
    }
    this.win.addEventListener("resize", this.onViewportChange);
    this.doc.addEventListener("scroll", this.onViewportChange, true);
    const ResizeObserverConstructor = (
      this.win as Window & { ResizeObserver?: typeof ResizeObserver }
    ).ResizeObserver;
    if (ResizeObserverConstructor) {
      this.resizeObserver = new ResizeObserverConstructor(this.scheduleEdges);
      this.resizeObserver.observe(this.owner);
    }
  }

  private readonly limitLabel: string;
  private resizeObserver?: ResizeObserver;

  get cardCount(): number {
    return this.entries.size;
  }

  canAddCard(): boolean {
    let windowCount = 0;
    for (const group of this.groupSet) windowCount += group.cardCount;
    return (
      !this.disposed &&
      this.entries.size < LINKED_CARD_GROUP_LIMIT &&
      windowCount < LINKED_CARD_WINDOW_LIMIT
    );
  }

  addPanel(
    key: string,
    panel: HTMLElement,
    header: HTMLElement,
    resizeHandle: HTMLElement,
    anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  ): boolean {
    if (!this.canAddCard()) {
      this.showLimit(anchor);
      return false;
    }
    this.ensureLayer();
    const rect = initialCardRect(anchor, this.viewport(), this.entries.size);
    const entry: PanelEntry = { panel, header, resizeHandle, rect, zIndex: 0 };
    this.entries.set(key, entry);
    this.layer!.append(panel);
    panel.style.position = "absolute";
    panel.style.pointerEvents = "auto";
    this.applyRect(entry);
    this.installPanelEvents(key, entry);
    this.installDrag(key, entry);
    this.installResize(key, entry);
    if (this.collapseButton) this.collapseButton.hidden = false;
    this.focus(key);
    this.scheduleEdges();
    return true;
  }

  bindPath(path: string, key: string): void {
    this.pathKeys.set(path, key);
    this.scheduleEdges();
  }

  unbindPath(path: string): void {
    this.pathKeys.delete(path);
    this.scheduleEdges();
  }

  setRootAnchor(sourcePath: string, anchor: HTMLElement | undefined): void {
    if (anchor) this.rootAnchors.set(sourcePath, anchor);
  }

  unbindRootAnchor(sourcePath: string): void {
    this.rootAnchors.delete(sourcePath);
  }

  setEdges(edges: CardEdge[]): void {
    this.edges = edges;
    const pairs = new Set(
      edges.map((edge) => [edge.from, edge.to].sort().join("\0")),
    );
    for (const key of this.edgeAnchors.keys())
      if (!pairs.has(key.split("\0").sort().join("\0")))
        this.edgeAnchors.delete(key);
    this.scheduleEdges();
  }

  setEdgeAnchors(from: string, to: string, anchors: HTMLElement[]): void {
    this.edgeAnchors.set(`${from}\0${to}`, anchors);
    this.scheduleEdges();
  }

  focus(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.zIndex = ++this.topZ;
    entry.panel.style.zIndex = String(entry.zIndex + 1);
    this.scheduleEdges();
  }

  removePanel(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    entry.panel.remove();
    for (const [path, pathKey] of this.pathKeys)
      if (pathKey === key) this.pathKeys.delete(path);
    for (const cleanup of this.panelCleanup.get(key) ?? []) cleanup();
    this.panelCleanup.delete(key);
    if (!this.entries.size) {
      this.removeLayer();
      if (this.collapseButton) this.collapseButton.hidden = true;
    } else this.scheduleEdges();
  }

  clearPanels(): void {
    for (const key of [...this.entries.keys()]) this.removePanel(key);
    this.edges = [];
    this.pathKeys.clear();
    this.rootAnchors.clear();
    this.edgeAnchors.clear();
    this.message?.remove();
    this.message = undefined;
    if (!this.entries.size) this.removeLayer();
  }

  showLimit(anchor?: Pick<DOMRect, "left" | "right" | "top" | "bottom">): void {
    this.ensureLayer();
    if (!this.message) {
      this.message = this.doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      ) as HTMLElement;
      this.message.className = "zob-card-group-message";
      this.message.setAttribute("role", "status");
      this.layer!.append(this.message);
    }
    this.message.textContent = this.limitLabel;
    if (anchor) {
      const rect = initialCardRect(anchor, this.viewport(), 0);
      this.message.style.left = `${rect.x}px`;
      this.message.style.top = `${rect.y}px`;
    }
    if (this.messageTimer) this.win.clearTimeout(this.messageTimer);
    this.messageTimer = this.win.setTimeout(() => {
      this.message?.remove();
      this.message = undefined;
      this.messageTimer = undefined;
      if (!this.entries.size) this.removeLayer();
    }, 3500);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const key of [...this.entries.keys()]) this.removePanel(key);
    this.removeLayer();
    this.collapseButton?.removeEventListener("click", this.onCollapse);
    this.collapseButton?.remove();
    this.win.removeEventListener("resize", this.onViewportChange);
    this.doc.removeEventListener("scroll", this.onViewportChange, true);
    this.resizeObserver?.disconnect();
    if (this.frame !== undefined) this.cancelFrame(this.frame);
    if (this.messageTimer) this.win.clearTimeout(this.messageTimer);
    this.groupSet.delete(this);
    if (!this.groupSet.size) groupsByDocument.delete(this.doc);
  }

  private edges: CardEdge[] = [];

  private ensureLayer(): void {
    if (this.layer) return;
    this.layer = this.doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    this.layer.className = "zob-knowledge-layer";
    this.layer.dataset.groupId = this.id;
    this.layer.style.pointerEvents = "none";
    this.layer.style.inset = "auto";
    this.layer.style.right = "auto";
    this.layer.style.bottom = "auto";
    this.layer.style.width = "100vw";
    this.layer.style.height = "100vh";
    const svg = this.doc.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    ) as unknown as SVGSVGElement;
    svg.setAttribute("class", "zob-knowledge-edges");
    svg.setAttribute("aria-hidden", "true");
    svg.style.pointerEvents = "none";
    const lines = this.doc.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    ) as unknown as SVGGElement;
    lines.setAttribute("class", "zob-knowledge-edge-lines");
    const defs = this.doc.createElementNS("http://www.w3.org/2000/svg", "defs");
    for (const suffix of ["start", "end"]) {
      const marker = this.doc.createElementNS(
        "http://www.w3.org/2000/svg",
        "marker",
      );
      marker.id = `${this.id}-${suffix}`;
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", suffix === "start" ? "1" : "9");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "5");
      marker.setAttribute("markerHeight", "5");
      marker.setAttribute("orient", "auto-start-reverse");
      const arrow = this.doc.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
      arrow.setAttribute("fill", "#78add2");
      marker.append(arrow);
      defs.append(marker);
    }
    svg.append(defs, lines);
    this.svg = svg;
    this.lines = lines;
    this.layer.append(svg);
    this.detachLayer = attachOwnedNotePanel(this.owner, this.layer);
    positionNotePanel(this.layer, 0, 0);
    this.updateSvgSize();
  }

  private removeLayer(): void {
    this.detachLayer?.();
    this.detachLayer = undefined;
    this.layer = undefined;
    this.svg = undefined;
    this.lines = undefined;
    this.message?.remove();
    this.message = undefined;
  }

  private addCleanup(key: string, cleanup: () => void): void {
    const list = this.panelCleanup.get(key) ?? [];
    list.push(cleanup);
    this.panelCleanup.set(key, list);
  }

  private installPanelEvents(key: string, entry: PanelEntry): void {
    const stop = (event: Event) => event.stopPropagation();
    for (const type of [
      "pointerdown",
      "mousedown",
      "click",
      "wheel",
      "keydown",
      "keyup",
    ]) {
      entry.panel.addEventListener(type, stop);
      this.addCleanup(key, () => entry.panel.removeEventListener(type, stop));
    }
    const focus = () => this.focus(key);
    entry.panel.addEventListener("focusin", focus);
    this.addCleanup(key, () =>
      entry.panel.removeEventListener("focusin", focus),
    );
  }

  private installDrag(key: string, entry: PanelEntry): void {
    let start:
      | { x: number; y: number; rect: CardRect; pointerId: number }
      | undefined;
    const down = (event: Event) => {
      const pointer = event as PointerEvent;
      if (pointer.button !== 0 || (pointer.target as Element).closest("button"))
        return;
      event.preventDefault();
      start = {
        x: pointer.clientX,
        y: pointer.clientY,
        rect: { ...entry.rect },
        pointerId: pointer.pointerId,
      };
      entry.header.setPointerCapture?.(pointer.pointerId);
      this.focus(key);
    };
    const move = (event: Event) => {
      if (!start) return;
      const pointer = event as PointerEvent;
      entry.rect = moveCardRect(
        start.rect,
        pointer.clientX - start.x,
        pointer.clientY - start.y,
        this.viewport(),
      );
      this.applyRect(entry);
      this.scheduleEdges();
    };
    const end = (event: Event) => {
      if (!start) return;
      const pointer = event as PointerEvent;
      try {
        entry.header.releasePointerCapture?.(pointer.pointerId);
      } catch {
        // Pointer capture may already have been released by the platform.
      }
      start = undefined;
      entry.rect = clampCardRect(entry.rect, this.viewport());
      this.applyRect(entry);
      this.scheduleEdges();
    };
    entry.header.addEventListener("pointerdown", down);
    entry.header.addEventListener("pointermove", move);
    entry.header.addEventListener("pointerup", end);
    entry.header.addEventListener("pointercancel", end);
    this.win.addEventListener("blur", end);
    this.addCleanup(key, () => {
      entry.header.removeEventListener("pointerdown", down);
      entry.header.removeEventListener("pointermove", move);
      entry.header.removeEventListener("pointerup", end);
      entry.header.removeEventListener("pointercancel", end);
      this.win.removeEventListener("blur", end);
    });
  }

  private installResize(key: string, entry: PanelEntry): void {
    let start: { x: number; y: number; rect: CardRect } | undefined;
    const down = (event: Event) => {
      const pointer = event as PointerEvent;
      if (pointer.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      start = {
        x: pointer.clientX,
        y: pointer.clientY,
        rect: { ...entry.rect },
      };
      entry.resizeHandle.setPointerCapture?.(pointer.pointerId);
      this.focus(key);
    };
    const move = (event: Event) => {
      if (!start) return;
      const pointer = event as PointerEvent;
      entry.rect = resizeCardRect(
        start.rect,
        pointer.clientX - start.x,
        pointer.clientY - start.y,
        this.viewport(),
      );
      this.applyRect(entry);
      this.scheduleEdges();
    };
    const end = (event: Event) => {
      if (!start) return;
      const pointer = event as PointerEvent;
      try {
        entry.resizeHandle.releasePointerCapture?.(pointer.pointerId);
      } catch {
        // Pointer capture may already have been released by the platform.
      }
      start = undefined;
      entry.rect = clampCardRect(entry.rect, this.viewport());
      this.applyRect(entry);
      this.scheduleEdges();
    };
    entry.resizeHandle.addEventListener("pointerdown", down);
    entry.resizeHandle.addEventListener("pointermove", move);
    entry.resizeHandle.addEventListener("pointerup", end);
    entry.resizeHandle.addEventListener("pointercancel", end);
    this.win.addEventListener("blur", end);
    this.addCleanup(key, () => {
      entry.resizeHandle.removeEventListener("pointerdown", down);
      entry.resizeHandle.removeEventListener("pointermove", move);
      entry.resizeHandle.removeEventListener("pointerup", end);
      entry.resizeHandle.removeEventListener("pointercancel", end);
      this.win.removeEventListener("blur", end);
    });
  }

  private applyRect(entry: PanelEntry): void {
    entry.panel.style.left = `${entry.rect.x}px`;
    entry.panel.style.top = `${entry.rect.y}px`;
    entry.panel.style.width = `${entry.rect.width}px`;
    entry.panel.style.height = `${entry.rect.height}px`;
  }

  private viewport() {
    return {
      width: this.win.innerWidth || this.doc.documentElement?.clientWidth || 1,
      height:
        this.win.innerHeight || this.doc.documentElement?.clientHeight || 1,
    };
  }

  private constrainAll(): void {
    const viewport = this.viewport();
    this.updateSvgSize();
    for (const entry of this.entries.values()) {
      entry.rect = clampCardRect(entry.rect, viewport);
      this.applyRect(entry);
    }
  }

  private updateSvgSize(): void {
    if (!this.svg) return;
    const { width, height } = this.viewport();
    this.svg.setAttribute("width", String(width));
    this.svg.setAttribute("height", String(height));
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  private scheduleEdges = (): void => {
    if (this.frame !== undefined || !this.svg) return;
    this.frame = this.requestFrame(() => {
      this.frame = undefined;
      this.renderEdges();
    });
  };

  private renderEdges(): void {
    if (!this.lines) return;
    this.lines.replaceChildren();
    const drawn = new Set<string>();
    for (const edge of this.edges) {
      const pair = [edge.from, edge.to].sort().join("\0");
      if (drawn.has(pair)) continue;
      const targetKey = this.pathKeys.get(edge.to);
      const targetEntry = targetKey ? this.entries.get(targetKey) : undefined;
      const sourceKey = this.pathKeys.get(edge.from);
      const sourceEntry = sourceKey ? this.entries.get(sourceKey) : undefined;
      const rootPath = this.rootAnchors.has(edge.from)
        ? edge.from
        : this.rootAnchors.has(edge.to)
          ? edge.to
          : undefined;
      const rootLink = rootPath
        ? this.edgeAnchors
            .get(`${rootPath}\0${rootPath === edge.from ? edge.to : edge.from}`)
            ?.find((anchor) => this.anchorVisible(anchor))
        : undefined;
      const rootAnchor = rootPath ? this.rootAnchors.get(rootPath) : undefined;
      const rootLinkedToPopup = Boolean(
        rootPath &&
        ((rootPath === edge.from && targetEntry) ||
          (rootPath === edge.to && sourceEntry)),
      );
      let source: HTMLElement | undefined;
      let target: HTMLElement | undefined;
      let popupToPopup = Boolean(sourceEntry && targetEntry);
      let sourceRect: DOMRect;
      let targetRect: DOMRect;

      if (rootLinkedToPopup) {
        // Keep the Bridge endpoint on its actual wikilink, regardless of the
        // direction in which the semantic edge happened to be discovered.
        source = rootLink ?? rootAnchor ?? this.owner;
        target =
          rootPath === edge.from ? targetEntry!.header : sourceEntry!.header;
        sourceRect = source.getBoundingClientRect();
        targetRect = target.getBoundingClientRect();
        popupToPopup = false;
      } else {
        source = sourceEntry?.header ?? rootAnchor ?? this.owner;
        target = targetEntry?.header ?? this.rootAnchors.get(edge.to);
        if (!source || !target) continue;
        sourceRect = source.getBoundingClientRect();
        targetRect = target.getBoundingClientRect();
      }
      if (!source || !target) continue;
      drawn.add(pair);
      const line = this.doc.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      line.setAttribute("class", "zob-knowledge-edge");
      if (edge.from === edge.to) {
        const x = sourceRect.right - 14;
        const y = sourceRect.top + sourceRect.height / 2;
        line.setAttribute(
          "d",
          `M ${x} ${y - 8} C ${x + 38} ${y - 34}, ${x + 38} ${y + 34}, ${x} ${y + 8}`,
        );
      } else if (popupToPopup) {
        const sourcePanel = sourceEntry!.panel.getBoundingClientRect();
        const targetPanel = targetEntry!.panel.getBoundingClientRect();
        const horizontallyOverlapping =
          sourcePanel.width > 0 &&
          targetPanel.width > 0 &&
          sourcePanel.left < targetPanel.right &&
          targetPanel.left < sourcePanel.right;
        const verticallySeparate =
          sourcePanel.bottom <= targetPanel.top ||
          targetPanel.bottom <= sourcePanel.top;
        if (horizontallyOverlapping && verticallySeparate) {
          const left = Math.min(sourcePanel.left, targetPanel.left);
          const right = Math.max(sourcePanel.right, targetPanel.right);
          const useRight = this.viewport().width - right >= left;
          const side = useRight ? "right" : "left";
          const start = this.sidePoint(sourceRect, targetRect, side);
          const end = this.sidePoint(targetRect, sourceRect, side);
          const outer = useRight ? right + 48 : left - 48;
          line.setAttribute(
            "d",
            `M ${start.x} ${start.y} C ${outer} ${start.y}, ${outer} ${end.y}, ${end.x} ${end.y}`,
          );
        } else {
          const sourceCenter = (sourceRect.left + sourceRect.right) / 2;
          const targetCenter = (targetRect.left + targetRect.right) / 2;
          const alignedTolerance =
            Math.min(sourceRect.width, targetRect.width) * 0.18;
          const nearlyAligned =
            Math.abs(targetCenter - sourceCenter) <= alignedTolerance;
          const sourceSide: "left" | "right" = nearlyAligned
            ? edge.from.localeCompare(edge.to) <= 0
              ? "right"
              : "left"
            : targetCenter >= sourceCenter
              ? "right"
              : "left";
          const targetSide = sourceSide === "right" ? "left" : "right";
          const sourcePoint = this.sidePoint(
            sourceRect,
            targetRect,
            sourceSide,
          );
          const targetPoint = this.sidePoint(
            targetRect,
            sourceRect,
            targetSide,
          );
          this.setSidePath(line, sourcePoint, targetPoint);
        }
      } else {
        const sourcePoint = rootLinkedToPopup
          ? this.rectCenter(sourceRect)
          : this.sidePoint(sourceRect, targetRect);
        const targetPoint = this.sidePoint(targetRect, sourceRect);
        this.setSidePath(line, sourcePoint, targetPoint);
      }
      line.setAttribute("marker-start", `url(#${this.id}-start)`);
      line.setAttribute("marker-end", `url(#${this.id}-end)`);
      const title = this.doc.createElementNS(
        "http://www.w3.org/2000/svg",
        "title",
      );
      title.textContent = this.edges
        .filter(
          (relation) => [relation.from, relation.to].sort().join("\0") === pair,
        )
        .map((relation) => `${relation.from} → ${relation.to}`)
        .join("; ");
      line.append(title);
      this.lines.append(line);
    }
  }

  private rectCenter(rect: DOMRect): { x: number; y: number } {
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  }

  private sidePoint(
    rect: DOMRect,
    toward: DOMRect,
    fallbackSide?: "left" | "right",
  ): { x: number; y: number } {
    const centerX = (rect.left + rect.right) / 2;
    const targetX = (toward.left + toward.right) / 2;
    const right = fallbackSide ? fallbackSide === "right" : targetX >= centerX;
    return {
      x: right ? rect.right : rect.left,
      y: rect.top + rect.height / 2,
    };
  }

  private setSidePath(
    line: Element,
    source: { x: number; y: number },
    target: { x: number; y: number },
  ): void {
    const forward = target.x >= source.x;
    const curve = Math.max(36, Math.abs(target.x - source.x) * 0.32);
    const c1 = source.x + (forward ? curve : -curve);
    const c2 = target.x - (forward ? curve : -curve);
    line.setAttribute(
      "d",
      `M ${source.x} ${source.y} C ${c1} ${source.y}, ${c2} ${target.y}, ${target.x} ${target.y}`,
    );
  }

  private anchorVisible(anchor: HTMLElement): boolean {
    if (!anchor.isConnected) return false;
    // visibility is inherited but descendants can override it. Reader hides
    // its native popup shell and explicitly makes the Bridge child visible.
    const visibility = this.win.getComputedStyle?.(anchor)?.visibility;
    if (visibility === "hidden" || visibility === "collapse") return false;
    const rect = anchor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    let left = Math.max(0, rect.left);
    let top = Math.max(0, rect.top);
    let right = Math.min(this.viewport().width, rect.right);
    let bottom = Math.min(this.viewport().height, rect.bottom);
    for (let node: Element | null = anchor; node; node = node.parentElement) {
      if ((node as HTMLElement).hidden) return false;
      const style = this.win.getComputedStyle?.(node);
      if (style?.display === "none") return false;
      if (
        style &&
        /(auto|scroll|hidden|clip)/.test(
          `${style.overflow} ${style.overflowX} ${style.overflowY}`,
        )
      ) {
        const clip = node.getBoundingClientRect();
        left = Math.max(left, clip.left);
        top = Math.max(top, clip.top);
        right = Math.min(right, clip.right);
        bottom = Math.min(bottom, clip.bottom);
      }
    }
    return right > left && bottom > top;
  }

  private requestFrame(callback: FrameRequestCallback): number {
    return this.win.requestAnimationFrame
      ? this.win.requestAnimationFrame(callback)
      : this.win.setTimeout(callback, 16);
  }

  private cancelFrame(frame: number): void {
    if (this.win.cancelAnimationFrame) this.win.cancelAnimationFrame(frame);
    else this.win.clearTimeout(frame);
  }
}
