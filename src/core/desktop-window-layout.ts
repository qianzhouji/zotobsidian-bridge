export interface DesktopWindowRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type DesktopScreenArea = DesktopWindowRect;

export interface DesktopWindowLayoutLimits {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function fitWindowRectToScreen(
  rect: DesktopWindowRect,
  area: DesktopScreenArea,
  limits: DesktopWindowLayoutLimits = {},
): DesktopWindowRect {
  const screenWidth = finitePositive(area.width, 1);
  const screenHeight = finitePositive(area.height, 1);
  const minWidth = Math.min(limits.minWidth ?? 320, screenWidth);
  const minHeight = Math.min(limits.minHeight ?? 240, screenHeight);
  const width = Math.min(
    screenWidth,
    Math.max(minWidth, finitePositive(rect.width, minWidth)),
  );
  const height = Math.min(
    screenHeight,
    Math.max(minHeight, finitePositive(rect.height, minHeight)),
  );
  const left = Number.isFinite(rect.left) ? rect.left : area.left;
  const top = Number.isFinite(rect.top) ? rect.top : area.top;
  return {
    left: Math.min(area.left + screenWidth - width, Math.max(area.left, left)),
    top: Math.min(area.top + screenHeight - height, Math.max(area.top, top)),
    width,
    height,
  };
}
