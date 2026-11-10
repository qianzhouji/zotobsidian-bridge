import { captureDesktopWindowGeometry } from "../adapters/desktop-geometry-host.ts";
import { mapRectThroughAffine } from "./desktop-geometry.ts";
import type { DesktopRect } from "./desktop-geometry.ts";

function clippedViewportRect(element: HTMLElement): DesktopRect | undefined {
  if (!element.isConnected) return undefined;
  const document = element.ownerDocument;
  const elementWindow = document?.defaultView;
  if (!elementWindow) return undefined;
  try {
    if (element.getClientRects().length === 0) return undefined;
    const visibility = elementWindow.getComputedStyle(element)?.visibility;
    if (visibility === "hidden" || visibility === "collapse") return undefined;
  } catch {
    return undefined;
  }
  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden || current.getAttribute("aria-hidden") === "true")
      return undefined;
    try {
      const style = elementWindow.getComputedStyle(current);
      if (!style) return undefined;
      if (style.display === "none" || style.opacity === "0") return undefined;
    } catch {
      return undefined;
    }
    current = current.parentElement as HTMLElement | null;
  }

  const bounds = element.getBoundingClientRect();
  let rect: DesktopRect = {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
  if (
    !Object.values(rect).every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    return undefined;

  const intersect = (clip: DesktopRect) => {
    const left = Math.max(rect.left, clip.left);
    const top = Math.max(rect.top, clip.top);
    const right = Math.min(rect.left + rect.width, clip.left + clip.width);
    const bottom = Math.min(rect.top + rect.height, clip.top + clip.height);
    rect = { left, top, width: right - left, height: bottom - top };
    return rect.width > 0 && rect.height > 0;
  };

  if (
    !intersect({
      left: 0,
      top: 0,
      width: elementWindow.innerWidth,
      height: elementWindow.innerHeight,
    })
  )
    return undefined;

  current = element.parentElement as HTMLElement | null;
  while (current) {
    try {
      const style = elementWindow.getComputedStyle(current);
      if (!style) return undefined;
      const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
      const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
      if (clipsX || clipsY) {
        const clipBounds = current.getBoundingClientRect();
        const clip = {
          left: clipsX ? clipBounds.left : rect.left,
          top: clipsY ? clipBounds.top : rect.top,
          width: clipsX ? clipBounds.width : rect.width,
          height: clipsY ? clipBounds.height : rect.height,
        };
        if (!intersect(clip)) return undefined;
      }
    } catch {
      return undefined;
    }
    current = current.parentElement as HTMLElement | null;
  }
  return rect;
}

/** Maps only currently visible, unclipped DOM anchors into desktop CSS pixels. */
export function desktopRectForElement(
  element: HTMLElement,
): DesktopRect | undefined {
  const viewportRect = clippedViewportRect(element);
  const window = element.ownerDocument?.defaultView;
  if (!viewportRect || !window) return undefined;
  const geometry = captureDesktopWindowGeometry(window);
  return geometry
    ? mapRectThroughAffine(viewportRect, geometry.viewportToDesktop)
    : undefined;
}
