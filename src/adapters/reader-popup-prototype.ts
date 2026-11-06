import type { MountedReaderCardPopup } from "../services/reader-card-popup.ts";
import type { MountedPendingReaderCardPopup } from "../services/pending-reader-card-popup.ts";
import type { AnnotationCardReference } from "../services/annotation-card.ts";
import { annotationSourceID } from "../core/models.ts";
import {
  CompanionPendingError,
  getCompanionRequestOutcome,
  type CompanionRequestOutcome,
} from "./companion-queue.ts";

type PopupState = {
  editorID: string | null;
  shell: HTMLElement;
  pending?: MountedPendingReaderCardPopup;
  loading?: boolean;
  hostClassWasPresent: boolean;
  setMessage?(message: string): void;
  setError?(message: string): void;
  retry?(): void;
  prepareForModeChange(): Promise<"clean" | "checkpointed" | "pending">;
  cancelModeChange(): void;
  dispose(): void;
};

export interface ReaderPopupModePreparation {
  status: "clean" | "checkpointed" | "pending";
  commit(): void;
  rollback(): void;
}

type PopupRetry = {
  editorID: string | null;
  attempts: number;
  timer: ReturnType<typeof setTimeout>;
};

type PendingPopupRequest = {
  editorID: string;
  requestId: string;
  cancelled: boolean;
};

export interface ReaderPopupAdapterDependencies {
  resolveAnnotation(
    reader: _ZoteroTypes.ReaderInstance,
    editorID: string,
  ): Promise<Zotero.Item | null>;
  ensureCard(
    reader: _ZoteroTypes.ReaderInstance,
    editorID: string,
  ): Promise<AnnotationCardReference>;
  getExistingCardReference(
    annotation: Zotero.Item,
  ): Promise<AnnotationCardReference | null>;
  waitForCardRequest?(
    requestId: string,
    shouldContinue: () => boolean,
  ): Promise<CompanionRequestOutcome | null>;
  mountCard(
    doc: Document,
    annotation: Zotero.Item,
    reference: AnnotationCardReference,
  ): Promise<MountedReaderCardPopup>;
  mountPendingCard?(
    doc: Document,
    annotation: Zotero.Item,
    sourceID: string,
    retry: () => void,
  ): Promise<MountedPendingReaderCardPopup>;
}

type ReaderPopupAdapter = {
  doc: Document;
  observer: MutationObserver;
  states: Map<HTMLElement, PopupState>;
  resolving: WeakMap<HTMLElement, string>;
  retries: Map<HTMLElement, PopupRetry>;
  pendingRequests: Map<HTMLElement, PendingPopupRequest>;
  clickReconcileTimer: ReturnType<typeof setTimeout> | null;
  onDocumentClick: () => void;
  dependencies: ReaderPopupAdapterDependencies;
};

const adapters = new Map<_ZoteroTypes.ReaderInstance, ReaderPopupAdapter>();
const hostClass = "zob-reader-card-host";
const bootstrapStyleID = "zob-reader-card-bootstrap-styles";
let readerModeTransition = false;

function loadingMessage(doc: Document, phase: string): string {
  const language = doc.documentElement?.getAttribute("lang") ?? "";
  const isChinese = language.toLowerCase().startsWith("zh");
  const chinese: Record<string, string> = {
    "Resolving the saved Zotero highlight": "正在定位已保存的 Zotero 高亮…",
    "Checking for an existing Obsidian card": "正在检查对应的 Obsidian 卡片…",
    "Restoring the local draft": "正在恢复本地草稿…",
    "Creating the Obsidian card": "正在后台创建 Obsidian 卡片…",
    "Opening the linked card": "正在打开已关联的卡片…",
    "Waiting for Obsidian": "等待 Obsidian 确认写入…",
  };
  if (isChinese) return chinese[phase] ?? phase;
  return `${phase}…`;
}

function loadingRetryLabel(doc: Document): string {
  return doc.documentElement
    ?.getAttribute("lang")
    ?.toLowerCase()
    .startsWith("zh")
    ? "重试"
    : "Retry";
}

