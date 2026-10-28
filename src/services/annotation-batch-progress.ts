import type { BatchProgressState } from "../core/batch-progress.ts";

type BatchProgressWindow = Window & { closed?: boolean };

export interface AnnotationBatchProgress {
  update(completed: number, headline: string, detail?: string): void;
  finish(headline: string, detail: string): void;
}

export function openAnnotationBatchProgress(
  total: number,
  onCancel: () => void,
): AnnotationBatchProgress {
  const state: BatchProgressState = {
    total,
    completed: 0,
    headline: `准备处理 ${total} 条批注`,
    detail: "已完成的卡片会保留。取消会在当前卡片处理完成后生效。",
    finished: false,
    cancelRequested: false,
    onCancel,
  };
  const mainWindow = Zotero.getMainWindow() as Window & {
    openDialog: (
      url: string,
      name: string,
      features: string,
      argument: BatchProgressState,
    ) => BatchProgressWindow | null;
  };
  const url = `chrome://${addon.data.config.addonRef}/content/batch-progress.xhtml`;
  const progressWindow = mainWindow.openDialog(
    url,
    `zotero-obsidian-bridge-batch-${crypto.randomUUID()}`,
    "chrome,dialog=no,resizable=no,centerscreen,width=480,height=210",
    state,
  );
  if (!progressWindow) {
    throw new Error(
      "Zotero could not open the annotation batch progress window.",
    );
  }

  const render = () => {
    if (!progressWindow.closed) state.render?.();
  };
  return {
    update(completed, headline, detail = "") {
      state.completed = completed;
      state.headline = headline;
      state.detail = detail;
      render();
    },
    finish(headline, detail) {
      state.finished = true;
      state.headline = headline;
      state.detail = detail;
      render();
    },
  };
}
