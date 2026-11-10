export interface DesktopPoint {
  x: number;
  y: number;
}

export type ViewportCssPoint = DesktopPoint;
export type DesktopLogicalPoint = DesktopPoint;
export type ScreenBackingPoint = DesktopPoint;

/** Gecko desktop logical CSS pixels; negative display origins are valid. */
export interface DesktopRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** x' = a*x + c*y + e; y' = b*x + d*y + f. */
export interface AffineTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface DesktopQuad {
  p1: DesktopPoint;
  p2: DesktopPoint;
  p3: DesktopPoint;
  p4: DesktopPoint;
}

export interface DesktopDisplayCalibration {
  displayId: string;
  topologyGeneration: number;
  logicalRect: DesktopRect;
  backingOrigin: ScreenBackingPoint;
  backingScaleX: number;
  backingScaleY: number;
}

export interface FrameGeometryLike {
  getBoundingClientRect(): Pick<DOMRect, "left" | "top" | "width" | "height">;
  getBoxQuads?(options?: { box?: "content" }): ArrayLike<DesktopQuad>;
  offsetWidth: number;
  offsetHeight: number;
  clientWidth: number;
  clientHeight: number;
  clientLeft: number;
  clientTop: number;
}

export function isFiniteRect(rect: DesktopRect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function transformPoint(
  transform: AffineTransform,
  point: DesktopPoint,
): DesktopPoint {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.e,
    y: transform.b * point.x + transform.d * point.y + transform.f,
  };
}

/** Returns outer(inner(point)). */
export function composeAffineTransforms(
  outer: AffineTransform,
  inner: AffineTransform,
): AffineTransform {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function invertAffineTransform(
  transform: AffineTransform,
): AffineTransform | undefined {
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9)
    return undefined;
  const inverse = 1 / determinant;
  const a = transform.d * inverse;
  const b = -transform.b * inverse;
  const c = -transform.c * inverse;
  const d = transform.a * inverse;
  return {
    a,
    b,
    c,
    d,
    e: -(a * transform.e + c * transform.f),
    f: -(b * transform.e + d * transform.f),
  };
}

export function isUsableAffineTransform(transform: AffineTransform): boolean {
  return (
    Object.values(transform).every(Number.isFinite) &&
    Math.abs(transform.a * transform.d - transform.b * transform.c) >= 1e-9
  );
}

export function mapRectThroughAffine(
  rect: DesktopRect,
  transform: AffineTransform,
): DesktopRect | undefined {
  if (!isFiniteRect(rect) || !isUsableAffineTransform(transform))
    return undefined;
  const points = [
    transformPoint(transform, { x: rect.left, y: rect.top }),
    transformPoint(transform, { x: rect.left + rect.width, y: rect.top }),
    transformPoint(transform, {
      x: rect.left + rect.width,
      y: rect.top + rect.height,
    }),
    transformPoint(transform, { x: rect.left, y: rect.top + rect.height }),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return isFiniteRect({ left, top, width: right - left, height: bottom - top })
    ? { left, top, width: right - left, height: bottom - top }
    : undefined;
}

export function createViewportToDesktopTransform(
  viewport: { width: number; height: number },
  desktopContentRect: DesktopRect,
): AffineTransform | undefined {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    !isFiniteRect(desktopContentRect)
  )
    return undefined;
  return {
    a: desktopContentRect.width / viewport.width,
    b: 0,
    c: 0,
    d: desktopContentRect.height / viewport.height,
    e: desktopContentRect.left,
    f: desktopContentRect.top,
  };
}

export function desktopLogicalToBacking(
  point: DesktopLogicalPoint,
  calibration: DesktopDisplayCalibration,
  topologyGeneration: number,
): ScreenBackingPoint | undefined {
  const rect = calibration.logicalRect;
  if (
    !calibration.displayId ||
    calibration.topologyGeneration !== topologyGeneration ||
    !isFiniteRect(rect) ||
    !Number.isFinite(calibration.backingOrigin.x) ||
    !Number.isFinite(calibration.backingOrigin.y) ||
    !Number.isFinite(calibration.backingScaleX) ||
    !Number.isFinite(calibration.backingScaleY) ||
    calibration.backingScaleX <= 0 ||
    calibration.backingScaleY <= 0 ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < rect.left ||
    point.y < rect.top ||
    point.x > rect.left + rect.width ||
    point.y > rect.top + rect.height
  )
    return undefined;
  return {
    x:
      calibration.backingOrigin.x +
      (point.x - rect.left) * calibration.backingScaleX,
    y:
      calibration.backingOrigin.y +
      (point.y - rect.top) * calibration.backingScaleY,
  };
}

