import {
  composeAffineTransforms,
  createViewportToDesktopTransform,
  frameViewportToParentTransform,
} from "../core/desktop-geometry.ts";
import type {
  AffineTransform,
  FrameGeometryLike,
  WindowGeometrySnapshot,
} from "../core/desktop-geometry.ts";
import { DesktopGeometryService } from "../core/desktop-geometry.ts";

type GeckoWindow = Window & {
  mozInnerScreenX?: number;
  mozInnerScreenY?: number;
};

export interface DesktopWindowGeometryCapture {
  viewportToDesktop: AffineTransform;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

function viewportDimensions(window: Window):
  | {
      width: number;
      height: number;
    }
  | undefined {
  const { innerWidth: width, innerHeight: height } = window;
  return Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? { width, height }
    : undefined;
}

/**
 * Captures a browsing context in Gecko desktop logical CSS pixels. Screen
 * backing-pixel conversion is deliberately separate and requires calibration.
 */
export function captureDesktopWindowGeometry(
  window: Window,
  maxFrameDepth = 16,
): DesktopWindowGeometryCapture | undefined {
  if (!Number.isInteger(maxFrameDepth) || maxFrameDepth < 0) return undefined;
  try {
    const top = window.top ?? window;
    const topDimensions = viewportDimensions(top);
    const geckoTop = top as GeckoWindow;
    const left = geckoTop.mozInnerScreenX;
    const topEdge = geckoTop.mozInnerScreenY;
    if (!topDimensions || !Number.isFinite(left) || !Number.isFinite(topEdge))
      return undefined;

    let transform = createViewportToDesktopTransform(topDimensions, {
      left: left!,
      top: topEdge!,
      width: topDimensions.width,
      height: topDimensions.height,
    });
    if (!transform) return undefined;

    let current = window;
    let depth = 0;
    while (current !== top) {
      if (++depth > maxFrameDepth) return undefined;
      const dimensions = viewportDimensions(current);
      const frame = current.frameElement as FrameGeometryLike | null;
      if (!dimensions || !frame) return undefined;
      const childToParent = frameViewportToParentTransform(frame, dimensions);
      if (!childToParent) return undefined;
      transform = composeAffineTransforms(transform, childToParent);
      const parent = current.parent;
      if (!parent) return undefined;
      current = parent;
    }

    const dimensions = viewportDimensions(window);
    if (!dimensions) return undefined;
    const dpr = window.devicePixelRatio;
    return {
      viewportToDesktop: transform,
      viewportWidth: dimensions.width,
      viewportHeight: dimensions.height,
      devicePixelRatio: Number.isFinite(dpr) && dpr > 0 ? dpr : 1,
    };
  } catch {
    return undefined;
  }
}

export function observeDesktopWindow(
  service: DesktopGeometryService,
  windowId: string,
  window: Window,
  observedAt = Date.now(),
): WindowGeometrySnapshot | undefined {
  const capture = captureDesktopWindowGeometry(window);
  return capture
    ? service.observeWindow(windowId, capture.viewportToDesktop, observedAt)
    : undefined;
}
