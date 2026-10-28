import type { SyncTaskStatus } from "./models.ts";

export type DiagnosticErrorType =
  | "configuration"
  | "companion"
  | "conflict"
  | "missing-source"
  | "permission"
  | "storage"
  | "unknown";

export const diagnosticGuidanceMessages = {
  configuration: "pref-sync-guide-configuration",
  companion: "pref-sync-guide-companion",
  conflict: "pref-sync-guide-conflict",
  "missing-source": "pref-sync-guide-missing-source",
  permission: "pref-sync-guide-permission",
  storage: "pref-sync-guide-storage",
  unknown: "pref-sync-guide-unknown",
} as const;

export interface DiagnosticTaskInput {
  id: string;
  sourceID: string;
  status: SyncTaskStatus;
  attempts: number;
  updatedAt: string;
  lastError?: string;
}

export function classifyDiagnosticError(value: string): DiagnosticErrorType {
  const message = value.toLowerCase();
  if (/pairing|vault id|protocol|request queue|companion/.test(message)) {
    return "companion";
  }
  if (
    /conflict|changed elsewhere|revision|identity changed|duplicate/.test(
      message,
    )
  ) {
    return "conflict";
  }
  if (/missing|not found|deleted|unavailable/.test(message)) {
    return "missing-source";
  }
  if (/permission|not writable|eacces|denied|read-only/.test(message)) {
    return "permission";
  }
  if (/vault|path|absolute|\.obsidian|output folder|invalid/.test(message)) {
    return "configuration";
  }
  if (/disk|io|write|storage|enoent|eio/.test(message)) return "storage";
  return "unknown";
}

export function diagnosticGuidance(type: DiagnosticErrorType): string {
  switch (type) {
    case "configuration":
      return "Check the Vault folder and Vault-relative output folder in Zotero settings.";
    case "companion":
      return "Open the paired Obsidian Vault, confirm its companion is enabled, and compare the pairing ID and queue folder.";
    case "conflict":
      return "Open the linked card, compare both versions, then choose a version before retrying.";
    case "missing-source":
      return "Confirm the Zotero item and linked Markdown card still exist, then refresh or retry.";
    case "permission":
      return "Check folder permissions and whether the Vault or queue is currently available.";
    case "storage":
      return "Check available disk space and folder access, then retry the pending operation.";
    case "unknown":
      return "Refresh status and retry once; include this diagnostic report if the issue continues.";
  }
}

export function createDiagnosticReport(input: {
  generatedAt: string;
  appVersion: string;
  pluginVersion: string;
  writerMode: "direct" | "companion";
  companion: {
    configured: boolean;
    heartbeatAgeSeconds: number | null;
    queueState: "available" | "unavailable" | "not-configured";
  };
  counts: Record<SyncTaskStatus, number>;
  tasks: DiagnosticTaskInput[];
}) {
  return {
    schema: 1,
    generatedAt: input.generatedAt,
    app: { name: "Zotero", version: input.appVersion },
    plugin: { name: "Zotero Obsidian Bridge", version: input.pluginVersion },
    writerMode: input.writerMode,
    companion: { ...input.companion },
    queue: {
      counts: { ...input.counts },
      failures: input.tasks
        .filter((task) => task.status === "retry" || task.status === "conflict")
        .slice(0, 50)
        .map((task) => ({
          operationId: task.id,
          sourceKind: sourceKind(task.sourceID),
          status: task.status,
          attempts: task.attempts,
          updatedAt: task.updatedAt,
          errorType: classifyDiagnosticError(task.lastError ?? ""),
        })),
    },
    privacy: {
      noteBodiesIncluded: false,
      paperTextIncluded: false,
      absolutePathsIncluded: false,
      rawErrorMessagesIncluded: false,
    },
  };
}

function sourceKind(
  sourceID: string,
): "annotation" | "note" | "paper" | "unknown" {
  const kind = /\/(annotation|note|paper)\//.exec(sourceID)?.[1];
  return kind === "annotation" || kind === "note" || kind === "paper"
    ? kind
    : "unknown";
}
