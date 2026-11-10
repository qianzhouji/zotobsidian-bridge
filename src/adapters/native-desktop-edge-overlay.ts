import type {
  DesktopEdgeOverlayHost,
  DesktopOverlayCurve,
  DesktopOverlayDisplay,
  DesktopOverlaySurface,
} from "./desktop-edge-overlay.ts";
import {
  recordDesktopEdgeDiagnostics,
  recordDesktopEdgeIpcEvent,
} from "./desktop-edge-diagnostics.ts";
import {
  DESKTOP_OVERLAY_PROTOCOL_VERSION,
  DesktopOverlayProcessClient,
  type DesktopOverlayChildProcess,
  type DesktopOverlayProcessCapabilities,
  type DesktopOverlaySnapshotAck,
  type DesktopOverlaySnapshotDisplay,
} from "./desktop-overlay-process.ts";

interface NativeOverlayManifest {
  protocolVersion: number;
  sha256: string;
  binary: string;
}

interface NativeOverlayHostOptions {
  platform?: string;
  profileDir?: string;
  processID?: number;
  resourceBaseURL?: string;
  fetchResource?: typeof fetch;
  launch?: (
    path: string,
    parentPID: number,
  ) => Promise<DesktopOverlayChildProcess>;
  writeExecutable?: (sha256: string, bytes: Uint8Array) => Promise<string>;
  removeExecutable?: (path: string) => Promise<void>;
  onFailure?: (error: Error) => void;
  onSnapshotAck?: (ack: DesktopOverlaySnapshotAck) => void;
}

function hexDigest(buffer: ArrayBuffer | ArrayBufferView): Promise<string> {
  const source =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return crypto.subtle
    .digest("SHA-256", copy.buffer)
    .then((digest) =>
      [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(""),
    );
}

function isManifest(value: unknown): value is NativeOverlayManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<NativeOverlayManifest>;
  return (
    manifest.protocolVersion === DESKTOP_OVERLAY_PROTOCOL_VERSION &&
    typeof manifest.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(manifest.sha256) &&
    manifest.binary === "desktop-overlay-helper"
  );
}

async function loadPackagedHelper(options: NativeOverlayHostOptions): Promise<{
  manifest: NativeOverlayManifest;
  bytes: Uint8Array;
}> {
  const fetchResource = options.fetchResource ?? fetch;
  const base =
    options.resourceBaseURL ??
    "chrome://zoteroobsidianbridge/content/native/macos";
  const manifestResponse = await fetchResource(`${base}/manifest.json`);
  if (!manifestResponse.ok)
    throw new Error(
      `Native overlay manifest could not be read (${manifestResponse.status}).`,
    );
  const manifestValue: unknown = await manifestResponse.json();
  if (!isManifest(manifestValue))
    throw new Error("Native overlay manifest is incompatible.");

  const binaryResponse = await fetchResource(`${base}/${manifestValue.binary}`);
  if (!binaryResponse.ok)
    throw new Error(
      `Native overlay helper could not be read (${binaryResponse.status}).`,
    );
  const buffer = await binaryResponse.arrayBuffer();
  if (buffer.byteLength < 4096 || buffer.byteLength > 64 * 1024 * 1024)
    throw new Error(
      "Native overlay helper size is outside the accepted bounds.",
    );
  const digest = await hexDigest(buffer);
  if (digest !== manifestValue.sha256)
    throw new Error(
      "Native overlay helper SHA-256 did not match its manifest.",
    );
  return { manifest: manifestValue, bytes: new Uint8Array(buffer) };
}

async function extractExecutable(
  sha256: string,
  bytes: Uint8Array,
  options: NativeOverlayHostOptions,
): Promise<string> {
  if (options.writeExecutable) return options.writeExecutable(sha256, bytes);
  if (!options.profileDir)
    throw new Error("The Zotero profile directory is unavailable.");
  const directory = PathUtils.join(
    options.profileDir,
    "zotero-obsidian-bridge",
    "native-overlay",
  );
  await IOUtils.makeDirectory(directory, {
    createAncestors: true,
    ignoreExisting: true,
    permissions: 0o700,
  });
  const executable = PathUtils.join(
    directory,
    `${sha256}-desktop-overlay-helper`,
  );
  if (await IOUtils.exists(executable)) {
    const existing = await IOUtils.read(executable);
    const digest = await hexDigest(existing);
    if (digest === sha256) {
      await IOUtils.setPermissions(executable, 0o700);
      return executable;
    }
    await IOUtils.remove(executable, { ignoreAbsent: true });
  }
  const temporary = `${executable}.tmp-${crypto.randomUUID()}`;
  try {
    await IOUtils.write(temporary, bytes, { flush: true });
    await IOUtils.setPermissions(temporary, 0o700);
    await IOUtils.move(temporary, executable);
  } finally {
    await IOUtils.remove(temporary, { ignoreAbsent: true }).catch(
      () => undefined,
    );
  }
  return executable;
}