function showLoadingPopup(
  popup: HTMLElement,
  adapter: ReaderPopupAdapter,
  editorID: string | null,
  retry: () => void,
): PopupState {
  const doc = popup.ownerDocument!;
  const existing = adapter.states.get(popup);
  if (existing?.loading) {
    existing.editorID = editorID;
    existing.retry = retry;
    existing.setMessage?.(
      loadingMessage(doc, "Resolving the saved Zotero highlight"),
    );
    return existing;
  }
  installBootstrapStyles(doc);
  const shell = doc.createElement("section");
  shell.className =
    "zob-reader-popup-prototype zob-reader-card zob-reader-card-loading";
  shell.setAttribute("role", "status");
  shell.setAttribute("aria-live", "polite");
  shell.style.cssText = [
    "box-sizing:border-box",
    "display:flex",
    "align-items:center",
    "gap:10px",
    "width:min(420px,calc(100vw - 24px))",
    "min-height:58px",
    "padding:12px 14px",
    "color:#202426",
    "background:#fff",
    "border:1px solid #d6dcda",
    "border-radius:6px",
    "box-shadow:0 5px 18px rgb(0 0 0 / 18%)",
    "font:13px/1.45 system-ui,sans-serif",
  ].join(";");
  const indicator = doc.createElement("span");
  indicator.setAttribute("aria-hidden", "true");
  indicator.textContent = "…";
  indicator.style.cssText = "color:#285e7b;font-size:20px;font-weight:700";
  const message = doc.createElement("span");
  message.className = "zob-reader-card-loading-message";
  message.style.cssText = "flex:1;min-width:0;overflow-wrap:anywhere";
  message.textContent = loadingMessage(
    doc,
    "Resolving the saved Zotero highlight",
  );
  const retryButton = doc.createElement("button");
  retryButton.type = "button";
  retryButton.className = "zob-reader-card-loading-retry";
  retryButton.textContent = loadingRetryLabel(doc);
  retryButton.hidden = true;
  retryButton.style.cssText =
    "flex:0 0 auto;border:1px solid #d6dcda;border-radius:4px;padding:4px 8px;background:#fff;color:inherit;font:inherit;cursor:pointer";
  retryButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    retry();
  });

  const state: PopupState = {
    editorID,
    shell,
    loading: true,
    retry,
    hostClassWasPresent: popup.classList.contains(hostClass),
    setMessage(value) {
      message.textContent = value;
      shell.dataset.state = "pending";
      shell.setAttribute("role", "status");
      shell.setAttribute("aria-live", "polite");
      indicator.textContent = "…";
      retryButton.hidden = true;
    },
    setError(value) {
      message.textContent = value;
      shell.dataset.state = "error";
      shell.setAttribute("role", "alert");
      shell.setAttribute("aria-live", "assertive");
      indicator.textContent = "!";
      indicator.style.color = "#a6342a";
      retryButton.hidden = false;
    },
    async prepareForModeChange() {
      return "clean";
    },
    cancelModeChange() {},
    dispose() {},
  };
  adapter.states.set(popup, state);
  popup.classList.add(hostClass);
  shell.append(indicator, message, retryButton);
  popup.append(shell);
  return state;
}

function installBootstrapStyles(doc: Document): void {
  if (doc.getElementById(bootstrapStyleID)) return;
  const style = doc.createElement("style");
  style.id = bootstrapStyleID;
  style.textContent = `
.annotation-popup.${hostClass} {
  box-sizing: border-box !important; display: block !important;
  width: fit-content !important; min-width: 0 !important;
  max-width: calc(100vw - 16px) !important; height: auto !important;
  max-height: none !important; padding: 0 !important; overflow: visible !important;
  background: transparent !important; border: 0 !important; box-shadow: none !important;
  visibility: hidden !important;
}
.annotation-popup.${hostClass} > :not(.zob-reader-card) { display: none !important; }
.annotation-popup.${hostClass} > .zob-reader-card {
  display: flex !important; visibility: visible !important;
}
`;
  (doc.head ?? doc.documentElement)?.append(style);
}

function removeLoadingPopup(
  popup: HTMLElement,
  adapter: ReaderPopupAdapter,
): boolean {
  const state = adapter.states.get(popup);
  if (!state?.loading)
    return state?.hostClassWasPresent ?? popup.classList.contains(hostClass);
  state.dispose();
  state.shell.remove();
  adapter.states.delete(popup);
  return state.hostClassWasPresent;
}

