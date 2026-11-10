import type {
  DesktopEdgeOverlayHost,
  DesktopOverlayCurve,
  DesktopOverlayDisplay,
  DesktopOverlaySurface,
} from "./desktop-edge-overlay.ts";
import {
  isValidDesktopOverlayCurve,
  isValidDesktopOverlayDisplay,
} from "./desktop-edge-overlay.ts";
import type { DesktopRect } from "../core/desktop-geometry.ts";

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const SVG_NS = "http://www.w3.org/2000/svg";
const PROBE_DURATION_MS = 20_000;

type XulPopup = Element & {
  openPopupAtScreen?: (x: number, y: number, isContextMenu?: boolean) => void;
  hidePopup?: () => void;
  readonly state?: string;
  readonly boxObject?: {
    screenX?: number;
    screenY?: number;
    width?: number;
    height?: number;
  };
};

function svgElement<T extends SVGElement>(document: Document, name: string): T {
  return document.createElementNS(SVG_NS, name) as unknown as T;
}

function markerId(groupId: string, curveId: string, side: string): string {
  return `zob-${encodeURIComponent(`${groupId}-${curveId}-${side}`).replaceAll("%", "_")}`;
}

class XulPopupOverlaySurface implements DesktopOverlaySurface {
  private readonly panel: XulPopup;
  private readonly svg: SVGSVGElement;
  private readonly document: Document;
  private visible = false;
  private closed = false;

  constructor(document: Document, display: DesktopOverlayDisplay) {
    this.document = document;
    const createXULElement = (
      document as Document & {
        createXULElement?: (name: string) => Element;
      }
    ).createXULElement;
    if (!createXULElement)
      throw new Error("This Zotero document cannot create XUL popup panels.");

    const panel = createXULElement.call(document, "panel") as XulPopup & {
      style: CSSStyleDeclaration;
      setAttribute(name: string, value: string): void;
    };
    panel.setAttribute("id", `zob-desktop-edge-${crypto.randomUUID()}`);
    panel.setAttribute("level", "top");
    panel.setAttribute("noautofocus", "true");
    panel.setAttribute("norestorefocus", "true");
    panel.setAttribute("noautohide", "true");
    panel.setAttribute("flip", "none");
    panel.setAttribute("consumeoutsideclicks", "false");
    panel.setAttribute("ignorekeys", "true");
    panel.style.cssText = [
      "appearance: none !important",
      "background: transparent !important",
      "background-color: transparent !important",
      "border: 0 !important",
      "border-color: transparent !important",
      "box-shadow: none !important",
      "margin: 0 !important",
      "padding: 0 !important",
      "overflow: hidden !important",
      "pointer-events: none !important",
      "position: fixed !important",
      `width: ${display.rect.width}px !important`,
      `height: ${display.rect.height}px !important`,
      "min-width: 0 !important",
      "min-height: 0 !important",
      "max-width: none !important",
      "max-height: none !important",
    ].join(";");

    this.svg = svgElement<SVGSVGElement>(document, "svg");
    this.svg.setAttribute("aria-hidden", "true");
    this.svg.style.cssText = [
      "display: block",
      "width: 100%",
      "height: 100%",
      "overflow: hidden",
      "pointer-events: none",
    ].join(";");
    panel.appendChild(this.svg);

    const popupSet = document.getElementById("mainPopupSet");
    const parent = popupSet ?? document.documentElement;
    if (!parent) throw new Error("The Zotero document has no popup parent.");
    parent.appendChild(panel);
    this.panel = panel;
  }

