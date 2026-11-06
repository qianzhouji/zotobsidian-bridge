export interface PopupSizeConstraints {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}

export interface PopupSize {
  width: number;
  height: number;
}

export function getPopupSizeConstraints(
  viewportWidth: number,
  viewportHeight: number,
  left: number,
  top: number,
): PopupSizeConstraints {
  const maxWidth = Math.max(
    1,
    Math.floor(viewportWidth - Math.max(12, left) - 12),
  );
  const maxHeight = Math.max(
    1,
    Math.floor(viewportHeight - Math.max(12, top) - 12),
  );
  return {
    minWidth: Math.min(320, maxWidth),
    maxWidth,
    minHeight: Math.min(238, maxHeight),
    maxHeight,
  };
}

export function clampPopupSize(
  size: PopupSize,
  constraints: PopupSizeConstraints,
): PopupSize {
  return {
    width: Math.min(
      constraints.maxWidth,
      Math.max(constraints.minWidth, size.width),
    ),
    height: Math.min(
      constraints.maxHeight,
      Math.max(constraints.minHeight, size.height),
    ),
  };
}
