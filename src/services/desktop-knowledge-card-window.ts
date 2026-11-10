type DesktopCardWindow = Window & { arguments?: unknown[] };

interface DesktopCardPayload {
  path: string;
}

export function desktopKnowledgeCardWindowURL(
  addonRef: string,
  platform: string,
): string {
  const document = /mac/i.test(platform)
    ? "desktop-knowledge-card-macos.xhtml"
    : "desktop-knowledge-card.xhtml";
  return `chrome://${addonRef}/content/${document}`;
}

export function prepareDesktopKnowledgeCardWindowChrome(
  window: DesktopCardWindow,
  platform = `${window.navigator.platform} ${window.navigator.userAgent}`,
): boolean {
  if (!/mac/i.test(platform)) return false;
  const documentRoot = window.document.documentElement;
  if (!documentRoot) return false;
  documentRoot.setAttribute("chromemargin", "0,-1,-1,-1");
  documentRoot.setAttribute("tabsintitlebar", "true");
  return true;
}

export function initializeDesktopKnowledgeCardWindow(
  window: DesktopCardWindow,
  platform = `${window.navigator.platform} ${window.navigator.userAgent}`,
): void {
  try {
    const payload = window.arguments?.[0] as
      | Partial<DesktopCardPayload>
      | undefined;
    const path = typeof payload?.path === "string" ? payload.path : "";
    const root = window.document.getElementById("desktop-card-window");
    const host = window.document.getElementById("card-host");
    const state = window.document.getElementById("window-state");
    const documentRoot = window.document.documentElement;
    if (!path || !root || !host || !state || !documentRoot)
      throw new Error(
        "Desktop knowledge-card window is missing its payload or host.",
      );

    prepareDesktopKnowledgeCardWindowChrome(window, platform);

    const title = path.split("/").at(-1)?.replace(/\.md$/i, "") || path;
    window.document.title = `${title} · Zotero Obsidian Bridge`;
    root.setAttribute("data-card-path", path);
    root.setAttribute("data-ready", "true");
    state.textContent = "Window ready; waiting for card content...";
    window.dispatchEvent(new window.Event("desktop-card-ready"));
  } catch (error) {
    window.document
      .getElementById("desktop-card-window")
      ?.setAttribute("data-ready", "failed");
    const state = window.document.getElementById("window-state");
    if (state) state.textContent = `Initialization failed: ${String(error)}`;
    window.dispatchEvent(new window.Event("desktop-card-failed"));
  }
}
