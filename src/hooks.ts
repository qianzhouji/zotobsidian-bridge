import {
  createCardFromAnnotation,
  ensureCardForAnnotation,
  importAllSavedAnnotations,
} from "./services/annotation-card.ts";
import { openMarkdownEditor } from "./services/markdown-editor.ts";
import { importNativeNote } from "./services/native-note-card.ts";
import { bindBridgePreferences } from "./services/preferences.ts";
import {
  initializeAutoEnrollment,
  handleAutoEnrollmentNotifierEvent,
} from "./services/auto-enrollment.ts";
import {
  acknowledgeCompanionResponses,
  CompanionPendingError,
} from "./adapters/companion-queue.ts";
import { showPendingCompanionRequest } from "./services/companion-pending-window.ts";
import { initLocale } from "./utils/locale.ts";
import {
  handleNotifierEvent,
  queueSourceSync,
  startSyncQueue,
  stopSyncQueue,
} from "./services/sync-queue.ts";

let listenersRegistered = false;
let notifierObserverID: string | null = null;
let companionResponseTimer: ReturnType<typeof setInterval> | null = null;
let companionRecoveryRunning = false;
let preferencesPaneID: string | null = null;
let nativeNoteMenuID: string | null = null;

async function reconcileCompanionResponses(): Promise<void> {
  const writerMode = Zotero.Prefs.get(
    "extensions.zotero.zoteroobsidianbridge.writerMode",
    true,
  );
  if (writerMode !== "companion" && writerMode !== "transition") {
    return;
  }
  if (companionRecoveryRunning) return;
  companionRecoveryRunning = true;
  try {
    await acknowledgeCompanionResponses((sourceIDs) =>
      Promise.all(
        sourceIDs.map((sourceID) =>
          queueSourceSync(sourceID, "companion-recovered", true),
        ),
      ).then(() => undefined),
    );
  } catch (error) {
    Zotero.debug(
      `[Zotero Obsidian Bridge] Companion recovery: ${String(error)}`,
    );
  } finally {
    companionRecoveryRunning = false;
  }
}

function reportError(error: unknown): void {
  Zotero.debug(`[Zotero Obsidian Bridge] ${String(error)}`);
  if (error instanceof CompanionPendingError) {
    showPendingCompanionRequest(error.requestId);
    return;
  }
  Zotero.getMainWindow().alert(
    `Zotero Obsidian Bridge 操作失败：${String(error)}\n` +
      `Zotero Obsidian Bridge action failed: ${String(error)}`,
  );
}

function addPopupButton(
  event: _ZoteroTypes.Reader.EventParams<
    "renderTextSelectionPopup" | "renderSidebarAnnotationHeader"
  >,
): void {
  const button = event.doc.createElement("button");
  button.type = "button";
  button.textContent = "Open / Add Obsidian card";
  button.style.cssText =
    "margin-inline-start: 8px; padding: 4px 8px; cursor: pointer;";
  button.addEventListener("click", () => {
    void createCardFromAnnotation(event.reader, event.params.annotation).catch(
      reportError,
    );
  });
  event.append(button);

  const editButton = event.doc.createElement("button");
  editButton.type = "button";
  editButton.textContent = "Edit Markdown in Zotero";
  editButton.style.cssText =
    "margin-inline-start: 8px; padding: 4px 8px; cursor: pointer;";
  editButton.addEventListener("click", () => {
    void ensureCardForAnnotation(event.reader, event.params.annotation)
      .then(openMarkdownEditor)
      .catch(reportError);
  });
  event.append(editButton);
}

function onAnnotationContextMenu(
  event: _ZoteroTypes.Reader.EventParams<"createAnnotationContextMenu">,
): void {
  const selectedIDs = [...new Set(event.params.ids)];
  const label =
    selectedIDs.length > 1
      ? `Open / Add Obsidian cards (${selectedIDs.length})`
      : "Open / Add Obsidian card";
  event.append({
    label,
    onCommand: () => {
      void createCardFromAnnotation(
        event.reader,
        { id: event.params.currentID },
        selectedIDs,
      ).catch(reportError);
    },
  });
  event.append({
    label: "Edit current annotation card in Zotero",
    onCommand: () => {
      void ensureCardForAnnotation(event.reader, {
        id: event.params.currentID,
      })
        .then(openMarkdownEditor)
        .catch(reportError);
    },
  });
  event.append({
    label: "Import all saved annotations from this PDF",
    onCommand: () => {
      void importAllSavedAnnotations(
        event.reader,
        event.params.currentID,
      ).catch(reportError);
    },
  });
}