const defaultDependencies: ReaderPopupAdapterDependencies = {
  resolveAnnotation,
  async ensureCard(reader, editorID) {
    const { ensureCardForAnnotation } =
      await import("../services/annotation-card.ts");
    return ensureCardForAnnotation(reader, { id: editorID });
  },
  async getExistingCardReference(annotation) {
    const { getExistingCardReference } =
      await import("../services/annotation-card.ts");
    return getExistingCardReference(annotation);
  },
  async mountCard(doc, annotation, reference) {
    const { mountReaderCardPopup } =
      await import("../services/reader-card-popup.ts");
    const { stagePendingCardDraft, clearPendingCardDraft } =
      await import("../services/pending-card-handoff.ts");
    const staged = await stagePendingCardDraft(reference);
    const mounted = await mountReaderCardPopup(
      doc,
      annotation,
      reference,
      staged?.content,
    );
    if (staged) {
      try {
        await clearPendingCardDraft(reference, staged);
      } catch (error) {
        Zotero.debug(
          `[Zotero Obsidian Bridge] Pending draft cleanup failed: ${String(error)}`,
        );
      }
    }
    return mounted;
  },
  async mountPendingCard(doc, annotation, sourceID, retry) {
    const { mountPendingReaderCardPopup } =
      await import("../services/pending-reader-card-popup.ts");
    return mountPendingReaderCardPopup(doc, annotation, sourceID, retry);
  },
};

export function readerPopupDocument(
  reader: _ZoteroTypes.ReaderInstance,
  eventDocument: Document,
): Document {
  return reader._iframeWindow?.document ?? eventDocument;
}

function popupEditorID(popup: HTMLElement): string | null {
  const editor = popup.querySelector<HTMLElement>(".comment [id]");
  return editor?.id || null;
}

function annotationMatchesID(item: Zotero.Item, editorID: string): boolean {
  return [
    String(item.id),
    item.key,
    `${item.libraryID}/${item.key}`,
    `${item.libraryID}_${item.key}`,
  ].includes(editorID);
}

async function resolveAnnotation(
  reader: _ZoteroTypes.ReaderInstance,
  editorID: string,
): Promise<Zotero.Item | null> {
  if (!reader.itemID) return null;
  const attachment = await Zotero.Items.getAsync(reader.itemID);
  if (!attachment?.isAttachment()) return null;
  return (
    attachment
      .getAnnotations(false)
      .find((item) => annotationMatchesID(item, editorID)) ?? null
  );
}

function restorePopup(popup: HTMLElement, adapter: ReaderPopupAdapter): void {
  clearPopupRetry(popup, adapter);
  cancelPendingPopupRequest(popup, adapter);
  const state = adapter.states.get(popup);
  if (!state) return;
  state.dispose();
  state.shell.remove();
  if (!state.hostClassWasPresent) popup.classList.remove(hostClass);
  adapter.states.delete(popup);
}

function clearPopupRetry(
  popup: HTMLElement,
  adapter: ReaderPopupAdapter,
): void {
  const retry = adapter.retries.get(popup);
  if (!retry) return;
  clearTimeout(retry.timer);
  adapter.retries.delete(popup);
}

function retryPopup(
  reader: _ZoteroTypes.ReaderInstance,
  popup: HTMLElement,
  adapter: ReaderPopupAdapter,
): void {
  clearPopupRetry(popup, adapter);
  void mountPopup(reader, popup, adapter);
}

function cancelPendingPopupRequest(
  popup: HTMLElement,
  adapter: ReaderPopupAdapter,
): void {
  const pending = adapter.pendingRequests.get(popup);
  if (!pending) return;
  pending.cancelled = true;
  adapter.pendingRequests.delete(popup);
}

