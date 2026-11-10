type DiagnosticSection = "projection" | "overlay" | "helper" | "ipc";

interface DiagnosticSnapshot {
  schema: 1;
  updatedAt: string;
  projection?: Record<string, unknown>;
  overlay?: Record<string, unknown>;
  helper?: Record<string, unknown>;
  ipc?: Record<string, unknown>;
}

let snapshot: DiagnosticSnapshot = {
  schema: 1,
  updatedAt: new Date().toISOString(),
};
let flushTimer: number | undefined;
let writing = Promise.resolve();
let ipcWriting = Promise.resolve();
let ipcFlushTimer: number | undefined;
let ackWriting = Promise.resolve();
let ackFlushTimer: number | undefined;
let latestRenderedAck: Record<string, unknown> | undefined;
let renderedAckCount = 0;
const ipcInstanceID = crypto.randomUUID();
const ipcEvents: Record<string, unknown>[] = [];
const SNAPSHOT_FLUSH_MS = 500;
const TRACE_FLUSH_MS = 500;
const ACK_FLUSH_MS = 500;

function diagnosticPath(): string | undefined {
  try {
    return PathUtils.join(
      PathUtils.profileDir,
      "zotero-obsidian-bridge",
      "desktop-edge-diagnostics.json",
    );
  } catch {
    return undefined;
  }
}

function scheduleFlush(): void {
  if (flushTimer !== undefined) return;
  flushTimer = globalThis.setTimeout(() => {
    flushTimer = undefined;
    const path = diagnosticPath();
    if (!path) return;
    const value = {
      ...snapshot,
      updatedAt: new Date().toISOString(),
    };
    const directory = PathUtils.parent(path);
    if (!directory) return;
    writing = writing
      .catch(() => undefined)
      .then(async () => {
        await IOUtils.makeDirectory(directory, {
          createAncestors: true,
          ignoreExisting: true,
          permissions: 0o700,
        });
        await IOUtils.writeJSON(path, value, {
          mode: "overwrite",
          tmpPath: `${path}.${crypto.randomUUID()}.tmp`,
          flush: true,
        });
      })
      .catch(() => undefined);
  }, SNAPSHOT_FLUSH_MS) as unknown as number;
}

async function persistJSON(
  path: string,
  value: Record<string, unknown>,
): Promise<void> {
  const directory = PathUtils.parent(path);
  if (!directory) return;
  await IOUtils.makeDirectory(directory, {
    createAncestors: true,
    ignoreExisting: true,
    permissions: 0o700,
  });
  await IOUtils.writeJSON(path, value, {
    mode: "overwrite",
    tmpPath: `${path}.${crypto.randomUUID()}.tmp`,
    flush: true,
  });
}

function scheduleIpcFlush(): void {
  if (ipcFlushTimer !== undefined) return;
  ipcFlushTimer = globalThis.setTimeout(() => {
    ipcFlushTimer = undefined;
    let path: string;
    try {
      path = PathUtils.join(
        PathUtils.profileDir,
        "zotero-obsidian-bridge",
        `desktop-edge-ipc-${ipcInstanceID}.json`,
      );
    } catch {
      return;
    }
    const record = {
      schema: 1,
      instanceID: ipcInstanceID,
      updatedAt: new Date().toISOString(),
      events: [...ipcEvents],
    };
    ipcWriting = ipcWriting
      .catch(() => undefined)
      .then(() => persistJSON(path, record))
      .catch(() => undefined);
  }, TRACE_FLUSH_MS) as unknown as number;
}

function scheduleAckFlush(): void {
  if (ackFlushTimer !== undefined) return;
  ackFlushTimer = globalThis.setTimeout(() => {
    ackFlushTimer = undefined;
    const value = latestRenderedAck;
    if (!value) return;
    let path: string;
    try {
      path = PathUtils.join(
        PathUtils.profileDir,
        "zotero-obsidian-bridge",
        "desktop-edge-rendered-ack.json",
      );
    } catch {
      return;
    }
    ackWriting = ackWriting
      .catch(() => undefined)
      .then(() => persistJSON(path, value))
      .catch(() => undefined);
  }, ACK_FLUSH_MS) as unknown as number;
}

/** Temporary, content-free diagnostics for the isolated desktop overlay test. */
export function recordDesktopEdgeDiagnostics(
  section: DiagnosticSection,
  value: Record<string, unknown>,
): void {
  snapshot = {
    ...snapshot,
    [section]: value,
    updatedAt: new Date().toISOString(),
  };
  scheduleFlush();
}

/** Persist the native render ACK independently from the replaceable snapshot. */
export function recordDesktopEdgeRenderedAck(
  value: Record<string, unknown>,
): void {
  try {
    latestRenderedAck = {
      schema: 1,
      updatedAt: new Date().toISOString(),
      ...value,
      ackCount: ++renderedAckCount,
    };
    scheduleAckFlush();
  } catch {
    // Diagnostic persistence must not interrupt native ACK handling.
  }
}

/** Keep IPC traces separate because Zotero windows have independent JS globals. */
export function recordDesktopEdgeIpcEvent(
  value: Record<string, unknown>,
): void {
  try {
    ipcEvents.push({ at: new Date().toISOString(), ...value });
    if (ipcEvents.length > 40) ipcEvents.splice(0, ipcEvents.length - 40);
    scheduleIpcFlush();
  } catch {
    // Diagnostics must not change overlay lifecycle behavior.
  }
}