function onTextSelectionPopup(
  event: _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">,
): void {
  addPopupButton(event);
}

function onSidebarAnnotationHeader(
  event: _ZoteroTypes.Reader.EventParams<"renderSidebarAnnotationHeader">,
): void {
  addPopupButton(event);
}

function onPrefsEvent(type: string, data: { window: Window }): void {
  if (type !== "load") return;

  bindBridgePreferences(data.window);
}

function registerNativeNoteMenu(): void {
  const selectedNotes = (
    context: _ZoteroTypes.MenuManager.LibraryMenuContext,
  ) => {
    const contextItems = context.items ?? [];
    const items = contextItems.length
      ? contextItems
      : Zotero.getActiveZoteroPane().getSelectedItems();
    return items.filter((item) => item.isNote());
  };
  nativeNoteMenuID =
    Zotero.MenuManager.registerMenu({
      menuID: "zotero-obsidian-bridge-native-note",
      pluginID: addon.data.config.addonID,
      target: "main/library/item",
      menus: [
        {
          menuType: "menuitem",
          l10nID: "zoteroobsidianbridge-import-native-note",
          onShowing: (_event, context) => {
            context.setVisible(selectedNotes(context).length > 0);
          },
          onCommand: (_event, context) => {
            const notes = selectedNotes(context);
            void Promise.all(
              notes.map((note) => importNativeNote(note).catch(reportError)),
            );
          },
        },
      ],
    }) || null;
}

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  if (listenersRegistered) return;
  initLocale();
  preferencesPaneID = await Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: "content/preferences.xhtml",
    id: "zotero-obsidian-bridge",
    label: "Zotero Obsidian Bridge",
  });
  registerNativeNoteMenu();
  await startSyncQueue();
  await initializeAutoEnrollment();
  if (companionResponseTimer !== null) clearInterval(companionResponseTimer);
  companionResponseTimer = setInterval(() => {
    void reconcileCompanionResponses();
  }, 1000);
  void reconcileCompanionResponses();
  notifierObserverID = Zotero.Notifier.registerObserver(
    {
      notify: (event, type, ids, extraData) => {
        handleNotifierEvent(event, type, ids, extraData);
        handleAutoEnrollmentNotifierEvent(event, type, ids);
      },
    },
    ["item", "trash"],
    addon.data.config.addonID,
    50,
  );
  Zotero.Reader.registerEventListener(
    "createAnnotationContextMenu",
    onAnnotationContextMenu,
    addon.data.config.addonID,
  );
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    onTextSelectionPopup,
    addon.data.config.addonID,
  );
  Zotero.Reader.registerEventListener(
    "renderSidebarAnnotationHeader",
    onSidebarAnnotationHeader,
    addon.data.config.addonID,
  );
  listenersRegistered = true;
  addon.data.initialized = true;
}

function onShutdown(): void {
  if (nativeNoteMenuID) {
    Zotero.MenuManager.unregisterMenu(nativeNoteMenuID);
    nativeNoteMenuID = null;
  }
  if (preferencesPaneID) {
    Zotero.PreferencePanes.unregister(preferencesPaneID);
    preferencesPaneID = null;
  }
  if (companionResponseTimer !== null) {
    clearInterval(companionResponseTimer);
    companionResponseTimer = null;
  }
  companionRecoveryRunning = false;
  if (notifierObserverID) {
    Zotero.Notifier.unregisterObserver(notifierObserverID);
    notifierObserverID = null;
  }
  void stopSyncQueue();
  if (listenersRegistered) {
    Zotero.Reader.unregisterEventListener(
      "createAnnotationContextMenu",
      onAnnotationContextMenu,
    );
    Zotero.Reader.unregisterEventListener(
      "renderTextSelectionPopup",
      onTextSelectionPopup,
    );
    Zotero.Reader.unregisterEventListener(
      "renderSidebarAnnotationHeader",
      onSidebarAnnotationHeader,
    );
    listenersRegistered = false;
  }
  addon.data.alive = false;
  // @ts-expect-error Zotero does not declare the add-on's dynamic namespace key.
  delete Zotero[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad: async (_win: _ZoteroTypes.MainWindow) => {},
  onMainWindowUnload: async (_win: Window) => {},
  onPrefsEvent,
};
