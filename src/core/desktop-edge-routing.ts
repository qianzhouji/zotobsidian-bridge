import type { DesktopEdgeCurve } from "../adapters/desktop-edge-overlay.ts";
import type { DesktopRect } from "./desktop-geometry.ts";
import { isFiniteRect } from "./desktop-geometry.ts";
import type { ProjectedDesktopEdge } from "./desktop-edge-projection.ts";

interface RoutingObstacle {
  path: string;
  rect: DesktopRect;
}

const ROUTE_CLEARANCE = 20;
const ROUTE_SAMPLES = 64;

function direction(delta: number, fromPath: string, toPath: string): number {
  if (Math.abs(delta) > 1) return Math.sign(delta);
  return fromPath.localeCompare(toPath) <= 0 ? 1 : -1;
}

function tangentDistance(delta: number): number {
  return Math.max(48, Math.min(200, Math.abs(delta) * 0.38));
}

function endpointDirection(
  edge: ProjectedDesktopEdge,
  endpoint: "from" | "to",
  fallback: number,
): number {
  const value = edge[endpoint];
  if (value.kind !== "knowledge-card-side") return fallback;
  return value.side === "right" ? 1 : -1;
}

function makeCurve(
  edge: ProjectedDesktopEdge,
  laneY?: number,
): DesktopEdgeCurve {
  const dx = edge.to.point.x - edge.from.point.x;
  const dy = edge.to.point.y - edge.from.point.y;
  const sign = direction(dx, edge.fromPath, edge.toPath);
  const distance = tangentDistance(dx || dy);
  const fromDirection = endpointDirection(edge, "from", sign);
  const toDirection = endpointDirection(edge, "to", -sign);
  const verticalBend = Math.min(120, Math.abs(dy) * 0.18);
  return {
    id: edge.id,
    from: edge.from.point,
    control1: {
      x: edge.from.point.x + fromDirection * distance,
      y: laneY ?? edge.from.point.y + Math.sign(dy) * verticalBend,
    },
    control2: {
      x: edge.to.point.x + toDirection * distance,
      y: laneY ?? edge.to.point.y - Math.sign(dy) * verticalBend,
    },
    to: edge.to.point,
  };
}

function pointOnCurve(curve: DesktopEdgeCurve, t: number) {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * curve.from.x +
      3 * inverse ** 2 * t * curve.control1.x +
      3 * inverse * t ** 2 * curve.control2.x +
      t ** 3 * curve.to.x,
    y:
      inverse ** 3 * curve.from.y +
      3 * inverse ** 2 * t * curve.control1.y +
      3 * inverse * t ** 2 * curve.control2.y +
      t ** 3 * curve.to.y,
  };
}

function intersectsObstacle(
  curve: DesktopEdgeCurve,
  obstacle: RoutingObstacle,
  clearance: number,
): boolean {
  const rect = obstacle.rect;
  const left = rect.left - clearance;
  const right = rect.left + rect.width + clearance;
  const top = rect.top - clearance;
  const bottom = rect.top + rect.height + clearance;
  const controls = [curve.from, curve.control1, curve.control2, curve.to];
  const curveLeft = Math.min(...controls.map((point) => point.x));
  const curveRight = Math.max(...controls.map((point) => point.x));
  const curveTop = Math.min(...controls.map((point) => point.y));
  const curveBottom = Math.max(...controls.map((point) => point.y));
  if (
    curveRight < left ||
    curveLeft > right ||
    curveBottom < top ||
    curveTop > bottom
  )
    return false;
  for (let index = 1; index < ROUTE_SAMPLES; index++) {
    const point = pointOnCurve(curve, index / ROUTE_SAMPLES);
    if (
      point.x >= left &&
      point.x <= right &&
      point.y >= top &&
      point.y <= bottom
    )
      return true;
  }
  return false;
}

function curveCost(curve: DesktopEdgeCurve): number {
  let length = 0;
  let previous = curve.from;
  for (let index = 1; index <= 16; index++) {
    const point = pointOnCurve(curve, index / 16);
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}

function candidateLanes(
  edge: ProjectedDesktopEdge,
  obstacles: readonly RoutingObstacle[],
  clearance: number,
): number[] {
  const margin =
    clearance + Math.abs(edge.to.point.y - edge.from.point.y) * 0.5;
  const ys = [edge.from.point.y, edge.to.point.y];
  for (const obstacle of obstacles) {
    ys.push(obstacle.rect.top, obstacle.rect.top + obstacle.rect.height);
  }
  const values = [
    Math.min(...ys) - margin,
    Math.max(...ys) + margin,
    ...obstacles.flatMap((obstacle) => [
      obstacle.rect.top - margin,
      obstacle.rect.top + obstacle.rect.height + margin,
    ]),
  ];
  return [...new Set(values.filter(Number.isFinite))];
}

/**
 * Produces a deterministic side-to-side cubic. Card-to-card links keep their
 * side anchors; when a third window blocks the direct route, a bounded set of
 * exterior lanes is tested before returning a marked partial route.
 */
export function routeDesktopEdge(
  edge: ProjectedDesktopEdge,
  options: { clearance?: number } = {},
): DesktopEdgeCurve {
  const direct = makeCurve(edge);
  direct.routeStatus = "direct";
  if (
    edge.from.kind !== "knowledge-card-side" ||
    edge.to.kind !== "knowledge-card-side"
  )
    return direct;

  const clearance = Math.max(
    8,
    Math.min(64, options.clearance ?? ROUTE_CLEARANCE),
  );
  const obstacles = (edge.obstacles ?? []).filter(
    (obstacle) =>
      obstacle.path !== edge.fromPath &&
      obstacle.path !== edge.toPath &&
      isFiniteRect(obstacle.rect),
  );
  if (!obstacles.length) return direct;

  const blockers = (curve: DesktopEdgeCurve) =>
    obstacles.filter((obstacle) =>
      intersectsObstacle(curve, obstacle, clearance),
    );
  const directBlockers = blockers(direct);
  if (!directBlockers.length) return direct;

  const candidates = candidateLanes(edge, obstacles, clearance)
    .map((laneY) => {
      const curve = makeCurve(edge, laneY);
      const blockedBy = blockers(curve);
      return { curve, blockedBy, cost: curveCost(curve) };
    })
    .filter((candidate) => candidate.blockedBy.length === 0)
    .sort((left, right) => left.cost - right.cost);
  const detour = candidates[0];
  if (detour) {
    detour.curve.routeStatus = "detour";
    return detour.curve;
  }

  direct.routeStatus = "blocked";
  direct.blockedBy = directBlockers.map((obstacle) => obstacle.path);
  return direct;
}