async function waitForCompanionRequest(
  requestId: string,
  shouldContinue: () => boolean,
): Promise<CompanionRequestOutcome | null> {
  while (shouldContinue()) {
    const outcome = await getCompanionRequestOutcome(requestId);
    if (outcome.status !== "pending") return outcome;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

function resumePopupAfterPendingRequest(
  reader: _ZoteroTypes.ReaderInstance,
  popup: HTMLElement,
  adapter: ReaderPopupAdapter,
  editorID: string,
  requestId: string,
): void {
  cancelPendingPopupRequest(popup, adapter);
  const pending: PendingPopupRequest = {
    editorID,
    requestId,
    cancelled: false,
  };
  adapter.pendingRequests.set(popup, pending);
  const shouldContinue = () =>
    !pending.cancelled &&
    !readerModeTransition &&
    popup.isConnected &&
    Zotero.Prefs.get(
      "extensions.zotero.zoteroobsidianbridge.readerMode",
      true,
    ) === "bridge";
  void (adapter.dependencies.waitForCardRequest ?? waitForCompanionRequest)(
    requestId,
    shouldContinue,
  )
    .then((outcome) => {
      if (adapter.pendingRequests.get(popup) !== pending) return;
      adapter.pendingRequests.delete(popup);
      if (outcome?.status === "applied" && shouldContinue()) {
        void mountPopup(reader, popup, adapter);
      } else if (outcome && outcome.status !== "pending") {
        adapter.states
          .get(popup)
          ?.pending?.setError(
            `Card creation ${outcome.status}; local edits are preserved.`,
          );
        Zotero.debug(
          `[Zotero Obsidian Bridge] Reader popup request ${requestId} finished with ${outcome.status}; keeping the native popup available.`,
        );
      }
    })
    .catch((error: unknown) => {
      if (adapter.pendingRequests.get(popup) !== pending) return;
      adapter.pendingRequests.delete(popup);
      Zotero.debug(
        `[Zotero Obsidian Bridge] Could not observe Reader popup request ${requestId}: ${String(error)}`,
      );
    });
}

function schedulePopupRetry(
  reader: _ZoteroTypes.ReaderInstance,
  popup: HTMLElement,
  adapter: ReaderPopupAdapter,
  editorID: string | null,
  attempts: number,
): void {
  clearPopupRetry(popup, adapter);
  const delays = [60, 120, 240, 480, 800, 1200, 1600, 2000];
  if (attempts >= delays.length) {
    Zotero.debug(
      `[Zotero Obsidian Bridge] Reader popup did not resolve after retries (editor=${editorID ?? "missing"}).`,
    );
    const state = adapter.states.get(popup);
    if (state?.loading) {
      state.setError?.(
        editorID
          ? "Bridge could not load this card after several attempts. Click Retry to try again."
          : "Zotero has not finished identifying this annotation. Click Retry to try again.",
      );
    }
    return;
  }
  const timer = setTimeout(() => {
    adapter.retries.delete(popup);
    if (popup.isConnected) {
      void mountPopup(reader, popup, adapter, attempts + 1);
    }
  }, delays[attempts]);
  adapter.retries.set(popup, { editorID, attempts, timer });
}

async function mountPopup(
  reader: _ZoteroTypes.ReaderInstance,
  popup: HTMLElement,
  adapter: ReaderPopupAdapter,
  retryAttempt = 0,
): Promise<void> {
  if (readerModeTransition) return;
  const editorID = popupEditorID(popup);
  const initialState = adapter.states.get(popup);
  if (
    initialState?.loading &&
    initialState.editorID === editorID &&
    (adapter.resolving.get(popup) === editorID ||
      adapter.retries.get(popup)?.editorID === editorID)
  ) {
    return;
  }
  const pendingRequest = adapter.pendingRequests.get(popup);
  if (pendingRequest?.editorID === editorID) return;
  if (pendingRequest) cancelPendingPopupRequest(popup, adapter);
  const retry = () => retryPopup(reader, popup, adapter);
  if (!editorID) {
    const existing = adapter.states.get(popup);
    if (!existing?.loading) {
      if (existing) restorePopup(popup, adapter);
      showLoadingPopup(popup, adapter, null, retry);
    }
    adapter.states
      .get(popup)
      ?.setMessage?.(
        loadingMessage(
          popup.ownerDocument!,
          "Resolving the saved Zotero highlight",
        ),
      );
    schedulePopupRetry(reader, popup, adapter, null, retryAttempt);
    return;
  }
  let existing = adapter.states.get(popup);
  if (existing?.loading) existing.editorID = editorID;
  if (
    existing?.editorID === editorID &&
    !existing.loading &&
    !existing.pending &&
    existing.shell.isConnected &&
    popup.isConnected
  ) {
    clearPopupRetry(popup, adapter);
    return;
  }
  if (
    existing &&
    !existing.loading &&
    (existing.editorID !== editorID || !existing.pending)
  ) {
    restorePopup(popup, adapter);
    existing = undefined;
  }
  if (!existing) showLoadingPopup(popup, adapter, editorID, retry);

  clearPopupRetry(popup, adapter);
  if (adapter.resolving.get(popup) === editorID) return;
  adapter.resolving.set(popup, editorID);
  let mounted: MountedReaderCardPopup | null = null;
  let stageTimer: ReturnType<typeof setTimeout> | undefined;
  const setPhase = (phase: string) => {
    const state = adapter.states.get(popup);
    if (!state?.loading) return;
    const doc = popup.ownerDocument!;
    const isChinese = doc.documentElement
      ?.getAttribute("lang")
      ?.toLowerCase()
      .startsWith("zh");
    const text = loadingMessage(doc, phase);
    state.setMessage?.(text);
    if (stageTimer) clearTimeout(stageTimer);
    stageTimer = setTimeout(() => {
      const currentState = adapter.states.get(popup);
      currentState?.setMessage?.(
        isChinese ? `仍在等待：${text}` : `Still waiting: ${text}`,
      );
    }, 7000);
  };
  try {
    setPhase("Resolving the saved Zotero highlight");
    const annotation = await adapter.dependencies.resolveAnnotation(
      reader,
      editorID,
    );
    if (!annotation) {
      schedulePopupRetry(reader, popup, adapter, editorID, retryAttempt);
      return;
    }
    const library = Zotero.Libraries.get(annotation.libraryID);
    if (!library) {
      schedulePopupRetry(reader, popup, adapter, editorID, retryAttempt);
      return;
    }
    const expectedSourceID = annotationSourceID(
      { type: library.libraryType, typeID: library.libraryTypeID },
      annotation.key,
    );
    const current = () =>
      popup.isConnected &&
      popupEditorID(popup) === editorID &&
      !readerModeTransition &&
      Zotero.Prefs.get(
        "extensions.zotero.zoteroobsidianbridge.readerMode",
        true,
      ) === "bridge";
    let pending = adapter.states.get(popup)?.pending;
    setPhase("Checking for an existing Obsidian card");
    let reference =
      await adapter.dependencies.getExistingCardReference(annotation);
    if (!reference && !pending && adapter.dependencies.mountPendingCard) {
      const doc = popup.ownerDocument;
      if (!doc || !current()) return;
      setPhase("Restoring the local draft");
      pending = await adapter.dependencies.mountPendingCard(
        doc,
        annotation,
        expectedSourceID,
        () => void mountPopup(reader, popup, adapter),
      );
      if (!current()) {
        pending.dispose();
        return;
      }
      const pendingView = pending;
      const hostClassWasPresent = removeLoadingPopup(popup, adapter);
      const state: PopupState = {
        editorID,
        shell: pendingView.element,
        pending: pendingView,
        hostClassWasPresent,
        prepareForModeChange: () => pendingView.prepareForModeChange(),
        cancelModeChange: () => pendingView.cancelModeChange(),
        dispose: () => pendingView.dispose(),
      };
      adapter.states.set(popup, state);
      popup.classList.add(hostClass);
      popup.append(pendingView.element);
    }
    if (!reference) {
      setPhase("Creating the Obsidian card");
      reference = await adapter.dependencies.ensureCard(reader, editorID);
    }
    if (reference.sourceID !== expectedSourceID) {
      throw new Error("Resolved annotation card does not match this popup.");
    }
    if (!current()) return;
    const doc = popup.ownerDocument;
    if (!doc) return;
    setPhase("Opening the linked card");
    mounted = pending
      ? await pending.complete(reference)
      : await adapter.dependencies.mountCard(doc, annotation, reference);
    if (!current()) {
      mounted.dispose();
      return;
    }
    if (pending) {
      pending.dispose();
      pending.element.remove();
    }
    const hostClassWasPresent = removeLoadingPopup(popup, adapter);
    const state: PopupState = {
      editorID,
      shell: mounted.element,
      hostClassWasPresent,
      prepareForModeChange: mounted.prepareForModeChange,
      cancelModeChange: mounted.cancelModeChange,
      dispose: mounted.dispose,
    };
    adapter.states.set(popup, state);
    popup.classList.add(hostClass);
    popup.append(mounted.element);
    mounted = null;
  } catch (error) {
    mounted?.dispose();
    Zotero.debug(
      `[Zotero Obsidian Bridge] Reader card popup failed open (editor=${editorID}): ${String(error)}`,
    );
    if (
      popup.isConnected &&
      popupEditorID(popup) === editorID &&
      !readerModeTransition &&
      Zotero.Prefs.get(
        "extensions.zotero.zoteroobsidianbridge.readerMode",
        true,
      ) === "bridge"
    ) {
      if (error instanceof CompanionPendingError) {
        if (!adapter.states.get(popup)?.pending) {
          adapter.states
            .get(popup)
            ?.setMessage?.(
              loadingMessage(popup.ownerDocument!, "Waiting for Obsidian"),
            );
        }
        resumePopupAfterPendingRequest(
          reader,
          popup,
          adapter,
          editorID,
          error.requestId,
        );
      } else {
        adapter.states.get(popup)?.pending?.setError(String(error));
        adapter.states
          .get(popup)
          ?.setError?.(`Bridge card failed to load: ${String(error)}`);
        schedulePopupRetry(reader, popup, adapter, editorID, retryAttempt);
      }
    }
  } finally {
    if (stageTimer) clearTimeout(stageTimer);
    if (adapter.resolving.get(popup) === editorID) {
      adapter.resolving.delete(popup);
    }
  }
}

function reconcileReader(
  reader: _ZoteroTypes.ReaderInstance,
  doc: Document,
  adapter: ReaderPopupAdapter,
): void {
  const bridgeMode =
    Zotero.Prefs.get(
      "extensions.zotero.zoteroobsidianbridge.readerMode",
      true,
    ) === "bridge";
  const popups = new Set<HTMLElement>(
    Array.from(doc.querySelectorAll(".annotation-popup")) as HTMLElement[],
  );
  for (const popup of adapter.states.keys()) {
    if (!popup.isConnected || !popups.has(popup) || !bridgeMode) {
      restorePopup(popup, adapter);
    }
  }
  for (const popup of adapter.retries.keys()) {
    if (!popup.isConnected || !popups.has(popup) || !bridgeMode) {
      clearPopupRetry(popup, adapter);
    }
  }
  for (const popup of adapter.pendingRequests.keys()) {
    if (!popup.isConnected || !popups.has(popup) || !bridgeMode) {
      cancelPendingPopupRequest(popup, adapter);
    }
  }
  if (bridgeMode && !readerModeTransition) {
    for (const popup of popups) void mountPopup(reader, popup, adapter);
  }
}

function isBridgeCardMutation(record: MutationRecord): boolean {
  let target: Node | null = record.target;
  while (target && target.nodeType !== 1) target = target.parentNode;
  return Boolean(target && (target as Element).closest?.(".zob-reader-card"));
}

export function refreshReaderPopupPrototypes(): void {
  for (const [reader, adapter] of adapters) {
    reconcileReader(reader, adapter.doc, adapter);
  }
}

export async function prepareReaderPopupModeChange(): Promise<ReaderPopupModePreparation> {
  if (readerModeTransition) {
    throw new Error("A Reader mode transition is already in progress.");
  }
  readerModeTransition = true;
  const states = [...adapters.values()].flatMap((adapter) => [
    ...adapter.states.values(),
  ]);
  const results = await Promise.allSettled(
    states.map((state) => state.prepareForModeChange()),
  );
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) {
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") states[index]?.cancelModeChange();
    }
    readerModeTransition = false;
    refreshReaderPopupPrototypes();
    throw failed.reason;
  }

  const statuses = results.map((result) =>
    result.status === "fulfilled" ? result.value : "clean",
  );
  let completed = false;
  const finish = () => {
    if (completed) return;
    completed = true;
    readerModeTransition = false;
    refreshReaderPopupPrototypes();
  };
  return {
    status: statuses.includes("pending")
      ? "pending"
      : statuses.includes("checkpointed")
        ? "checkpointed"
        : "clean",
    commit: finish,
    rollback() {
      if (completed) return;
      for (const state of states) state.cancelModeChange();
      finish();
    },
  };
}

