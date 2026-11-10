import assert from "node:assert/strict";
import { stdout } from "node:process";
import { assessDesktopOverlayCapabilities } from "../src/core/desktop-overlay-capabilities.ts";

const geckoOnly = assessDesktopOverlayCapabilities({
  hasTopLevelWindowAPI: true,
});
assert.equal(geckoOnly.topLevelWindow.status, "verified");
assert.equal(geckoOnly.systemMousePassthrough.status, "not-exposed");
assert.equal(geckoOnly.overall, "blocked");

const cssOnlyClaim = assessDesktopOverlayCapabilities({
  hasTopLevelWindowAPI: true,
  nativeOverlayAdapter: {
    verified: false,
    transparent: true,
    nonActivating: true,
    controlledZOrder: true,
    systemMousePassthrough: true,
    tracksNativeDrag: true,
  },
});
assert.equal(
  cssOnlyClaim.systemMousePassthrough.status,
  "unverified",
  "an unverified or CSS-only host cannot be promoted to system passthrough",
);
assert.equal(cssOnlyClaim.overall, "blocked");

const nativeVerified = assessDesktopOverlayCapabilities({
  hasTopLevelWindowAPI: true,
  nativeOverlayAdapter: {
    verified: true,
    transparent: true,
    nonActivating: true,
    controlledZOrder: true,
    systemMousePassthrough: true,
    tracksNativeDrag: true,
  },
});
assert.equal(nativeVerified.overall, "ready");

stdout.write(
  "Desktop overlay capability checks passed: top-level windows do not imply OS passthrough, unverified adapters remain blocked, and all verified capabilities are required.\n",
);