  draw(
    display: DesktopOverlayDisplay,
    curves: readonly DesktopOverlayCurve[],
  ): void {
    if (this.closed) throw new Error("The desktop overlay is closed.");
    if (!isValidDesktopOverlayDisplay(display) || curves.length > 256)
      throw new Error("The desktop display geometry is invalid.");
    if (
      curves.some(
        (curve) =>
          !isValidDesktopOverlayCurve(curve) ||
          !curve.groupId ||
          curve.groupId.length > 512,
      )
    )
      throw new Error("The desktop overlay contains invalid curve data.");
    this.svg.setAttribute("width", String(display.rect.width));
    this.svg.setAttribute("height", String(display.rect.height));
    this.svg.setAttribute(
      "viewBox",
      `0 0 ${display.rect.width} ${display.rect.height}`,
    );
    this.svg.replaceChildren();
    const definitions = svgElement<SVGDefsElement>(this.document, "defs");
    this.svg.append(definitions);

    for (const curve of curves) {
      const startID = markerId(curve.groupId, curve.id, "start");
      const endID = markerId(curve.groupId, curve.id, "end");
      for (const id of [startID, endID]) {
        const marker = svgElement<SVGMarkerElement>(this.document, "marker");
        marker.setAttribute("id", id);
        marker.setAttribute("viewBox", "0 0 10 10");
        marker.setAttribute("refX", "8.5");
        marker.setAttribute("refY", "5");
        marker.setAttribute("markerWidth", "7");
        marker.setAttribute("markerHeight", "7");
        marker.setAttribute("orient", "auto-start-reverse");
        marker.setAttribute("markerUnits", "strokeWidth");
        const head = svgElement<SVGPathElement>(this.document, "path");
        head.setAttribute("d", "M 0 1 L 9 5 L 0 9 z");
        head.setAttribute("fill", "#6f9dc7");
        marker.append(head);
        definitions.append(marker);
      }
      const line = svgElement<SVGPathElement>(this.document, "path");
      const local = (point: { x: number; y: number }) => ({
        x: point.x - display.rect.left,
        y: point.y - display.rect.top,
      });
      const from = local(curve.from);
      const control1 = local(curve.control1);
      const control2 = local(curve.control2);
      const to = local(curve.to);
      line.setAttribute(
        "d",
        `M ${from.x} ${from.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${to.x} ${to.y}`,
      );
      line.setAttribute("fill", "none");
      if (curve.routeStatus)
        line.setAttribute("data-route-status", curve.routeStatus);
      line.setAttribute("stroke", "#6f9dc7");
      line.setAttribute("stroke-width", "2");
      line.setAttribute("stroke-dasharray", "7 6");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      if (curve.startArrow)
        line.setAttribute("marker-start", `url(#${startID})`);
      if (curve.endArrow) line.setAttribute("marker-end", `url(#${endID})`);
      this.svg.append(line);
    }
  }

  drawProbe(display: DesktopOverlayDisplay, curve: DesktopOverlayCurve): void {
    this.draw(display, [curve]);
    const frame = svgElement<SVGRectElement>(this.document, "rect");
    frame.setAttribute("x", "1");
    frame.setAttribute("y", "1");
    frame.setAttribute("width", String(display.rect.width - 2));
    frame.setAttribute("height", String(display.rect.height - 2));
    frame.setAttribute("fill", "none");
    frame.setAttribute("stroke", "#a9bac8");
    frame.setAttribute("stroke-dasharray", "4 5");
    frame.setAttribute("pointer-events", "none");
    this.svg.append(frame);

    const label = svgElement<SVGTextElement>(this.document, "text");
    label.setAttribute("x", "14");
    label.setAttribute("y", "22");
    label.setAttribute("fill", "#3b5268");
    label.setAttribute("font-family", "sans-serif");
    label.setAttribute("font-size", "13");
    label.setAttribute("pointer-events", "none");
    label.textContent = "Bridge desktop overlay probe · auto-closes";
    this.svg.append(label);
  }

  show(): void {
    if (this.closed) throw new Error("The desktop overlay is closed.");
    if (this.visible) return;
    const open = this.panel.openPopupAtScreen;
    if (typeof open !== "function")
      throw new Error("The XUL popup has no screen-positioned open method.");
    const screenRect = this.panel
      .getAttribute("data-screen-rect")
      ?.split(",")
      .map(Number);
    if (
      !screenRect ||
      screenRect.length !== 4 ||
      !screenRect.every(Number.isFinite)
    )
      throw new Error("The XUL popup has no validated screen rectangle.");
    open.call(this.panel, screenRect[0], screenRect[1], false);
    if (this.panel.state === "closed")
      throw new Error("The XUL popup did not become visible.");
    this.visible = true;
  }