function launchSubprocess(
  path: string,
  parentPID: number,
): Promise<DesktopOverlayChildProcess> {
  const { Subprocess } = ChromeUtils.importESModule(
    "resource://gre/modules/Subprocess.sys.mjs",
  ) as {
    Subprocess: {
      call(options: {
        command: string;
        arguments: string[];
      }): Promise<DesktopOverlayChildProcess>;
    };
  };
  return Subprocess.call({
    command: path,
    arguments: ["--daemon", "--parent-pid", String(parentPID)],
  });
}

class NativeOverlaySurface implements DesktopOverlaySurface {
  private display: DesktopOverlayDisplay;
  private curves: readonly DesktopOverlayCurve[] = [];
  private visible = false;
  private closed = false;
  private readonly host: NativeDesktopEdgeOverlayHost;

  constructor(
    display: DesktopOverlayDisplay,
    host: NativeDesktopEdgeOverlayHost,
  ) {
    this.display = display;
    this.host = host;
  }

  draw(
    display: DesktopOverlayDisplay,
    curves: readonly DesktopOverlayCurve[],
  ): void {
    if (this.closed) throw new Error("The native desktop overlay is closed.");
    this.display = display;
    this.curves = curves;
    recordDesktopEdgeIpcEvent({
      event: "surface-draw",
      displayID: display.id,
      curveCount: curves.length,
    });
    this.host.scheduleSync();
  }

  show(): void {
    if (this.closed) throw new Error("The native desktop overlay is closed.");
    if (this.visible) return;
    this.visible = true;
    recordDesktopEdgeIpcEvent({
      event: "surface-show",
      displayID: this.display.id,
      curveCount: this.curves.length,
    });
    this.host.scheduleSync();
  }

  hide(): void {
    if (this.closed || !this.visible) return;
    this.visible = false;
    this.host.scheduleSync();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.visible = false;
    this.host.removeSurface(this);
  }

  snapshot(): DesktopOverlaySnapshotDisplay {
    return {
      id: this.display.id,
      rect: { ...this.display.rect },
      visible: this.visible,
      curves: this.curves.map((curve) => ({
        id: curve.id,
        from: { ...curve.from },
        control1: { ...curve.control1 },
        control2: { ...curve.control2 },
        to: { ...curve.to },
        startArrow: curve.startArrow,
        endArrow: curve.endArrow,
      })),
    };
  }
}

/** AppKit line windows controlled by a bounded, versioned stdin/stdout protocol. */
export class NativeDesktopEdgeOverlayHost implements DesktopEdgeOverlayHost {
  private readonly options: NativeOverlayHostOptions;
  private readonly surfaces = new Set<NativeOverlaySurface>();
  private readonly processClient: DesktopOverlayProcessClient;
  private readyCapabilities?: DesktopOverlayProcessCapabilities;
  private failureHandler?: (error: Error) => void;
  private executablePath?: string;
  private syncScheduled = false;
  private disposed = false;

  constructor(options: NativeOverlayHostOptions = {}) {
    this.options = options;
    this.failureHandler = options.onFailure;
    this.processClient = new DesktopOverlayProcessClient({
      launch: async () => {
        const { manifest, bytes } = await loadPackagedHelper(options);
        const processID = options.processID ?? Services.appinfo.processID;
        const profileDir = options.profileDir ?? PathUtils.profileDir;
        const path = await extractExecutable(manifest.sha256, bytes, {
          ...options,
          profileDir,
        });
        this.executablePath = path;
        const launch = options.launch ?? launchSubprocess;
        return launch(path, processID);
      },
      onSnapshotAck: (ack) => options.onSnapshotAck?.(ack),
      onFailure: (error) => {
        this.readyCapabilities = undefined;
        for (const surface of this.surfaces) surface.hide();
        this.failureHandler?.(error);
      },
    });
  }

  get capabilities(): DesktopEdgeOverlayHost["capabilities"] {
    const ready = this.readyCapabilities;
    return {
      verified: Boolean(ready),
      transparent: ready?.transparent ?? false,
      nonActivating: ready?.nonActivating ?? false,
      controlledZOrder: Boolean(ready && ready.controlledZOrder),
      systemMousePassthrough: ready?.systemMousePassthrough ?? false,
      tracksNativeDrag: ready?.tracksNativeDrag ?? false,
    };
  }

