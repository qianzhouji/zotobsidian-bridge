export type DesktopCapabilityStatus = "verified" | "not-exposed" | "unverified";

export interface DesktopOverlayCapability {
  status: DesktopCapabilityStatus;
  evidence: string;
}

export interface DesktopOverlayCapabilityReport {
  topLevelWindow: DesktopOverlayCapability;
  transparentSurface: DesktopOverlayCapability;
  nonActivating: DesktopOverlayCapability;
  controlledZOrder: DesktopOverlayCapability;
  systemMousePassthrough: DesktopOverlayCapability;
  tracksNativeDrag: DesktopOverlayCapability;
  overall: "ready" | "blocked";
}

/**
 * Assesses only capabilities the caller can prove. A CSS transparent surface
 * or DOM pointer-events setting never upgrades system mouse passthrough.
 */
export function assessDesktopOverlayCapabilities(input: {
  hasTopLevelWindowAPI: boolean;
  nativeOverlayAdapter?: {
    verified: boolean;
    transparent: boolean;
    nonActivating: boolean;
    controlledZOrder: boolean;
    systemMousePassthrough: boolean;
    tracksNativeDrag: boolean;
  };
}): DesktopOverlayCapabilityReport {
  const native = input.nativeOverlayAdapter;
  const verified = Boolean(native?.verified);
  const result = (
    value: boolean | undefined,
    positive: string,
    missing: string,
  ): DesktopOverlayCapability =>
    verified && value === true
      ? { status: "verified", evidence: positive }
      : {
          status: native ? "unverified" : "not-exposed",
          evidence: missing,
        };
  const report: DesktopOverlayCapabilityReport = {
    topLevelWindow: input.hasTopLevelWindowAPI
      ? {
          status: "verified",
          evidence: "Zotero chrome window exposes openDialog().",
        }
      : {
          status: "not-exposed",
          evidence: "No supported top-level chrome window API was found.",
        },
    transparentSurface: result(
      native?.transparent,
      "The native adapter created and visually verified a transparent window.",
      "Gecko can style transparent DOM content, but no verified native overlay window is available.",
    ),
    nonActivating: result(
      native?.nonActivating,
      "The native adapter verified the overlay does not activate or steal focus.",
      "No verified non-activating native-window operation is exposed to the plugin.",
    ),
    controlledZOrder: result(
      native?.controlledZOrder,
      "The native adapter verified the required root/line/card z-order.",
      "A top-level dialog does not prove controllable cross-application z-order.",
    ),
    systemMousePassthrough: result(
      native?.systemMousePassthrough,
      "Real lower-app clicks, drags, and scrolling passed through the overlay.",
      "DOM pointer-events cannot prove OS-level mouse passthrough; no verified native adapter is available.",
    ),
    tracksNativeDrag: result(
      native?.tracksNativeDrag,
      "Geometry remained current during a native window drag loop.",
      "No verified movement source has been proven to run during native drag loops.",
    ),
    overall: "blocked",
  };
  report.overall = Object.entries(report)
    .filter(([key]) => key !== "overall")
    .every(([, capability]) => capability.status === "verified")
    ? "ready"
    : "blocked";
  return report;
}
