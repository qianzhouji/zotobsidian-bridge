import assert from "node:assert/strict";
import { stdout } from "node:process";
import { fitWindowRectToScreen } from "../src/core/desktop-window-layout.ts";

const primary = { left: 0, top: 24, width: 1440, height: 820 };
assert.deepEqual(
  fitWindowRectToScreen(
    { left: 1320, top: 790, width: 600, height: 500 },
    primary,
  ),
  { left: 840, top: 344, width: 600, height: 500 },
  "an oversized/off-edge window is restored wholly inside the available area",
);

const leftMonitor = { left: -1600, top: 40, width: 1600, height: 860 };
assert.deepEqual(
  fitWindowRectToScreen(
    { left: -2200, top: -100, width: 500, height: 300 },
    leftMonitor,
  ),
  { left: -1600, top: 40, width: 500, height: 300 },
  "negative desktop coordinates and menu-bar insets are preserved",
);

const constrained = fitWindowRectToScreen(
  { left: 15, top: 20, width: 900, height: 700 },
  { left: 0, top: 0, width: 300, height: 200 },
);
assert.deepEqual(
  constrained,
  { left: 0, top: 0, width: 300, height: 200 },
  "the fit degrades minimum dimensions only when the physical screen itself is smaller",
);

stdout.write(
  "Desktop window bounds checks passed: screen-local bounds, negative origins, safe-area insets, and undersized-display fallback.\n",
);
