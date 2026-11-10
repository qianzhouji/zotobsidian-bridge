import type { DesktopPoint, DesktopRect } from "../core/desktop-geometry.ts";
import { isFiniteRect } from "../core/desktop-geometry.ts";

export interface DesktopOverlayDisplay {
  id: string;
  rect: DesktopRect;
}

export interface DesktopEdgeCurve {
  id: string;
  from: DesktopPoint;
  control1: DesktopPoint;
  control2: DesktopPoint;
  to: DesktopPoint;
  routeStatus?: "direct" | "detour" | "blocked";
  blockedBy?: readonly string[];
}

export interface DesktopOverlayCurve extends DesktopEdgeCurve {
  groupId: string;
  startArrow: boolean;
  endArrow: boolean;
}

export interface DesktopOverlaySurface {
  /** Coordinates are global Gecko desktop CSS pixels; clip to display.rect. */
  draw(
    display: DesktopOverlayDisplay,
    curves: readonly DesktopOverlayCurve[],
  ): void;
  show(): void;
  hide(): void;
  close(): void;
}

export interface DesktopEdgeOverlayHost {
  readonly capabilities: {
    verified: boolean;
    transparent: boolean;
    nonActivating: boolean;
    controlledZOrder: boolean;
    systemMousePassthrough: boolean;
    tracksNativeDrag: boolean;
  };
  open(display: DesktopOverlayDisplay): DesktopOverlaySurface;
}

export type DesktopOverlayUpdateResult =
  | "visible"
  | "empty"
  | "blocked"
  | "invalid-geometry"
  | "host-failure";

function hasRequiredCapabilities(host: DesktopEdgeOverlayHost): boolean {
  return Object.values(host.capabilities).every((value) => value === true);
}

const MAX_OVERLAY_GROUPS = 32;
const MAX_TOTAL_CURVES = 512;
const MAX_BLOCKED_PATHS = 16;

function isFinitePoint(point: DesktopPoint): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Math.abs(point.x) <= 10_000_000 &&
    Math.abs(point.y) <= 10_000_000
  );
}

export function isValidDesktopOverlayDisplay(
  display: DesktopOverlayDisplay,
): boolean {
  const rect = display.rect;
  return (
    !!display.id &&
    display.id.length <= 512 &&
    isFiniteRect(rect) &&
    Math.abs(rect.left) <= 10_000_000 &&
    Math.abs(rect.top) <= 10_000_000 &&
    rect.width <= 32_768 &&
    rect.height <= 32_768 &&
    Math.abs(rect.left + rect.width) <= 10_000_000 &&
    Math.abs(rect.top + rect.height) <= 10_000_000
  );
}

export function isValidDesktopOverlayCurve(curve: DesktopEdgeCurve): boolean {
  const validStatus =
    curve.routeStatus === undefined ||
    curve.routeStatus === "direct" ||
    curve.routeStatus === "detour" ||
    curve.routeStatus === "blocked";
  const validBlockedBy =
    curve.blockedBy === undefined ||
    (Array.isArray(curve.blockedBy) &&
      curve.blockedBy.length <= MAX_BLOCKED_PATHS &&
      curve.blockedBy.every(
        (path) => typeof path === "string" && path.length <= 512,
      ));
  return (
    !!curve.id &&
    curve.id.length <= 512 &&
    validStatus &&
    validBlockedBy &&
    isFinitePoint(curve.from) &&
    isFinitePoint(curve.control1) &&
    isFinitePoint(curve.control2) &&
    isFinitePoint(curve.to)
  );
}

