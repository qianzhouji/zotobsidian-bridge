export const LINKED_CARD_GROUP_LIMIT = 8;
export const LINKED_CARD_WINDOW_LIMIT = 16;
export const LINKED_CARD_GUTTER = 8;
export const LINKED_CARD_MIN_WIDTH = 260;
export const LINKED_CARD_MIN_HEIGHT = 180;
export const LINKED_CARD_START_WIDTH = 360;
export const LINKED_CARD_START_HEIGHT = 300;

export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CardViewport {
  width: number;
  height: number;
}

export interface CardEdge {
  from: string;
  to: string;
}

export interface CardLinkResult {
  nodeAdded: boolean;
  edgeAdded: boolean;
  atLimit: boolean;
}

/** Directed links are retained in the model; the view may draw a double arrow. */
export class LinkedCardGraph {
  private nodes = new Set<string>();
  private edges = new Map<string, CardEdge>();
  readonly maxNodes: number;

  constructor(maxNodes = LINKED_CARD_GROUP_LIMIT) {
    this.maxNodes = maxNodes;
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }

  has(path: string): boolean {
    return this.nodes.has(path);
  }

  nodePaths(): string[] {
    return [...this.nodes];
  }

  relations(): CardEdge[] {
    return [...this.edges.values()];
  }

  reachableFrom(roots: Iterable<string>): Set<string> {
    const reachable = new Set<string>();
    const queue: string[] = [];
    const rootSet = new Set(roots);
    for (const edge of this.edges.values()) {
      if (
        rootSet.has(edge.from) &&
        this.nodes.has(edge.to) &&
        !reachable.has(edge.to)
      ) {
        reachable.add(edge.to);
        queue.push(edge.to);
      }
    }
    while (queue.length) {
      const path = queue.shift()!;
      for (const edge of this.edges.values()) {
        if (
          edge.from !== path ||
          !this.nodes.has(edge.to) ||
          reachable.has(edge.to)
        )
          continue;
        reachable.add(edge.to);
        queue.push(edge.to);
      }
    }
    return reachable;
  }

  link(from: string, to: string): CardLinkResult {
    const nodeAdded = !this.nodes.has(to);
    if (nodeAdded && this.nodes.size >= this.maxNodes)
      return { nodeAdded: false, edgeAdded: false, atLimit: true };
    this.nodes.add(to);
    const key = `${from}\0${to}`;
    const edgeAdded = !this.edges.has(key);
    if (edgeAdded) this.edges.set(key, { from, to });
    return { nodeAdded, edgeAdded, atLimit: false };
  }

  remove(path: string): void {
    this.nodes.delete(path);
    for (const [key, edge] of this.edges)
      if (edge.from === path || edge.to === path) this.edges.delete(key);
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
  }
}

export function clampCardRect(
  rect: CardRect,
  viewport: CardViewport,
  gutter = LINKED_CARD_GUTTER,
): CardRect {
  const maxWidth = Math.max(1, viewport.width - gutter * 2);
  const maxHeight = Math.max(1, viewport.height - gutter * 2);
  const width = clamp(
    rect.width,
    Math.min(LINKED_CARD_MIN_WIDTH, maxWidth),
    maxWidth,
  );
  const height = clamp(
    rect.height,
    Math.min(LINKED_CARD_MIN_HEIGHT, maxHeight),
    maxHeight,
  );
  return {
    x: clamp(rect.x, gutter, Math.max(gutter, viewport.width - gutter - width)),
    y: clamp(
      rect.y,
      gutter,
      Math.max(gutter, viewport.height - gutter - height),
    ),
    width,
    height,
  };
}

export function initialCardRect(
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  viewport: CardViewport,
  ordinal = 0,
): CardRect {
  const maxWidth = Math.max(1, viewport.width - LINKED_CARD_GUTTER * 2);
  const maxHeight = Math.max(1, viewport.height - LINKED_CARD_GUTTER * 2);
  const width = Math.min(LINKED_CARD_START_WIDTH, maxWidth);
  const height = Math.min(LINKED_CARD_START_HEIGHT, maxHeight);
  const gap = 16;
  const offset = Math.min(ordinal, 4) * 22;
  const right = anchor.right + gap;
  const left = anchor.left - gap - width;
  const x =
    right + width <= viewport.width - LINKED_CARD_GUTTER
      ? right
      : left >= LINKED_CARD_GUTTER
        ? left
        : anchor.left + 20;
  return clampCardRect(
    { x: x + offset, y: anchor.top + offset, width, height },
    viewport,
  );
}

export function moveCardRect(
  start: CardRect,
  deltaX: number,
  deltaY: number,
  viewport: CardViewport,
): CardRect {
  return clampCardRect(
    { ...start, x: start.x + deltaX, y: start.y + deltaY },
    viewport,
  );
}

export function resizeCardRect(
  start: CardRect,
  deltaX: number,
  deltaY: number,
  viewport: CardViewport,
): CardRect {
  return clampCardRect(
    { ...start, width: start.width + deltaX, height: start.height + deltaY },
    viewport,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
