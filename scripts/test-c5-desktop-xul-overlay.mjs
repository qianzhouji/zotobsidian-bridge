import assert from "node:assert/strict";
import { stdout } from "node:process";
import { parseHTML } from "linkedom";
import {
  createXulPopupDesktopEdgeOverlayHost,
  showDesktopOverlayPassthroughProbe,
} from "../src/adapters/xul-desktop-edge-overlay.ts";

function makeOwner() {
  const { window } = parseHTML(
    "<html><body><div id='mainPopupSet'></div></body></html>",
  );
  const panels = [];
  window.document.createXULElement = (name) => {
    const panel = window.document.createElement("div");
    panel.setAttribute("data-xul-name", name);
    panel.openPopupAtScreen = (x, y) => {
      panel.openedAt = [x, y];
      panel.currentState = "open";
    };
    panel.hidePopup = () => {
      panel.currentState = "closed";
    };
    Object.defineProperty(panel, "state", {
      get: () => panel.currentState ?? "closed",
    });
    panels.push(panel);
    return panel;
  };
  Object.defineProperties(window, {
    screenX: { value: -1200 },
    screenY: { value: 20 },
    outerWidth: { value: 1000 },
    outerHeight: { value: 700 },
  });
  return { window, panels };
}

const display = {
  id: "left-display",
  rect: { left: -1440, top: 0, width: 1440, height: 900 },
};
const curve = {
  id: "root-to-card",
  groupId: "group-1",
  from: { x: -1200, y: 120 },
  control1: { x: -1000, y: 150 },
  control2: { x: -700, y: 500 },
  to: { x: -500, y: 540 },
  startArrow: true,
  endArrow: true,
};

const { window: owner, panels } = makeOwner();
const host = createXulPopupDesktopEdgeOverlayHost(owner);
assert.deepEqual(host.capabilities, {
  verified: false,
  transparent: false,
  nonActivating: false,
  controlledZOrder: false,
  systemMousePassthrough: false,
  tracksNativeDrag: false,
});

const surface = host.open(display);
surface.draw(display, [curve]);
const panel = panels[0];
assert.equal(panel.getAttribute("level"), "top");
assert.equal(panel.getAttribute("noautofocus"), "true");
assert.equal(panel.getAttribute("norestorefocus"), "true");
assert.equal(panel.getAttribute("noautohide"), "true");
assert.match(panel.style.cssText, /pointer-events:\s*none/i);
assert.match(panel.style.cssText, /background:\s*transparent/i);
const path = panel.querySelector("path[marker-start]");
assert.ok(path, "the line and both endpoint markers are rendered as SVG");
assert.match(path.getAttribute("d"), /M 240 120 C/);
surface.show();
assert.deepEqual(panel.openedAt, [-1440, 0]);
assert.equal(panel.state, "open");
surface.hide();
assert.equal(panel.state, "closed");
surface.close();
assert.equal(panel.isConnected, false);

const previousCc = globalThis.Cc;
const previousCi = globalThis.Ci;
globalThis.Cc = {
  "@mozilla.org/gfx/screenmanager;1": {
    getService() {
      return {
        screenForRect() {
          return {
            GetRect(left, top, width, height) {
              left.value = -1440;
              top.value = 0;
              width.value = 1440;
              height.value = 900;
            },
          };
        },
      };
    },
  },
};
globalThis.Ci = { nsIScreenManager: Symbol("nsIScreenManager") };
const probe = showDesktopOverlayPassthroughProbe(owner, 15);
assert.ok(probe.expiresAt > Date.now());
assert.equal(panels.length, 2);
assert.ok(panels[1].querySelector("rect"), "probe visibly marks its bounds");
assert.match(panels[1].textContent, /desktop overlay probe/i);
await new Promise((resolve) => owner.setTimeout(resolve, 35));
assert.equal(panels[1].isConnected, false, "probe auto-closes on its deadline");
const stoppedProbe = showDesktopOverlayPassthroughProbe(owner, 20_000);
stoppedProbe.stop();
assert.equal(
  panels[2].isConnected,
  false,
  "manual stop immediately removes probe",
);

if (previousCc === undefined) delete globalThis.Cc;
else globalThis.Cc = previousCc;
if (previousCi === undefined) delete globalThis.Ci;
else globalThis.Ci = previousCi;

stdout.write(
  "XUL overlay checks passed: screen-positioned panel, fail-closed host capabilities, non-interactive SVG structure, bounded probe lifetime, and immediate cleanup. OS mouse passthrough remains a real-host-only check.\n",
);