function curveTouchesDisplay(
  curve: DesktopEdgeCurve,
  display: DesktopOverlayDisplay,
): boolean {
  const points = [curve.from, curve.control1, curve.control2, curve.to];
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  const rect = display.rect;
  if (
    right < rect.left ||
    left > rect.left + rect.width ||
    bottom < rect.top ||
    top > rect.top + rect.height
  )
    return false;
  for (let step = 0; step <= 48; step++) {
    const t = step / 48;
    const inverse = 1 - t;
    const point = {
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
    if (containsPoint(display, point)) return true;
  }
  return false;
}

function containsPoint(
  display: DesktopOverlayDisplay,
  point: DesktopPoint,
): boolean {
  return (
    point.x >= display.rect.left &&
    point.x <= display.rect.left + display.rect.width &&
    point.y >= display.rect.top &&
    point.y <= display.rect.top + display.rect.height
  );
}

function endpointDisplayId(
  point: DesktopPoint,
  displays: readonly DesktopOverlayDisplay[],
): string | undefined {
  return displays
    .filter((display) => containsPoint(display, point))
    .sort(
      (left, right) =>
        left.rect.top - right.rect.top ||
        left.rect.left - right.rect.left ||
        left.id.localeCompare(right.id),
    )[0]?.id;
}

/** Owns at most one fail-closed overlay window per display and group. */
export class DesktopEdgeOverlayManager {
  private readonly host: DesktopEdgeOverlayHost;
  private readonly surfaces = new Map<string, DesktopOverlaySurface>();
  private readonly groups = new Map<
    string,
    {
      curves: readonly DesktopEdgeCurve[];
      displays: readonly DesktopOverlayDisplay[];
      visible: boolean;
    }
  >();
  private disposed = false;

  constructor(host: DesktopEdgeOverlayHost) {
    this.host = host;
  }

  setGroup(
    groupId: string,
    curves: readonly DesktopEdgeCurve[],
    displays: readonly DesktopOverlayDisplay[],
  ): DesktopOverlayUpdateResult {
    if (this.disposed) return "blocked";
    if (!hasRequiredCapabilities(this.host)) {
      this.failClosed();
      return "blocked";
    }
    if (
      !groupId ||
      groupId.length > 512 ||
      curves.length > 256 ||
      displays.length > 16 ||
      (curves.length > 0 &&
        !this.groups.has(groupId) &&
        this.groups.size >= MAX_OVERLAY_GROUPS) ||
      [...this.groups.entries()]
        .filter(([existingId]) => existingId !== groupId)
        .reduce(
          (total, [, group]) => total + group.curves.length,
          curves.length,
        ) > MAX_TOTAL_CURVES ||
      new Set(displays.map((display) => display.id)).size !== displays.length ||
      displays.some((display) => !isValidDesktopOverlayDisplay(display)) ||
      curves.some((curve) => !isValidDesktopOverlayCurve(curve))
    ) {
      this.failClosed();
      return "invalid-geometry";
    }
    if (curves.length)
      this.groups.set(groupId, {
        curves: curves.map((curve) => ({ ...curve })),
        displays: displays.map((display) => ({
          id: display.id,
          rect: { ...display.rect },
        })),
        visible: this.groups.get(groupId)?.visible ?? true,
      });
    else this.groups.delete(groupId);
    return this.render();
  }

  removeGroup(groupId: string): DesktopOverlayUpdateResult {
    if (this.disposed) return "blocked";
    this.groups.delete(groupId);
    return this.render();
  }

  setGroupVisible(
    groupId: string,
    visible: boolean,
  ): DesktopOverlayUpdateResult {
    if (this.disposed) return "blocked";
    const group = this.groups.get(groupId);
    if (!group) return "empty";
    group.visible = visible;
    return this.render();
  }

  topologyChanged(
    displays: readonly DesktopOverlayDisplay[],
  ): DesktopOverlayUpdateResult {
    if (this.disposed) return "blocked";
    if (
      displays.length > 16 ||
      new Set(displays.map((display) => display.id)).size !== displays.length ||
      displays.some((display) => !isValidDesktopOverlayDisplay(display))
    ) {
      this.failClosed();
      return "invalid-geometry";
    }
    this.closeAllSurfaces();
    for (const group of this.groups.values())
      group.displays = displays.map((display) => ({
        id: display.id,
        rect: { ...display.rect },
      }));
    return this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.groups.clear();
    this.closeAllSurfaces();
  }

  private render(): DesktopOverlayUpdateResult {
    if (!hasRequiredCapabilities(this.host)) {
      this.failClosed();
      return "blocked";
    }
    if (![...this.groups.values()].some((group) => group.visible)) {
      this.closeAllSurfaces();
      return "empty";
    }
    const next = new Map<string, DesktopOverlayCurve[]>();
    const displays = new Map<string, DesktopOverlayDisplay>();
    const visibleGroups = [...this.groups.entries()].filter(
      ([, group]) => group.visible,
    );
    for (const [, group] of visibleGroups)
      for (const display of group.displays) displays.set(display.id, display);
    const allCurves = visibleGroups.flatMap(([groupId, group]) =>
      group.curves.map((curve) => ({ groupId, curve })),
    );
    const startArrowDisplay = new Map<string, string | undefined>();
    const endArrowDisplay = new Map<string, string | undefined>();
    for (const { groupId, curve } of allCurves) {
      const group = this.groups.get(groupId)!;
      startArrowDisplay.set(
        `${groupId}\0${curve.id}`,
        endpointDisplayId(curve.from, group.displays),
      );
      endArrowDisplay.set(
        `${groupId}\0${curve.id}`,
        endpointDisplayId(curve.to, group.displays),
      );
    }
    for (const display of displays.values()) {
      const curves: DesktopOverlayCurve[] = [];
      for (const { groupId, curve } of allCurves) {
        const group = this.groups.get(groupId)!;
        if (!group.displays.some((candidate) => candidate.id === display.id))
          continue;
        if (curveTouchesDisplay(curve, display))
          curves.push({
            ...curve,
            groupId,
            startArrow:
              startArrowDisplay.get(`${groupId}\0${curve.id}`) === display.id,
            endArrow:
              endArrowDisplay.get(`${groupId}\0${curve.id}`) === display.id,
          });
      }
      if (curves.length) next.set(display.id, curves);
    }
    if (!next.size) {
      this.closeAllSurfaces();
      return "empty";
    }
    try {
      const visible: DesktopOverlaySurface[] = [];
      for (const [displayId, curves] of next) {
        const display = displays.get(displayId);
        if (!display) throw new Error("The display geometry disappeared.");
        let surface = this.surfaces.get(displayId);
        if (!surface) {
          surface = this.host.open(display);
          this.surfaces.set(displayId, surface);
        }
        surface.draw(display, curves);
        visible.push(surface);
      }
      for (const surface of visible) surface.show();
      for (const [displayId, surface] of [...this.surfaces])
        if (!next.has(displayId)) this.closeSurface(displayId, surface);
      return "visible";
    } catch {
      this.failClosed();
      return "host-failure";
    }
  }

  private failClosed(): void {
    this.groups.clear();
    this.closeAllSurfaces();
  }

  private closeAllSurfaces(): void {
    for (const [displayId, surface] of [...this.surfaces])
      this.closeSurface(displayId, surface);
  }

  private closeSurface(
    displayId: string,
    surface: DesktopOverlaySurface,
  ): void {
    this.surfaces.delete(displayId);
    try {
      surface.hide();
    } catch {
      // Still attempt close if hide failed during teardown.
    }
    try {
      surface.close();
    } catch {
      // Keep manager ownership clear even if the host has already closed it.
    }
  }
}