export function screenBackingToDesktopLogical(
  point: ScreenBackingPoint,
  calibration: DesktopDisplayCalibration,
  topologyGeneration: number,
): DesktopLogicalPoint | undefined {
  const rect = calibration.logicalRect;
  if (
    !calibration.displayId ||
    calibration.topologyGeneration !== topologyGeneration ||
    !isFiniteRect(rect) ||
    !Number.isFinite(calibration.backingOrigin.x) ||
    !Number.isFinite(calibration.backingOrigin.y) ||
    !Number.isFinite(calibration.backingScaleX) ||
    !Number.isFinite(calibration.backingScaleY) ||
    calibration.backingScaleX <= 0 ||
    calibration.backingScaleY <= 0 ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  )
    return undefined;
  const logical = {
    x:
      rect.left +
      (point.x - calibration.backingOrigin.x) / calibration.backingScaleX,
    y:
      rect.top +
      (point.y - calibration.backingOrigin.y) / calibration.backingScaleY,
  };
  return logical.x < rect.left ||
    logical.y < rect.top ||
    logical.x > rect.left + rect.width ||
    logical.y > rect.top + rect.height
    ? undefined
    : logical;
}

/**
 * Maps a child browsing-context viewport into its parent viewport. Content-box
 * quads preserve scale, rotation, and skew; perspective quads are rejected.
 */
export function frameViewportToParentTransform(
  frame: FrameGeometryLike,
  childViewport: { width: number; height: number },
  tolerance = 0.75,
): AffineTransform | undefined {
  if (
    !Number.isFinite(childViewport.width) ||
    !Number.isFinite(childViewport.height) ||
    childViewport.width <= 0 ||
    childViewport.height <= 0
  )
    return undefined;

  const quad = frame.getBoxQuads?.({ box: "content" })?.[0];
  if (quad) {
    const expectedP3 = {
      x: quad.p2.x + quad.p4.x - quad.p1.x,
      y: quad.p2.y + quad.p4.y - quad.p1.y,
    };
    if (
      Math.hypot(expectedP3.x - quad.p3.x, expectedP3.y - quad.p3.y) > tolerance
    )
      return undefined;
    const transform: AffineTransform = {
      a: (quad.p2.x - quad.p1.x) / childViewport.width,
      b: (quad.p2.y - quad.p1.y) / childViewport.width,
      c: (quad.p4.x - quad.p1.x) / childViewport.height,
      d: (quad.p4.y - quad.p1.y) / childViewport.height,
      e: quad.p1.x,
      f: quad.p1.y,
    };
    return isUsableAffineTransform(transform) ? transform : undefined;
  }

  if (
    frame.offsetWidth <= 0 ||
    frame.offsetHeight <= 0 ||
    frame.clientWidth <= 0 ||
    frame.clientHeight <= 0
  )
    return undefined;
  const rect = frame.getBoundingClientRect();
  const scaleX = rect.width / frame.offsetWidth;
  const scaleY = rect.height / frame.offsetHeight;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return undefined;
  const transform: AffineTransform = {
    a: (frame.clientWidth * scaleX) / childViewport.width,
    b: 0,
    c: 0,
    d: (frame.clientHeight * scaleY) / childViewport.height,
    e: rect.left + frame.clientLeft * scaleX,
    f: rect.top + frame.clientTop * scaleY,
  };
  return isUsableAffineTransform(transform) ? transform : undefined;
}

export interface WindowGeometrySnapshot {
  windowId: string;
  topologyGeneration: number;
  observedAt: number;
  viewportToDesktop: AffineTransform;
}

/** Stores only current-generation transforms; no timer treats a quiet window as stale. */
export class DesktopGeometryService {
  private generation = 1;
  private readonly windows = new Map<string, WindowGeometrySnapshot>();

  get topologyGeneration(): number {
    return this.generation;
  }

  invalidateTopology(): number {
    this.generation++;
    this.windows.clear();
    return this.generation;
  }

  observeWindow(
    windowId: string,
    viewportToDesktop: AffineTransform,
    observedAt = Date.now(),
  ): WindowGeometrySnapshot | undefined {
    if (
      !windowId ||
      !Number.isFinite(observedAt) ||
      !isUsableAffineTransform(viewportToDesktop)
    )
      return undefined;
    const snapshot: WindowGeometrySnapshot = {
      windowId,
      topologyGeneration: this.generation,
      observedAt,
      viewportToDesktop: { ...viewportToDesktop },
    };
    this.windows.set(windowId, snapshot);
    return {
      ...snapshot,
      viewportToDesktop: { ...snapshot.viewportToDesktop },
    };
  }

  snapshot(windowId: string): WindowGeometrySnapshot | undefined {
    const snapshot = this.windows.get(windowId);
    if (!snapshot || snapshot.topologyGeneration !== this.generation)
      return undefined;
    return {
      ...snapshot,
      viewportToDesktop: { ...snapshot.viewportToDesktop },
    };
  }

  mapWindowRect(windowId: string, rect: DesktopRect): DesktopRect | undefined {
    const snapshot = this.snapshot(windowId);
    return snapshot
      ? mapRectThroughAffine(rect, snapshot.viewportToDesktop)
      : undefined;
  }
}
