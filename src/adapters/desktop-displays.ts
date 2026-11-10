import type {
  DesktopEdgeCurve,
  DesktopOverlayDisplay,
} from "./desktop-edge-overlay.ts";
import type { DesktopRect } from "../core/desktop-geometry.ts";

interface ScreenOut {
  value?: number;
}

function rectForPoint(x: number, y: number): DesktopRect | undefined {
  try {
    const screen = Cc["@mozilla.org/gfx/screenmanager;1"]
      .getService(Ci.nsIScreenManager)
      .screenForRect(Math.floor(x), Math.floor(y), 1, 1);
    const left: ScreenOut = {};
    const top: ScreenOut = {};
    const width: ScreenOut = {};
    const height: ScreenOut = {};
    // GetRect returns screen-specific device pixels. GetRectDisplayPix applies
    // this screen's scale and Gecko's desktop origin convention, which the
    // helper maps to NSScreen.frame coordinates.
    screen.GetRectDisplayPix(left, top, width, height);
    const rect = {
      left: left.value,
      top: top.value,
      width: width.value,
      height: height.value,
    };
    if (
      !Number.isFinite(rect.left) ||
      !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.width! <= 0 ||
      rect.height! <= 0
    )
      return undefined;
    return rect as DesktopRect;
  } catch {
    return undefined;
  }
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

function displayID(rect: DesktopRect): string {
  return `screen:${rect.left},${rect.top},${rect.width},${rect.height}`;
}

/** Finds the displays touched by the actual cubic paths, without guessing DPR. */
export function desktopDisplaysForCurves(
  curves: readonly DesktopEdgeCurve[],
  stepsPerCurve = 96,
): DesktopOverlayDisplay[] {
  if (!Number.isInteger(stepsPerCurve) || stepsPerCurve < 1) return [];
  const displays = new Map<string, DesktopOverlayDisplay>();
  for (const curve of curves) {
    for (let step = 0; step <= stepsPerCurve; step++) {
      const point = pointOnCurve(curve, step / stepsPerCurve);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const rect = rectForPoint(point.x, point.y);
      if (!rect) continue;
      const id = displayID(rect);
      displays.set(id, { id, rect });
    }
  }
  return [...displays.values()].sort(
    (left, right) =>
      left.rect.top - right.rect.top || left.rect.left - right.rect.left,
  );
}
