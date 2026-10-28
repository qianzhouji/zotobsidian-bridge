import type { CompanionPendingWindowState } from "./core/companion-pending.ts";

type PendingWindow = Window & { arguments?: unknown[] };

function render(document: Document, state: CompanionPendingWindowState): void {
  const headline = document.getElementById("pending-headline");
  const detail = document.getElementById("pending-detail");
  const progress = document.getElementById(
    "pending-progress",
  ) as HTMLProgressElement | null;
  const close = document.getElementById(
    "close-pending",
  ) as HTMLButtonElement | null;
  if (!headline || !detail || !progress || !close) return;
  headline.textContent = state.headline;
  detail.textContent = state.detail;
  progress.hidden = state.finished;
  close.textContent = state.finished ? "关闭" : "隐藏（请求仍在队列中）";
  close.hidden = false;
}

function initialize(window: PendingWindow): void {
  const state = window.arguments?.[0] as
    | CompanionPendingWindowState
    | undefined;
  if (!state) return;
  const document = window.document;
  const close = document.getElementById("close-pending");
  if (!close) return;
  state.render = () => render(document, state);
  close.addEventListener("click", () => window.close());
  state.render();
}

const pendingWindow = globalThis as unknown as PendingWindow;
pendingWindow.addEventListener("load", () => initialize(pendingWindow));