export function attachReaderPopupPrototype(
  reader: _ZoteroTypes.ReaderInstance,
  doc: Document,
  MutationObserverClass = doc.defaultView?.MutationObserver ??
    globalThis.MutationObserver,
  dependencies: ReaderPopupAdapterDependencies = defaultDependencies,
): void {
  const existing = adapters.get(reader);
  if (existing?.doc === doc) {
    existing.dependencies = dependencies;
    return;
  }
  if (existing) {
    existing.observer.disconnect();
    existing.doc.removeEventListener("click", existing.onDocumentClick, true);
    if (existing.clickReconcileTimer) {
      clearTimeout(existing.clickReconcileTimer);
    }
    for (const popup of existing.retries.keys()) {
      clearPopupRetry(popup, existing);
    }
    for (const popup of existing.pendingRequests.keys()) {
      cancelPendingPopupRequest(popup, existing);
    }
    for (const popup of existing.states.keys()) {
      restorePopup(popup, existing);
    }
    adapters.delete(reader);
  }
  if (!MutationObserverClass || !doc.documentElement) return;
  const adapter: ReaderPopupAdapter = {
    doc,
    observer: new MutationObserverClass((records: MutationRecord[]) => {
      if (records.length && records.every(isBridgeCardMutation)) return;
      reconcileReader(reader, doc, adapter);
    }),
    states: new Map(),
    resolving: new WeakMap(),
    retries: new Map(),
    pendingRequests: new Map(),
    clickReconcileTimer: null,
    onDocumentClick: () => {
      if (adapter.clickReconcileTimer) {
        clearTimeout(adapter.clickReconcileTimer);
      }
      adapter.clickReconcileTimer = setTimeout(() => {
        adapter.clickReconcileTimer = null;
        reconcileReader(reader, doc, adapter);
      }, 0);
    },
    dependencies,
  };
  adapters.set(reader, adapter);
  adapter.observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["id", "hidden", "style", "class", "aria-hidden"],
  });
  doc.addEventListener("click", adapter.onDocumentClick, true);
  reconcileReader(reader, doc, adapter);
}

