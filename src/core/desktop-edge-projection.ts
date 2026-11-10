import type { CardEdge } from "./linked-card-group.ts";
import {
  isFiniteRect,
  type DesktopPoint,
  type DesktopRect,
} from "./desktop-geometry.ts";

export interface RootLinkAnchorCandidate {
  occurrence: number;
  rect: DesktopRect;
  visible: boolean;
  contentGeneration: number;
}

export interface RootDesktopAnchor {
  visible: boolean;
  titleVisible: boolean;
  titleRect: DesktopRect;
  contentGeneration: number;
}

export interface DesktopCardHeaderAnchor {
  visible: boolean;
  headerRect: DesktopRect;
  windowRect?: DesktopRect;
  contentGeneration: number;
  windowGeneration: number;
}

export type DesktopEdgeEndpoint =
  | {
      kind: "root-link";
      path: string;
      occurrence: number;
      point: DesktopPoint;
      contentGeneration: number;
    }
  | {
      kind: "root-title";
      path: string;
      point: DesktopPoint;
      contentGeneration: number;
    }
  | {
      kind: "knowledge-card-side";
      path: string;
      side: "left" | "right";
      point: DesktopPoint;
      contentGeneration: number;
      windowGeneration: number;
    };

export interface ProjectedDesktopEdge {
  id: string;
  fromPath: string;
  toPath: string;
  from: DesktopEdgeEndpoint;
  to: DesktopEdgeEndpoint;
  relationGeneration: number;
  obstacles?: readonly { path: string; rect: DesktopRect }[];
}

export interface DesktopEdgeProjectionInput {
  edges: readonly CardEdge[];
  rootPaths: ReadonlySet<string>;
  roots: ReadonlyMap<string, RootDesktopAnchor>;
  rootLinks: ReadonlyMap<string, readonly RootLinkAnchorCandidate[]>;
  preferredRootOccurrences?: ReadonlyMap<string, number>;
  cards: ReadonlyMap<string, DesktopCardHeaderAnchor>;
  relationGeneration: number;
}

export function desktopEdgePairKey(from: string, to: string): string {
  return [from, to].sort().join("\0");
}

export function desktopRootLinkKey(
  rootPath: string,
  targetPath: string,
): string {
  return `${rootPath}\0${targetPath}`;
}

