import type {
  DesktopScreenArea,
  DesktopWindowRect,
} from "../core/desktop-window-layout.ts";

export interface DesktopWindowOpenOptions {
  url: string;
  name: string;
  args: unknown[];
  features?: string;
}

export interface DesktopWindowHost {
  open(options: DesktopWindowOpenOptions): Window | null;
  getWindowRect?(window: Window): DesktopWindowRect;
  getAvailableScreenArea?(
    window: Window,
    rect?: DesktopWindowRect,
  ): DesktopScreenArea | null;
  setWindowRect?(window: Window, rect: DesktopWindowRect): void;
}

type OpenDialogWindow = Window & {
  openDialog?: (
    url: string,
    name: string,
    features: string,
    ...args: unknown[]
  ) => Window | null;
};

/** Restricts packaged chrome windows to this add-on's own content resources. */
export function createDesktopWindowHost(
  owner: Window,
  addonRef: string,
): DesktopWindowHost {
  const baseURL = `chrome://${addonRef}/content/`;
  return {
    open(options) {
      if (!options.url.startsWith(baseURL) || options.url.includes(".."))
        throw new Error("Desktop windows must use packaged add-on content.");
      const openDialog = (owner as OpenDialogWindow).openDialog;
      if (typeof openDialog !== "function")
        throw new Error("This Zotero window does not expose openDialog().");
      return openDialog.call(
        owner,
        options.url,
        options.name,
        options.features ??
          "chrome,dialog=no,resizable,centerscreen,width=480,height=360",
        ...options.args,
      );
    },
    getWindowRect(window) {
      return {
        left: window.screenX,
        top: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
      };
    },
    getAvailableScreenArea(window, rect) {
      const bounds = rect ?? {
        left: window.screenX,
        top: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
      };
      try {
        const manager = Cc["@mozilla.org/gfx/screenmanager;1"].getService(
          Ci.nsIScreenManager,
        );
        const screen = manager.screenForRect(
          Math.round(bounds.left),
          Math.round(bounds.top),
          Math.max(1, Math.round(bounds.width)),
          Math.max(1, Math.round(bounds.height)),
        );
        const left: { value?: number } = {};
        const top: { value?: number } = {};
        const width: { value?: number } = {};
        const height: { value?: number } = {};
        screen.GetAvailRect(left, top, width, height);
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
        // Use the window's screen facade when Gecko's screen manager is unavailable.
      }
      const screen = window.screen as Screen & {
        availLeft?: number;
        availTop?: number;
      };
      const width = screen.availWidth;
      const height = screen.availHeight;
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        !width ||
        !height
      )
        return null;
      return {
        left: screen.availLeft ?? 0,
        top: screen.availTop ?? 0,
        width,
        height,
      };
    },
    setWindowRect(window, rect) {
      if (
        Math.abs(window.outerWidth - rect.width) > 1 ||
        Math.abs(window.outerHeight - rect.height) > 1
      )
        window.resizeTo(Math.round(rect.width), Math.round(rect.height));
      if (
        Math.abs(window.screenX - rect.left) > 1 ||
        Math.abs(window.screenY - rect.top) > 1
      )
        window.moveTo(Math.round(rect.left), Math.round(rect.top));
    },
  };
}