function disposeReaderAdapter(
  reader: _ZoteroTypes.ReaderInstance,
  adapter: ReaderPopupAdapter,
): void {
  adapter.observer.disconnect();
  adapter.doc.removeEventListener("click", adapter.onDocumentClick, true);
  if (adapter.clickReconcileTimer) {
    clearTimeout(adapter.clickReconcileTimer);
  }
  for (const popup of adapter.retries.keys()) {
    clearPopupRetry(popup, adapter);
  }
  for (const popup of adapter.pendingRequests.keys()) {
    cancelPendingPopupRequest(popup, adapter);
  }
  for (const popup of adapter.states.keys()) restorePopup(popup, adapter);
  adapters.delete(reader);
}

export function attachExistingReaderPopupPrototypes(
  readers: Iterable<_ZoteroTypes.ReaderInstance>,
  dependencies: ReaderPopupAdapterDependencies = defaultDependencies,
): void {
  const currentReaders = new Set(readers);
  for (const [reader, adapter] of adapters) {
    if (!currentReaders.has(reader)) disposeReaderAdapter(reader, adapter);
  }
  for (const reader of currentReaders) {
    const attach = () => {
      const doc = reader._iframeWindow?.document;
      if (doc) attachReaderPopupPrototype(reader, doc, undefined, dependencies);
    };
    attach();
    if (!reader._iframeWindow?.document) {
      void reader._initPromise.then(attach).catch((error: unknown) => {
        Zotero.debug(
          `[Zotero Obsidian Bridge] Existing Reader attach failed: ${String(error)}`,
        );
      });
    }
  }
}

export async function detachReaderPopupPrototypes(): Promise<void> {
  readerModeTransition = true;
  const states = [...adapters.values()].flatMap((adapter) => [
    ...adapter.states.values(),
  ]);
  const results = await Promise.allSettled(
    states.map((state) => state.prepareForModeChange()),
  );
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  for (const [reader, adapter] of adapters) {
    disposeReaderAdapter(reader, adapter);
  }
  readerModeTransition = false;
  if (errors.length) {
    throw new AggregateError(
      errors,
      "One or more Reader editor drafts could not be checkpointed during shutdown.",
    );
  }
}