function center(rect: DesktopRect): DesktopPoint {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function cardSide(
  rect: DesktopRect,
  toward: DesktopRect,
  card: DesktopCardHeaderAnchor,
  path: string,
  tieBreakPath: string,
): DesktopEdgeEndpoint {
  const ownCenter = center(rect);
  const targetCenter = center(toward);
  const horizontalDelta = targetCenter.x - ownCenter.x;
  const side =
    Math.abs(horizontalDelta) > 1
      ? horizontalDelta > 0
        ? "right"
        : "left"
      : path.localeCompare(tieBreakPath) < 0
        ? "right"
        : "left";
  return {
    kind: "knowledge-card-side",
    path,
    side,
    point: {
      x: side === "right" ? rect.left + rect.width : rect.left,
      y: ownCenter.y,
    },
    contentGeneration: card.contentGeneration,
    windowGeneration: card.windowGeneration,
  };
}

function rootEndpoint(
  rootPath: string,
  targetPath: string,
  input: DesktopEdgeProjectionInput,
): DesktopEdgeEndpoint | undefined {
  const root = input.roots.get(rootPath);
  if (
    !root?.visible ||
    !isFiniteRect(root.titleRect) ||
    !Number.isInteger(root.contentGeneration)
  )
    return undefined;
  const key = desktopRootLinkKey(rootPath, targetPath);
  const candidates = input.rootLinks.get(key) ?? [];
  const preferred = input.preferredRootOccurrences?.get(key);
  const chosen =
    preferred === undefined
      ? [...candidates]
          .filter(
            (candidate) =>
              candidate.visible &&
              candidate.contentGeneration === root.contentGeneration &&
              isFiniteRect(candidate.rect),
          )
          .sort((left, right) => left.occurrence - right.occurrence)[0]
      : candidates.find(
          (candidate) =>
            candidate.occurrence === preferred &&
            candidate.visible &&
            candidate.contentGeneration === root.contentGeneration &&
            isFiniteRect(candidate.rect),
        );
  if (chosen) {
    const point = center(chosen.rect);
    return {
      kind: "root-link",
      path: rootPath,
      occurrence: chosen.occurrence,
      point,
      contentGeneration: chosen.contentGeneration,
    };
  }
  if (!root.titleVisible) return undefined;
  const titlePoint = center(root.titleRect);
  return {
    kind: "root-title",
    path: rootPath,
    point: titlePoint,
    contentGeneration: root.contentGeneration,
  };
}

/** Projects semantic edges onto exact desktop-space text/header anchors. */
export function projectDesktopEdges(
  input: DesktopEdgeProjectionInput,
): ProjectedDesktopEdge[] {
  const result: ProjectedDesktopEdge[] = [];
  const drawn = new Set<string>();
  for (const edge of input.edges) {
    const pair = desktopEdgePairKey(edge.from, edge.to);
    if (drawn.has(pair)) continue;
    const fromIsRoot = input.rootPaths.has(edge.from);
    const toIsRoot = input.rootPaths.has(edge.to);
    let from: DesktopEdgeEndpoint | undefined;
    let to: DesktopEdgeEndpoint | undefined;
    let obstacles: { path: string; rect: DesktopRect }[] | undefined;

    if (fromIsRoot !== toIsRoot) {
      const rootPath = fromIsRoot ? edge.from : edge.to;
      const cardPath = fromIsRoot ? edge.to : edge.from;
      const card = input.cards.get(cardPath);
      const rootAnchor = rootEndpoint(rootPath, cardPath, input);
      if (
        !card?.visible ||
        !isFiniteRect(card.headerRect) ||
        !Number.isInteger(card.contentGeneration) ||
        !Number.isInteger(card.windowGeneration) ||
        !rootAnchor
      )
        continue;
      const cardAnchor = cardSide(
        card.headerRect,
        {
          left: rootAnchor.point.x,
          top: rootAnchor.point.y,
          width: 0,
          height: 0,
        },
        card,
        cardPath,
        rootPath,
      );
      if (fromIsRoot) {
        from = rootAnchor;
        to = cardAnchor;
      } else {
        from = cardAnchor;
        to = rootAnchor;
      }
    } else {
      const source = input.cards.get(edge.from);
      const target = input.cards.get(edge.to);
      if (
        !source?.visible ||
        !target?.visible ||
        !isFiniteRect(source.headerRect) ||
        !isFiniteRect(target.headerRect) ||
        !Number.isInteger(source.contentGeneration) ||
        !Number.isInteger(target.contentGeneration) ||
        !Number.isInteger(source.windowGeneration) ||
        !Number.isInteger(target.windowGeneration)
      )
        continue;
      const otherVisibleCards = [...input.cards.entries()].filter(
        ([path, card]) =>
          path !== edge.from && path !== edge.to && card.visible,
      );
      if (
        otherVisibleCards.some(
          ([, card]) => !card.windowRect || !isFiniteRect(card.windowRect),
        )
      )
        continue;
      obstacles = otherVisibleCards.flatMap(([path, card]) =>
        card.windowRect ? [{ path, rect: { ...card.windowRect } }] : [],
      );
      from = cardSide(
        source.headerRect,
        target.headerRect,
        source,
        edge.from,
        edge.to,
      );
      to = cardSide(
        target.headerRect,
        source.headerRect,
        target,
        edge.to,
        edge.from,
      );
    }

    if (!from || !to) continue;
    drawn.add(pair);
    result.push({
      id: pair,
      fromPath: edge.from,
      toPath: edge.to,
      from,
      to,
      relationGeneration: input.relationGeneration,
      obstacles,
    });
  }
  return result;
}
