import { getCompanionRequestOutcome } from "../adapters/companion-queue.ts";
import type { CompanionPendingWindowState } from "../core/companion-pending.ts";

type PendingWindow = Window & { closed?: boolean };

const pollIntervalMs = 250;
const closeDelayMs = 1800;

export function showPendingCompanionRequest(requestId: string): void {
  const state: CompanionPendingWindowState = {
    headline: "Obsidian 尚未响应，写入请求仍在队列中",
    detail:
      "可以继续使用 Zotero。收到 Obsidian 回执后，此窗口会自动更新并关闭。",
    finished: false,
  };
  const mainWindow = Zotero.getMainWindow() as Window & {
    openDialog: (
      url: string,
      name: string,
      features: string,
      argument: CompanionPendingWindowState,
    ) => PendingWindow | null;
  };
  const url = `chrome://${addon.data.config.addonRef}/content/companion-pending.xhtml`;
  let pendingWindow: PendingWindow | null;
  try {
    pendingWindow = mainWindow.openDialog(
      url,
      `zotero-obsidian-bridge-pending-${requestId}`,
      "chrome,dialog=no,resizable=no,centerscreen,width=500,height=190",
      state,
    );
  } catch (error) {
    Zotero.debug(
      `[Zotero Obsidian Bridge] Could not open pending status: ${String(error)}`,
    );
    return;
  }
  if (!pendingWindow) return;

  const render = () => {
    if (!pendingWindow?.closed) state.render?.();
  };
  const finish = (headline: string, detail: string, autoClose: boolean) => {
    state.headline = headline;
    state.detail = detail;
    state.finished = true;
    render();
    if (autoClose) {
      setTimeout(() => {
        if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
      }, closeDelayMs);
    }
  };

  void (async () => {
    while (pendingWindow && !pendingWindow.closed) {
      try {
        const outcome = await getCompanionRequestOutcome(requestId);
        if (outcome.status === "applied") {
          finish(
            "Obsidian 已处理请求",
            "回执已收到；Zotero 正在完成后续同步。",
            true,
          );
          return;
        }
        if (outcome.status === "conflict") {
          finish("Obsidian 未能应用请求", outcome.message, false);
          return;
        }
        if (outcome.status === "completed") {
          finish("请求已完成", "队列已清理，未发现待处理请求。", true);
          return;
        }
      } catch (error) {
        Zotero.debug(
          `[Zotero Obsidian Bridge] Pending request check failed: ${String(error)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  })();
}
