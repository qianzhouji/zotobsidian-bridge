import type { CardEdge } from "./linked-card-group.ts";

export interface KnowledgeCardSurfaceOptions {
  owner: HTMLElement;
  controlHost?: HTMLElement;
  collapseLabel: string;
  limitLabel: string;
  onCollapse(): void;
  onWindowClosed?(key: string): void;
  onCardLink?(
    key: string,
    target: string,
    sourcePath: string,
    occurrence: number,
  ): void;
  onExternalLink?(url: string): void;
}

/** Display-only operations consumed by the linked-note graph controller. */
export interface KnowledgeCardSurface {
  readonly cardCount: number;
  setAuthorizationScope?(scope: {
    vaultId: string;
    pairingEpoch: string;
  }): boolean | void;
  canAddCard(): boolean;
  addPanel(
    key: string,
    panel: HTMLElement,
    header: HTMLElement,
    resizeHandle: HTMLElement,
    anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  ): boolean;
  bindPath(path: string, key: string): boolean | void;
  whenMounted?(key: string): Promise<void>;
  unbindPath(path: string): void;
  setRootAnchor(sourcePath: string, anchor: HTMLElement | undefined): void;
  unbindRootAnchor(sourcePath: string): void;
  setEdges(edges: CardEdge[]): void;
  setEdgeAnchors(from: string, to: string, anchors: HTMLElement[]): void;
  focus(key: string): void;
  removePanel(key: string): void;
  clearPanels(): void;
  showLimit(anchor?: Pick<DOMRect, "left" | "right" | "top" | "bottom">): void;
  dispose(): void;
}

export type KnowledgeCardSurfaceFactory = (
  options: KnowledgeCardSurfaceOptions,
) => KnowledgeCardSurface;
