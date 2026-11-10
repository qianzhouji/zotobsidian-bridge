import { createDesktopWindowHost } from "../adapters/desktop-window-host.ts";
import { DesktopCardWindowRegistry } from "../core/desktop-card-window-registry.ts";
import { DesktopCardWindowGroup } from "./desktop-card-window-group.ts";

type PrototypeWindow = Window & { arguments?: unknown[] };

interface PrototypePayload {
  title: string;
  path: string;
  markdown: string;
}

function getPayload(window: PrototypeWindow): PrototypePayload {
  const value = window.arguments?.[0] as Partial<PrototypePayload> | undefined;
  return {
    title: typeof value?.title === "string" ? value.title : "Bayes",
    path: typeof value?.path === "string" ? value.path : "Mathematics/Bayes.md",
    markdown:
      typeof value?.markdown === "string"
        ? value.markdown
        : "Synthetic read-only note used to validate a native desktop window.",
  };
}

function renderPrototype(window: PrototypeWindow): void {
  const payload = getPayload(window);
  const { document } = window;
  const root = document.getElementById("prototype");
  const title = document.getElementById("card-title");
  const path = document.getElementById("card-path");
  const body = document.getElementById("card-body");
  const state = document.getElementById("window-state");
  const close = document.getElementById("close-window");
  if (!root || !title || !path || !body || !state || !close)
    throw new Error("Desktop window prototype is missing required UI.");

  title.textContent = payload.title;
  path.textContent = `${payload.path} · Read only · Synthetic fixture`;
  body.textContent = payload.markdown;
  state.textContent = `Ready · ${window.screenX}, ${window.screenY} · ${window.outerWidth}×${window.outerHeight}`;
  root.setAttribute("data-ready", "true");
  window.dispatchEvent(new window.Event("desktop-card-ready"));
  close.addEventListener("click", () => window.close());
}

const registries = new WeakMap<Window, DesktopCardWindowRegistry>();
const groups = new WeakMap<Window, DesktopCardWindowGroup>();
const ownerIDs = new WeakMap<Window, string>();
const profileInstanceID = `development-profile-${Date.now()}`;
let ownerSequence = 0;

function ownerID(owner: Window): string {
  let id = ownerIDs.get(owner);
  if (!id) {
    id = `zotero-window-${++ownerSequence}`;
    ownerIDs.set(owner, id);
  }
  return id;
}

export function openDesktopWindowPrototype(
  owner: Window = Zotero.getMainWindow(),
): Window {
  const host = createDesktopWindowHost(
    Zotero.getMainWindow(),
    addon.data.config.addonRef,
  );
  let registry = registries.get(owner);
  if (!registry) {
    registry = new DesktopCardWindowRegistry();
    registries.set(owner, registry);
  }
  let group = groups.get(owner);
  if (!group) {
    group = new DesktopCardWindowGroup({
      owner,
      identity: {
        profileInstanceId: profileInstanceID,
        ownerWindowId: ownerID(owner),
        rootSessionId: `desktop-prototype-session-${ownerID(owner)}`,
        groupId: `desktop-prototype-group-${ownerID(owner)}`,
        vaultId: "synthetic-fixture",
        pairingEpoch: "development",
      },
      registry,
      host,
      openOptions(path) {
        return {
          url: `chrome://${addon.data.config.addonRef}/content/desktop-window-prototype.xhtml`,
          name: `zob-desktop-prototype-${path}`,
          args: [
            {
              title: path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path,
              path,
              markdown:
                "Synthetic read-only knowledge card. Move this native window beyond the Zotero window to verify top-level window behavior.",
            } satisfies PrototypePayload,
          ],
        };
      },
      onFailure(path, error) {
        const message = `The desktop card prototype could not open ${path}: ${error}\n\nThe blank window will be closed. You can retry by calling openDesktopWindowPrototype(window) again from the Zotero developer console.`;
        Zotero.debug(
          `[Zotero Obsidian Bridge] Desktop prototype failed for ${path}: ${error}`,
        );
        try {
          owner.alert(message);
        } catch {
          // A closing owner window may no longer be able to show an alert.
        }
      },
    });
    groups.set(owner, group);
  }
  const result = group.open("Mathematics/Bayes.md");
  if (!result.window) {
    if (result.status === "group-limit" || result.status === "owner-limit")
      throw new Error(`Prototype window limit reached: ${result.status}.`);
    throw new Error("Desktop prototype window is still opening.");
  }
  return result.window;
}

export function initializeDesktopWindowPrototype(
  window: PrototypeWindow,
): void {
  try {
    renderPrototype(window);
  } catch (error) {
    window.document
      .getElementById("prototype")
      ?.setAttribute("data-ready", "failed");
    const state = window.document.getElementById("window-state");
    if (state) state.textContent = `Prototype failed: ${String(error)}`;
    window.dispatchEvent(new window.Event("desktop-card-failed"));
  }
}
