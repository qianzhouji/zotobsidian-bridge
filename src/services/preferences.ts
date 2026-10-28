import packageMetadata from "../../package.json";
import {
  getSyncStatus,
  reconcileLinkedCards,
  retryFailedSyncTasks,
  retrySyncTask,
} from "./sync-queue.ts";
import {
  createExclusiveVaultFile,
  findCardByFrontmatter,
  readVaultFile,
  resolveVaultPath,
  waitForVaultWrites,
} from "../adapters/vault-storage.ts";
import { hasPendingCompanionRequests } from "../adapters/companion-queue.ts";
import {
  COMPANION_PROTOCOL_VERSION,
  isValidCompanionVaultId,
} from "../adapters/companion-protocol.ts";
import { transitionWriterMode } from "../core/writer-transition.ts";
import {
  cancelHistoricalImport,
  getAutoEnrollmentConfig,
  getAutoEnrollmentState,
  previewAutoEnrollmentConfig,
  previewAutoEnrollmentScopes,
  resumeHistoricalImport,
  retryFailedAutoEnrollment,
  saveAutoEnrollmentConfig,
  startHistoricalImport,
} from "./auto-enrollment.ts";
import type {
  AutoEnrollmentConfig,
  AutoEnrollmentScope,
} from "../core/auto-enrollment.ts";
import {
  classifyDiagnosticError,
  createDiagnosticReport,
  diagnosticGuidanceMessages,
} from "../core/diagnostics.ts";
import { validateVaultRelativePath } from "../core/models.ts";
import type { SyncTaskStatus } from "../core/models.ts";
import type { FluentMessageId } from "../../typings/i10n.ts";
import { getString } from "../utils/locale.ts";
import {
  getOutputFolder,
  getVaultPath,
  openCard,
  validateVault,
} from "./annotation-card.ts";

const preferenceRoot = "extensions.zotero.zoteroobsidianbridge";
const companionStatusFilename = "bridge-status.json";
const companionHeartbeatMaxAgeSeconds = 15;
const companionWriteCheckMaxAgeSeconds = 24 * 60 * 60;
const syncStateMessages = {
  pending: "pref-sync-state-pending",
  running: "pref-sync-state-running",
  done: "pref-sync-state-done",
  retry: "pref-sync-state-retry",
  conflict: "pref-sync-state-conflict",
} as const satisfies Record<SyncTaskStatus, FluentMessageId>;
let writerTransitionActive = false;
let writerTransitionSource: "direct" | "companion" | null = null;

function absoluteQueuePath(): string {
  const value = Zotero.Prefs.get(`${preferenceRoot}.companionQueuePath`, true);
  const queuePath = typeof value === "string" ? value.trim() : "";
  if (!queuePath || !PathUtils.isAbsolute(queuePath)) {
    throw new Error("Set an absolute local request queue folder first.");
  }
  return PathUtils.normalize(queuePath);
}

interface CompanionStatus {
  schema: 1;
  protocolVersion: number;
  vaultId: string;
  outputFolder: string;
  vaultPathHash: string;
  lastSeenAt: string;
  lastVaultWriteCheck?: { at: string; success: boolean; errorType?: string };
}