  hide(): void {
    if (this.closed || !this.visible) return;
    this.panel.hidePopup?.();
    this.visible = false;
  }

  close(): void {
    if (this.closed) return;
    this.hide();
    this.panel.remove();
    this.closed = true;
  }

  setScreenRect(rect: DesktopRect): void {
    this.panel.setAttribute(
      "data-screen-rect",
      `${rect.left},${rect.top},${rect.width},${rect.height}`,
    );
  }
}

/**
 * Gecko XUL popup host. Capabilities remain unverified until the exact Zotero
 * runtime passes the cross-application probe; CSS alone never opens production
 * line surfaces.
 */
export function createXulPopupDesktopEdgeOverlayHost(
  owner: Window,
): DesktopEdgeOverlayHost {
  return {
    capabilities: {
      verified: false,
      transparent: false,
      nonActivating: false,
      controlledZOrder: false,
      systemMousePassthrough: false,
      tracksNativeDrag: false,
    },
    open(display) {
      const surface = new XulPopupOverlaySurface(owner.document, display);
      surface.setScreenRect(display.rect);
      return surface;
    },
  };
}

function rectForWindow(owner: Window): DesktopRect | undefined {
  try {
    const screen = Cc["@mozilla.org/gfx/screenmanager;1"]
      .getService(Ci.nsIScreenManager)
      .screenForRect(
        Math.round(owner.screenX),
        Math.round(owner.screenY),
        Math.max(1, Math.round(owner.outerWidth)),
        Math.max(1, Math.round(owner.outerHeight)),
      );
    const left: { value?: number } = {};
    const top: { value?: number } = {};
    const width: { value?: number } = {};
    const height: { value?: number } = {};
    screen.GetRect(left, top, width, height);
    if (
      Number.isFinite(left.value) &&
      Number.isFinite(top.value) &&
      Number.isFinite(width.value) &&
      Number.isFinite(height.value) &&
      width.value! > 0 &&
      height.value! > 0
    )
      return {
        left: left.value!,
        top: top.value!,
        width: width.value!,
        height: height.value!,
      };
  } catch {
    return undefined;
  }
  return undefined;
}

/** A short-lived, non-interactive probe used before enabling desktop lines. */
export function showDesktopOverlayPassthroughProbe(
  owner: Window,
  durationMs = PROBE_DURATION_MS,
): { stop(): void; expiresAt: number } {
  if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > 30_000)
    throw new Error("The desktop overlay probe duration is outside its limit.");
  const screen = rectForWindow(owner);
  if (!screen) throw new Error("Could not locate the Zotero display geometry.");
  const width = Math.min(520, screen.width - 40);
  const height = Math.min(260, screen.height - 40);
  if (width < 200 || height < 120)
    throw new Error("The current display is too small for the safe probe.");
  const rect = {
    left: screen.left + (screen.width - width) / 2,
    top: screen.top + (screen.height - height) / 2,
    width,
    height,
  };
  const host = createXulPopupDesktopEdgeOverlayHost(owner);
  const surface = host.open({ id: "probe", rect }) as XulPopupOverlaySurface;
  const curve: DesktopOverlayCurve = {
    id: "probe-line",
    groupId: "probe",
    from: { x: rect.left + 28, y: rect.top + 46 },
    control1: { x: rect.left + width * 0.3, y: rect.top + height * 0.2 },
    control2: { x: rect.left + width * 0.7, y: rect.top + height * 0.8 },
    to: { x: rect.left + width - 28, y: rect.top + height - 46 },
    startArrow: true,
    endArrow: true,
  };
  surface.drawProbe({ id: "probe", rect }, curve);
  surface.show();
  const timer = owner.setTimeout(() => surface.close(), durationMs);
  return {
    expiresAt: Date.now() + durationMs,
    stop() {
      owner.clearTimeout(timer);
      surface.close();
    },
  };
}