  setFailureHandler(handler: (error: Error) => void): void {
    this.failureHandler = handler;
  }

  async prepare(): Promise<void> {
    if (this.disposed) throw new Error("The native overlay host is disposed.");
    recordDesktopEdgeIpcEvent({ event: "handshake-start" });
    const platform =
      this.options.platform ??
      (typeof Services === "undefined" ? "" : Services.appinfo.OS);
    if (!/(?:mac|darwin)/i.test(platform))
      throw new Error(
        "The native desktop overlay helper is available only on macOS.",
      );
    this.readyCapabilities = await this.processClient.start();
    recordDesktopEdgeIpcEvent({
      event: "handshake-ready",
      capabilities: this.readyCapabilities,
    });
  }

  open(display: DesktopOverlayDisplay): DesktopOverlaySurface {
    if (!this.readyCapabilities)
      throw new Error(
        "The native desktop overlay helper has not completed its handshake.",
      );
    const surface = new NativeOverlaySurface(display, this);
    this.surfaces.add(surface);
    recordDesktopEdgeIpcEvent({
      event: "surface-open",
      displayID: display.id,
      rect: display.rect,
    });
    return surface;
  }

  removeSurface(surface: NativeOverlaySurface): void {
    this.surfaces.delete(surface);
    this.scheduleSync();
  }

  scheduleSync(): void {
    const blockedReason = this.disposed
      ? "disposed"
      : !this.readyCapabilities
        ? "not-ready"
        : this.syncScheduled
          ? "already-scheduled"
          : undefined;
    if (blockedReason) {
      recordDesktopEdgeIpcEvent({
        event: "sync-skipped",
        reason: blockedReason,
        surfaceCount: this.surfaces.size,
      });
      return;
    }
    this.syncScheduled = true;
    recordDesktopEdgeIpcEvent({
      event: "sync-scheduled",
      surfaceCount: this.surfaces.size,
    });
    globalThis.setTimeout(() => {
      this.syncScheduled = false;
      const earlyExit = this.disposed
        ? "disposed"
        : !this.readyCapabilities
          ? "not-ready"
          : undefined;
      if (earlyExit) {
        recordDesktopEdgeIpcEvent({
          event: "sync-flush-skipped",
          reason: earlyExit,
        });
        return;
      }
      const snapshot = [...this.surfaces].map((surface) => surface.snapshot());
      recordDesktopEdgeIpcEvent({
        event: "sync-flush-start",
        surfaceCount: snapshot.length,
        visibleSurfaceCount: snapshot.filter((display) => display.visible)
          .length,
        curveCount: snapshot.reduce(
          (total, display) => total + display.curves.length,
          0,
        ),
        processState: this.processClient.state,
      });
      recordDesktopEdgeDiagnostics("ipc", {
        event: "snapshot-queued",
        displayCount: snapshot.length,
        visibleDisplayCount: snapshot.filter((display) => display.visible)
          .length,
        curveCount: snapshot.reduce(
          (total, display) => total + display.curves.length,
          0,
        ),
      });
      void this.processClient
        .sendSnapshot(snapshot)
        .then((result) => {
          recordDesktopEdgeIpcEvent({ event: "sync-result", result });
        })
        .catch((error: unknown) => {
          this.readyCapabilities = undefined;
          const failure =
            error instanceof Error ? error : new Error(String(error));
          recordDesktopEdgeDiagnostics("ipc", {
            event: "snapshot-failed",
            error: failure.message.slice(0, 240),
          });
          recordDesktopEdgeIpcEvent({
            event: "sync-failed",
            error: failure.message.slice(0, 240),
          });
          this.failureHandler?.(failure);
        });
    }, 0);
  }

  async stop(): Promise<void> {
    for (const surface of this.surfaces) surface.hide();
    this.surfaces.clear();
    this.readyCapabilities = undefined;
    await this.processClient.stop();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stop();
    if (this.executablePath) {
      const executable = this.executablePath;
      this.executablePath = undefined;
      if (this.options.removeExecutable)
        await this.options.removeExecutable(executable);
      else await IOUtils.remove(executable, { ignoreAbsent: true });
    }
  }
}

export function createNativeDesktopEdgeOverlayHost(
  options: NativeOverlayHostOptions = {},
): NativeDesktopEdgeOverlayHost {
  return new NativeDesktopEdgeOverlayHost(options);
}