function normalizedAbsolutePath(value: string): string {
  return PathUtils.normalize(value).replace(/[\\/]+$/, "");
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readCompanionStatus(): Promise<{
  queueState: "available" | "unavailable" | "not-configured";
  status: CompanionStatus | null;
  heartbeatAgeSeconds: number | null;
}> {
  const value = Zotero.Prefs.get(`${preferenceRoot}.companionQueuePath`, true);
  const queuePath = typeof value === "string" ? value.trim() : "";
  if (!queuePath || !PathUtils.isAbsolute(queuePath)) {
    return {
      queueState: "not-configured",
      status: null,
      heartbeatAgeSeconds: null,
    };
  }
  const queue = Zotero.File.pathToFile(queuePath);
  if (!queue.exists() || !queue.isDirectory() || !queue.isWritable()) {
    return {
      queueState: "unavailable",
      status: null,
      heartbeatAgeSeconds: null,
    };
  }
  const statusPath = PathUtils.join(queuePath, companionStatusFilename);
  if (!(await IOUtils.exists(statusPath))) {
    return {
      queueState: "available",
      status: null,
      heartbeatAgeSeconds: null,
    };
  }
  const valueFromDisk = await IOUtils.readJSON(statusPath);
  if (
    !valueFromDisk ||
    valueFromDisk.schema !== 1 ||
    typeof valueFromDisk.protocolVersion !== "number" ||
    typeof valueFromDisk.vaultId !== "string" ||
    typeof valueFromDisk.outputFolder !== "string" ||
    typeof valueFromDisk.vaultPathHash !== "string" ||
    typeof valueFromDisk.lastSeenAt !== "string"
  ) {
    throw new Error("Companion status file is malformed; no data was changed.");
  }
  const status = valueFromDisk as CompanionStatus;
  const lastSeen = Date.parse(status.lastSeenAt);
  return {
    queueState: "available",
    status,
    heartbeatAgeSeconds: Number.isFinite(lastSeen)
      ? Math.max(0, Math.floor((Date.now() - lastSeen) / 1000))
      : null,
  };
}

function formatSetupError(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return getString("pref-setup-error", { args: { reason } });
}

async function checkSetup(
  statusElement: HTMLElement,
  vaultInput: HTMLInputElement,
  outputInput: HTMLInputElement,
): Promise<void> {
  statusElement.textContent = getString("pref-checking-setup");
  statusElement.setAttribute("data-state", "running");
  try {
    const vaultPath = vaultInput.value.trim();
    await validateVault(vaultPath);
    const outputFolder = validateVaultRelativePath(outputInput.value);
    const writerMode =
      Zotero.Prefs.get(`${preferenceRoot}.writerMode`, true) === "companion"
        ? "companion"
        : "direct";

    if (writerMode === "direct") {
      const probeRelativePath = `${outputFolder}/.zotero-bridge-check-${crypto.randomUUID()}.md`;
      const probeContent = `Zotero Bridge setup check ${crypto.randomUUID()}`;
      let created = false;
      try {
        await createExclusiveVaultFile(
          vaultPath,
          probeRelativePath,
          probeContent,
        );
        created = true;
        const written = await readVaultFile(vaultPath, probeRelativePath);
        if (written !== probeContent) {
          throw new Error(
            "Vault write check did not round-trip the temporary file.",
          );
        }
      } finally {
        if (created) {
          await IOUtils.remove(resolveVaultPath(vaultPath, probeRelativePath), {
            ignoreAbsent: true,
          });
        }
      }
      statusElement.textContent = getString("pref-setup-direct-ok");
      statusElement.setAttribute("data-state", "success");
      return;
    }

    const configuredVaultId = Zotero.Prefs.get(
      `${preferenceRoot}.companionVaultId`,
      true,
    );
    if (!isValidCompanionVaultId(configuredVaultId)) {
      throw new Error(getString("pref-setup-companion-pairing"));
    }
    const companion = await readCompanionStatus();
    if (companion.queueState !== "available") {
      throw new Error("The shared companion queue folder is not available.");
    }
    if (
      !companion.status ||
      companion.heartbeatAgeSeconds === null ||
      companion.heartbeatAgeSeconds > companionHeartbeatMaxAgeSeconds
    ) {
      throw new Error(getString("pref-setup-companion-stale"));
    }
    if (
      companion.status.protocolVersion !== COMPANION_PROTOCOL_VERSION ||
      companion.status.vaultId !== configuredVaultId
    ) {
      throw new Error(getString("pref-setup-companion-pairing"));
    }
    if (
      companion.status.outputFolder !== outputFolder ||
      companion.status.vaultPathHash !==
        (await sha256Text(normalizedAbsolutePath(vaultPath)))
    ) {
      throw new Error(getString("pref-setup-companion-folder"));
    }
    const writeCheckAt = Date.parse(
      companion.status.lastVaultWriteCheck?.at ?? "",
    );
    const writeCheckFresh =
      Number.isFinite(writeCheckAt) &&
      Date.now() - writeCheckAt <= companionWriteCheckMaxAgeSeconds * 1000;
    if (!companion.status.lastVaultWriteCheck?.success || !writeCheckFresh) {
      statusElement.textContent = getString("pref-setup-companion-write-check");
      statusElement.setAttribute("data-state", "warning");
      return;
    }
    statusElement.textContent = getString("pref-setup-companion-ok");
    statusElement.setAttribute("data-state", "success");
  } catch (error) {
    statusElement.textContent = formatSetupError(error);
    statusElement.setAttribute("data-state", "error");
  }
}

function exportDiagnostics(window: Window): void {
  const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
    Ci.nsIFilePicker,
  );
  const browsingContext = (
    window as Window & { browsingContext: BrowsingContext }
  ).browsingContext;
  picker.init(
    browsingContext,
    "Export Zotero Obsidian Bridge diagnostics",
    picker.modeSave as nsIFilePicker.Mode,
  );
  picker.defaultString = `zotero-obsidian-bridge-diagnostics-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;
  picker.appendFilter("JSON", "*.json");
  picker.open({
    done(result) {
      if (result !== picker.returnOK) return;
      void (async () => {
        const sync = await getSyncStatus();
        const companion = await readCompanionStatus().catch(() => ({
          queueState: "unavailable" as const,
          status: null,
          heartbeatAgeSeconds: null,
        }));
        const mode =
          Zotero.Prefs.get(`${preferenceRoot}.writerMode`, true) === "companion"
            ? "companion"
            : "direct";
        const vaultId = Zotero.Prefs.get(
          `${preferenceRoot}.companionVaultId`,
          true,
        );
        const report = createDiagnosticReport({
          generatedAt: new Date().toISOString(),
          appVersion: Zotero.version,
          pluginVersion: packageMetadata.version,
          writerMode: mode,
          companion: {
            configured:
              isValidCompanionVaultId(vaultId) &&
              companion.queueState === "available",
            heartbeatAgeSeconds: companion.heartbeatAgeSeconds,
            queueState: companion.queueState,
          },
          counts: sync.counts,
          tasks: sync.tasks,
        });
        await IOUtils.writeUTF8(
          picker.file.path,
          JSON.stringify(report, null, 2),
          {
            mode: "overwrite",
            flush: true,
          },
        );
        window.alert(getString("pref-diagnostics-saved"));
      })().catch((error) => {
        window.alert(
          getString("pref-diagnostics-error", {
            args: {
              reason: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      });
    },
  });
}

async function companionRequestsPending(): Promise<boolean> {
  absoluteQueuePath();
  return hasPendingCompanionRequests();
}

async function changeWriterMode(
  window: Window,
  select: HTMLSelectElement,
  nextMode: "direct" | "companion",
): Promise<void> {
  const root = preferenceRoot;
  const saved = Zotero.Prefs.get(`${root}.writerMode`, true);
  if (writerTransitionActive) {
    select.value = writerTransitionSource ?? "direct";
    return;
  }
  const previousMode = saved === "companion" ? "companion" : "direct";
  if (previousMode === nextMode) return;
  writerTransitionActive = true;
  writerTransitionSource = previousMode;
  try {
    if (nextMode === "companion" || previousMode === "companion") {
      absoluteQueuePath();
    }
    if (nextMode === "companion") {
      const vaultId = Zotero.Prefs.get(`${root}.companionVaultId`, true);
      if (!isValidCompanionVaultId(vaultId)) {
        throw new Error(
          "Enter the Vault pairing ID shown in Obsidian before enabling companion mode.",
        );
      }
    }
    await transitionWriterMode(previousMode, nextMode, {
      setMode: (mode) => Zotero.Prefs.set(`${root}.writerMode`, mode, true),
      waitForWrites: waitForVaultWrites,
      requestsPending: companionRequestsPending,
    });
    select.value = nextMode;
  } catch (error) {
    select.value = previousMode;
    window.alert(String(error));
  } finally {
    writerTransitionActive = false;
    writerTransitionSource = null;
  }
}

export function bindVaultPathPreference(
  window: Window,
  inputID: string,
  prefName: string,
): void {
  const input = window.document.getElementById(
    inputID,
  ) as HTMLInputElement | null;
  if (!input) return;

  const savedPath = Zotero.Prefs.get(prefName, true);
  input.value = typeof savedPath === "string" ? savedPath : "";
  input.addEventListener("change", () => {
    Zotero.Prefs.set(prefName, input.value.trim(), true);
  });
}

export function bindBridgePreferences(window: Window): void {
  const root = `extensions.zotero.zoteroobsidianbridge`;
  const vaultInput = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-vaultPath",
  ) as HTMLInputElement | null;
  const outputInput = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-outputFolder",
  ) as HTMLInputElement | null;
  const writerMode = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-writerMode",
  ) as HTMLSelectElement | null;
  const queuePath = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-companionQueuePath",
  ) as HTMLInputElement | null;
  const companionVaultId = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-companionVaultId",
  ) as HTMLInputElement | null;
  const preview = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-outputPreview",
  );
  const browse = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-browseVault",
  );
  if (!vaultInput || !outputInput || !preview || !browse) return;
  const status = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-syncStatus",
  );
  const taskActions = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-syncTaskActions",
  );
  const setupStatus = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-setupStatus",
  );
  const checkSetupButton = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-checkSetup",
  );
  const exportDiagnosticsButton = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-exportDiagnostics",
  );
  const refreshStatus = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-refreshStatus",
  );
  const retrySync = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-retrySync",
  );
  const reconcile = window.document.getElementById(
    "zotero-prefpane-zoteroobsidianbridge-reconcile",
  );

  const vaultPath = Zotero.Prefs.get(`${root}.vaultPath`, true);
  const outputFolder = Zotero.Prefs.get(`${root}.outputFolder`, true);
  vaultInput.value = typeof vaultPath === "string" ? vaultPath : "";
  outputInput.value =
    typeof outputFolder === "string" && outputFolder.trim()
      ? outputFolder
      : "Zotero Literature";
  let savedMode = Zotero.Prefs.get(`${root}.writerMode`, true);
  if (writerMode) {
    if (savedMode === "transition") {
      savedMode = "companion";
      Zotero.Prefs.set(`${root}.writerMode`, "companion", true);
    }
    writerMode.value = savedMode === "companion" ? "companion" : "direct";
    writerMode.addEventListener("change", () => {
      void changeWriterMode(
        window,
        writerMode,
        writerMode.value === "companion" ? "companion" : "direct",
      );
    });
  }
  const savedQueuePath = Zotero.Prefs.get(`${root}.companionQueuePath`, true);
  if (queuePath) {
    queuePath.value = typeof savedQueuePath === "string" ? savedQueuePath : "";
    queuePath.addEventListener("change", () => {
      queuePath.value = queuePath.value.trim();
      if (Zotero.Prefs.get(`${root}.writerMode`, true) !== "direct") {
        const current = Zotero.Prefs.get(`${root}.companionQueuePath`, true);
        queuePath.value = typeof current === "string" ? current : "";
        window.alert(
          "Switch to direct writer mode and drain the queue before changing the queue folder.",
        );
        return;
      }
      Zotero.Prefs.set(`${root}.companionQueuePath`, queuePath.value, true);
    });
  }
  if (companionVaultId) {
    const savedVaultId = Zotero.Prefs.get(`${root}.companionVaultId`, true);
    companionVaultId.value =
      typeof savedVaultId === "string" ? savedVaultId : "";
    companionVaultId.addEventListener("change", () => {
      companionVaultId.value = companionVaultId.value.trim();
      if (Zotero.Prefs.get(`${root}.writerMode`, true) !== "direct") {
        const current = Zotero.Prefs.get(`${root}.companionVaultId`, true);
        companionVaultId.value = typeof current === "string" ? current : "";
        window.alert(
          "Switch to direct writer mode before changing Vault pairing.",
        );
        return;
      }
      Zotero.Prefs.set(
        `${root}.companionVaultId`,
        companionVaultId.value,
        true,
      );
    });
  }

  const updatePreview = () => {
    const base = vaultInput.value.trim().replace(/[\\/]+$/, "");
    const relative = outputInput.value.trim().replace(/\\/g, "/");
    preview.textContent = base && relative ? `${base}/${relative}` : "";
  };

  vaultInput.addEventListener("change", () => {
    vaultInput.value = vaultInput.value.trim();
    Zotero.Prefs.set(`${root}.vaultPath`, vaultInput.value, true);
    updatePreview();
  });
  outputInput.addEventListener("change", () => {
    outputInput.value = outputInput.value.trim();
    if (Zotero.Prefs.get(`${root}.writerMode`, true) !== "direct") {
      const current = Zotero.Prefs.get(`${root}.outputFolder`, true);
      outputInput.value =
        typeof current === "string" && current.trim()
          ? current
          : "Zotero Literature";
      window.alert(
        "Switch to direct writer mode and drain the queue before changing the output folder.",
      );
      updatePreview();
      return;
    }
    Zotero.Prefs.set(`${root}.outputFolder`, outputInput.value, true);
    updatePreview();
  });
  vaultInput.addEventListener("input", updatePreview);
  outputInput.addEventListener("input", updatePreview);
  browse.addEventListener("click", () => {
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
      Ci.nsIFilePicker,
    );
    const browsingContext = (
      window as Window & { browsingContext: BrowsingContext }
    ).browsingContext;
    picker.init(
      browsingContext,
      "Choose Obsidian vault",
      picker.modeGetFolder as nsIFilePicker.Mode,
    );
    const currentPath = vaultInput.value.trim();
    if (currentPath) {
      const currentFolder = Zotero.File.pathToFile(currentPath);
      if (currentFolder.exists() && currentFolder.isDirectory()) {
        picker.displayDirectory = currentFolder;
      }
    }
    picker.open({
      done(result) {
        if (result !== picker.returnOK) return;
        vaultInput.value = picker.file.path;
        vaultInput.dispatchEvent(new window.Event("change"));
      },
    });
  });

  const updateSyncStatus = async () => {
    if (!status) return;
    const result = await getSyncStatus();
    const { counts } = result;
    const lines = [
      getString("pref-sync-counts", {
        args: {
          pending: counts.pending,
          running: counts.running,
          retry: counts.retry,
          conflict: counts.conflict,
        },
      }),
    ];
    if (result.error) lines.unshift(`Queue error: ${result.error}`);
    status.textContent = lines.join("\n\n");
    if (!taskActions) return;
    taskActions.replaceChildren();
    for (const task of result.tasks) {
      const row = window.document.createElement("div");
      row.style.cssText =
        "display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:8px 0;";
      const description = window.document.createElement("div");
      description.style.cssText =
        "flex:1 1 280px; min-width:0; white-space:pre-wrap;";
      const category = classifyDiagnosticError(task.lastError ?? "");
      let relativePath: string | null = null;
      try {
        relativePath = await findCardByFrontmatter(
          getVaultPath(),
          getOutputFolder(),
          "bridge_source_id",
          task.sourceID,
        );
      } catch {
        relativePath = null;
      }
      const location = relativePath ?? getString("pref-sync-card-missing");
      description.textContent =
        `${getString("pref-sync-task", {
          args: { status: getString(syncStateMessages[task.status]), location },
        })}\n` +
        getString("pref-sync-next-step", {
          args: { guidance: getString(diagnosticGuidanceMessages[category]) },
        });
      row.append(description);
      if (relativePath) {
        const openButton = window.document.createElement("button");
        openButton.type = "button";
        openButton.textContent = getString("pref-sync-open-card");
        openButton.addEventListener("click", () => {
          void openCard(getVaultPath(), relativePath!).catch((error) =>
            window.alert(String(error)),
          );
        });
        row.append(openButton);
      }
      const retryButton = window.document.createElement("button");
      retryButton.type = "button";
      retryButton.textContent = getString("pref-sync-retry-one");
      retryButton.addEventListener("click", () => {
        retryButton.disabled = true;
        void retrySyncTask(task.sourceID)
          .then(updateSyncStatus)
          .catch((error) => {
            retryButton.disabled = false;
            window.alert(String(error));
          });
      });
      row.append(retryButton);
      taskActions.append(row);
    }
  };

  refreshStatus?.addEventListener("click", () => void updateSyncStatus());
  retrySync?.addEventListener("click", () => {
    void retryFailedSyncTasks().then(updateSyncStatus);
  });
  reconcile?.addEventListener("click", () => {
    void reconcileLinkedCards().then(updateSyncStatus);
  });
  checkSetupButton?.addEventListener("click", () => {
    if (setupStatus) {
      void checkSetup(setupStatus as HTMLElement, vaultInput, outputInput);
    }
  });
  exportDiagnosticsButton?.addEventListener("click", () =>
    exportDiagnostics(window),
  );

  bindAutoEnrollmentPreferences(window, root);
  updatePreview();
  void updateSyncStatus();
}

function bindAutoEnrollmentPreferences(window: Window, root: string): void {
  const byID = <T extends HTMLElement>(suffix: string) =>
    window.document.getElementById(
      `zotero-prefpane-zoteroobsidianbridge-${suffix}`,
    ) as T | null;
  const enabled = byID<HTMLInputElement>("autoEnabled");
  const paused = byID<HTMLInputElement>("autoPaused");
  const librarySelect = byID<HTMLSelectElement>("scopeLibrary");
  const kindSelect = byID<HTMLSelectElement>("scopeKind");
  const collections = byID<HTMLSelectElement>("scopeCollections");
  const tags = byID<HTMLSelectElement>("scopeTags");
  const descendants = byID<HTMLInputElement>("scopeDescendants");
  const addScope = byID<HTMLButtonElement>("addScope");
  const scopeList = byID<HTMLDivElement>("scopeList");
  const preview = byID<HTMLButtonElement>("previewScopes");
  const importHistory = byID<HTMLButtonElement>("importHistory");
  const resume = byID<HTMLButtonElement>("resumeBatch");
  const cancel = byID<HTMLButtonElement>("cancelBatch");
  const retry = byID<HTMLButtonElement>("retryAuto");
  const status = byID<HTMLPreElement>("autoStatus");
  if (
    !enabled ||
    !paused ||
    !librarySelect ||
    !kindSelect ||
    !collections ||
    !tags ||
    !descendants ||
    !addScope ||
    !scopeList ||
    !preview ||
    !importHistory ||
    !resume ||
    !cancel ||
    !retry ||
    !status
  ) {
    return;
  }

  let config: AutoEnrollmentConfig;
  try {
    config = getAutoEnrollmentConfig();
  } catch (error) {
    status.textContent = `Settings error: ${String(error)}`;
    return;
  }

  const libraries = Zotero.Libraries.getAll().filter(
    (library) => library.libraryType !== "feed",
  );
  const libraryByID = new Map(
    libraries.map((library) => [library.libraryID, library]),
  );
  for (const library of libraries) {
    const option = window.document.createElement("option");
    option.value = String(library.libraryID);
    option.textContent = `${library.name} (${library.libraryType})`;
    librarySelect.append(option);
  }
  librarySelect.disabled = libraries.length === 0;

  const scopeDescription = (scope: AutoEnrollmentScope): string => {
    const library = libraryByID.get(scope.libraryID);
    const name = library?.name ?? `Library ${scope.libraryID}`;
    if (scope.wholeLibrary) return `${name}: entire library`;
    const collectionNames = scope.collectionKeys.map((key) => {
      const collection = Zotero.Collections.getByLibrary(
        scope.libraryID,
        true,
      ).find((candidate) => candidate.key === key);
      return collection?.name ?? key;
    });
    const parts = [
      collectionNames.length
        ? `collections [${collectionNames.join(", ")}]`
        : "",
      scope.tagNames.length ? `tags [${scope.tagNames.join(", ")}]` : "",
    ].filter(Boolean);
    const joiner =
      scope.collectionKeys.length && scope.tagNames.length ? " AND " : " OR ";
    return `${name}: ${parts.join(joiner)}${scope.includeSubcollections ? " (including subcollections)" : ""}`;
  };

  const renderScopes = () => {
    scopeList.replaceChildren();
    if (config.scopes.length === 0) {
      const empty = window.document.createElement("p");
      empty.textContent =
        "No automatic scope selected. Nothing will be enrolled.";
      scopeList.append(empty);
      return;
    }
    config.scopes.forEach((scope, index) => {
      const row = window.document.createElement("div");
      row.style.cssText =
        "display:flex; gap:8px; align-items:center; margin:4px 0;";
      const label = window.document.createElement("span");
      label.textContent = scopeDescription(scope);
      const remove = window.document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        config.scopes.splice(index, 1);
        void persistConfig();
      });
      row.append(label, remove);
      scopeList.append(row);
    });
  };

  const populateScopeOptions = async () => {
    const libraryID = Number(librarySelect.value);
    collections.replaceChildren();
    tags.replaceChildren();
    if (!Number.isSafeInteger(libraryID) || !libraryByID.has(libraryID)) return;
    const collectionItems = Zotero.Collections.getByLibrary(libraryID, true);
    const collectionByID = new Map(
      collectionItems.map((collection) => [collection.id, collection]),
    );
    const pathFor = (collection: Zotero.Collection): string => {
      const path: string[] = [collection.name];
      let parentID = collection.parentID;
      const seen = new Set<number>();
      while (parentID && !seen.has(parentID)) {
        seen.add(parentID);
        const parent = collectionByID.get(parentID);
        if (!parent) break;
        path.unshift(parent.name);
        parentID = parent.parentID;
      }
      return path.join(" / ");
    };
    for (const collection of collectionItems.sort((a, b) =>
      pathFor(a).localeCompare(pathFor(b)),
    )) {
      const option = window.document.createElement("option");
      option.value = collection.key;
      option.textContent = pathFor(collection);
      collections.append(option);
    }
    try {
      const tagNames = await Zotero.Tags.getAll(libraryID, [0]);
      for (const tag of tagNames.sort((a, b) => a.tag.localeCompare(b.tag))) {
        const option = window.document.createElement("option");
        option.value = tag.tag;
        option.textContent = tag.tag;
        tags.append(option);
      }
    } catch (error) {
      status.textContent = `Could not read tags from this library: ${String(error)}`;
    }
  };

  const updateSelectionControls = () => {
    const kind = kindSelect.value;
    collections.hidden = kind !== "collections" && kind !== "both";
    tags.hidden = kind !== "tags" && kind !== "both";
    descendants.hidden = kind !== "collections" && kind !== "both";
    const row = byID<HTMLElement>("scopeDescendantsRow");
    if (row) row.hidden = descendants.hidden;
  };

  const refreshStatus = async () => {
    try {
      const state = await getAutoEnrollmentState();
      const batch = state.batch;
      const lines = [
        `Automatic enrollment: ${config.enabled ? "enabled" : "off"}${config.paused ? " (paused)" : ""}`,
        `Configured scopes: ${config.scopes.length}`,
        `Automatic queue: ${state.pending.length} pending, ${state.current ? 1 : 0} in progress, ${state.failed.length} failed`,
      ];
      if (state.current) {
        lines.push(
          `Processing: ${state.current.libraryID}/${state.current.key}`,
        );
      }
      for (const pending of state.pending.slice(0, 20)) {
        lines.push(`Queued: ${pending.libraryID}/${pending.key}`);
      }
      if (state.pending.length > 20) {
        lines.push(`... and ${state.pending.length - 20} more queued item(s)`);
      }
      for (const failed of state.failed) {
        lines.push(`Failed ${failed.libraryID}/${failed.key}: ${failed.error}`);
      }
      if (batch) {
        lines.push(
          `Historical batch: ${batch.status}, ${batch.cursor}/${batch.refs.length} processed, ${batch.refs.length - batch.cursor} remaining`,
        );
        if (batch.lastError) lines.push(`Batch error: ${batch.lastError}`);
      } else {
        lines.push("Historical batch: none");
      }
      status.textContent = lines.join("\n");
      resume.disabled =
        !batch || batch.status === "completed" || batch.status === "running";
      cancel.disabled = !batch || batch.status !== "running";
      retry.disabled = state.failed.length === 0;
    } catch (error) {
      status.textContent = `Could not read enrollment state: ${String(error)}`;
    }
  };

  const persistConfig = async () => {
    try {
      await saveAutoEnrollmentConfig(config);
      renderScopes();
      await refreshStatus();
    } catch (error) {
      window.alert(String(error));
    }
  };

  enabled.checked = config.enabled;
  paused.checked = config.paused;
  enabled.addEventListener("change", () => {
    if (enabled.checked && config.scopes.length === 0) {
      enabled.checked = false;
      window.alert(
        "Add and preview at least one scope before enabling automatic enrollment.",
      );
      return;
    }
    config.enabled = enabled.checked;
    void persistConfig();
  });
  paused.addEventListener("change", () => {
    config.paused = paused.checked;
    void persistConfig();
  });
  librarySelect.addEventListener("change", () => void populateScopeOptions());
  kindSelect.addEventListener("change", updateSelectionControls);
  addScope.addEventListener("click", () => {
    const libraryID = Number(librarySelect.value);
    const kind = kindSelect.value;
    const collectionKeys =
      kind === "collections" || kind === "both"
        ? [...collections.selectedOptions].map(
            (option) => (option as HTMLOptionElement).value,
          )
        : [];
    const tagNames =
      kind === "tags" || kind === "both"
        ? [...tags.selectedOptions].map(
            (option) => (option as HTMLOptionElement).value,
          )
        : [];
    if (
      !Number.isSafeInteger(libraryID) ||
      !libraryByID.has(libraryID) ||
      ((kind === "collections" || kind === "both") && !collectionKeys.length) ||
      ((kind === "tags" || kind === "both") && !tagNames.length)
    ) {
      window.alert(
        "Choose a library and the required collection/tag values first.",
      );
      return;
    }
    const scope: AutoEnrollmentScope = {
      libraryID,
      wholeLibrary: kind === "library",
      collectionKeys,
      tagNames,
      includeSubcollections: collectionKeys.length > 0 && descendants.checked,
    };
    if (
      config.scopes.some(
        (existing) => JSON.stringify(existing) === JSON.stringify(scope),
      )
    ) {
      return;
    }
    addScope.disabled = true;
    void previewAutoEnrollmentConfig({
      ...config,
      scopes: [...config.scopes, scope],
    })
      .then((impact) => {
        const accepted = window.confirm(
          `This rule currently matches ${impact.annotations} saved annotations (${impact.alreadyLinked} indexed, about ${impact.estimatedNew} not indexed). Saving the rule will not import them; only newly added annotations are automatically enrolled. Save this scope?`,
        );
        if (!accepted) return;
        config.scopes.push(scope);
        void persistConfig();
      })
      .catch((error) => window.alert(String(error)))
      .finally(() => {
        addScope.disabled = false;
      });
  });

  preview.addEventListener("click", () => {
    void previewAutoEnrollmentScopes()
      .then((result) => {
        status.textContent =
          `Impact preview (rules are unioned; selected collections/tags within a rule are OR, collection+tag dimensions are AND):\n` +
          `${result.annotations} matching annotations\n` +
          `${result.alreadyLinked} already indexed\n` +
          `${result.estimatedNew} estimated new cards\n` +
          `Saving rules does not backfill existing annotations.`;
      })
      .catch((error) => window.alert(String(error)));
  });
  importHistory.addEventListener("click", () => {
    void previewAutoEnrollmentScopes()
      .then((result) => {
        if (!result.annotations) {
          window.alert("No saved annotations match the configured scopes.");
          return;
        }
        const accepted = window.confirm(
          `Queue ${result.annotations} historical annotations? About ${result.estimatedNew} cards are not currently indexed. Existing cards will be reused and personal notes preserved. This does not change your Zotero items.`,
        );
        if (!accepted) return;
        void startHistoricalImport()
          .then(refreshStatus)
          .catch((error) => window.alert(String(error)));
      })
      .catch((error) => window.alert(String(error)));
  });
  resume.addEventListener("click", () => {
    void resumeHistoricalImport()
      .then(refreshStatus)
      .catch((error) => window.alert(String(error)));
  });
  cancel.addEventListener("click", () => {
    void cancelHistoricalImport().then(refreshStatus);
  });
  retry.addEventListener("click", () => {
    void retryFailedAutoEnrollment()
      .then(refreshStatus)
      .catch((error) => window.alert(String(error)));
  });

  renderScopes();
  updateSelectionControls();
  if (libraries.length) void populateScopeOptions();
  void refreshStatus();
  const timer = window.setInterval(() => void refreshStatus(), 1000);
  window.addEventListener("unload", () => window.clearInterval(timer), {
    once: true,
  });
}
