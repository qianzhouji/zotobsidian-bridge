import type { BatchProgressState } from "./core/batch-progress.ts";

type BatchProgressBrowserWindow = Window & { arguments?: unknown[] };

function render(document: Document, state: BatchProgressState): void {
  const headline = document.getElementById("batch-headline");
  const detail = document.getElementById("batch-detail");
  const progress = document.getElementById(
    "batch-progress",
  ) as HTMLProgressElement | null;
  const cancel = document.getElementById(
    "cancel-batch",
  ) as HTMLButtonElement | null;
  const close = document.getElementById(
    "close-batch",
  ) as HTMLButtonElement | null;
  if (!headline || !detail || !progress || !cancel || !close) return;

  headline.textContent = state.headline;
  detail.textContent = state.detail;
  progress.max = Math.max(1, state.total);
  progress.value = state.completed;
  cancel.hidden = state.finished;
  cancel.disabled = state.cancelRequested || state.finished;
  close.hidden = !state.finished;
}

export function initializeBatchProgressWindow(
  window: BatchProgressBrowserWindow,
): void {
  const state = window.arguments?.[0] as BatchProgressState | undefined;
  if (!state) return;
  const document = window.document;
  const cancel = document.getElementById("cancel-batch");
  const close = document.getElementById("close-batch");
  if (!cancel || !close) return;

  state.render = () => render(document, state);
  cancel.addEventListener("click", () => {
    state.cancelRequested = true;
    state.onCancel();
    state.headline = "正在完成当前卡片，然后停止批处理…";
    state.detail = `${state.completed}/${state.total} 条已完成。已写入的卡片会保留。`;
    state.render?.();
  });
  close.addEventListener("click", () => window.close());
  window.addEventListener("unload", () => {
    if (!state.finished) {
      state.cancelRequested = true;
      state.onCancel();
    }
  });
  state.render();
}

const batchWindow = globalThis as unknown as BatchProgressBrowserWindow;
batchWindow.addEventListener("load", () => {
  initializeBatchProgressWindow(batchWindow);
});
