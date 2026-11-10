import { desktopDisplaysForCurves } from "../adapters/desktop-displays.ts";
import {
  recordDesktopEdgeDiagnostics,
  recordDesktopEdgeIpcEvent,
  recordDesktopEdgeRenderedAck,
} from "../adapters/desktop-edge-diagnostics.ts";
import { DesktopEdgeOverlayManager } from "../adapters/desktop-edge-overlay.ts";
import type { DesktopEdgeOverlayHost } from "../adapters/desktop-edge-overlay.ts";
import { createNativeDesktopEdgeOverlayHost } from "../adapters/native-desktop-edge-overlay.ts";
import type { NativeDesktopEdgeOverlayHost } from "../adapters/native-desktop-edge-overlay.ts";
import type { DesktopEdgeCurve } from "../adapters/desktop-edge-overlay.ts";
import type { DesktopOverlaySnapshotAck } from "../adapters/desktop-overlay-process.ts";

type DesktopEdgeOverlayRuntimeHost = DesktopEdgeOverlayHost &
  Pick<
    NativeDesktopEdgeOverlayHost,
    "prepare" | "setFailureHandler" | "stop" | "dispose"
  >;
type DesktopEdgeOverlayRuntimeHostFactory = (options: {
  onSnapshotAck(ack: DesktopOverlaySnapshotAck): void;
}) => DesktopEdgeOverlayRuntimeHost;

const runtimes = new WeakMap<Window, DesktopEdgeOverlayRuntime>();
const activeRuntimes = new Set<DesktopEdgeOverlayRuntime>();
const IDLE_SHUTDOWN_MS = 2500;

interface GroupState {
  curves: readonly DesktopEdgeCurve[];
  visible: boolean;
}

/** Shared native helper runtime, started lazily and stopped after the last visible group. */
class DesktopEdgeOverlayRuntime {
  private readonly owner: Window;
  private readonly host: DesktopEdgeOverlayRuntimeHost;
  private manager?: DesktopEdgeOverlayManager;
  private readonly refreshers = new Map<string, () => void>();
  private readonly groups = new Map<string, GroupState>();
  private disposed = false;
  private startTask?: Promise<void>;
  private idleTimer?: number;
  private readonly onTopologyChange = () => {
    this.manager?.topologyChanged([]);
    for (const refresh of this.refreshers.values()) {
      try {
        refresh();
      } catch {
        // One stale group must not prevent other groups from refreshing.
      }
    }
  };
  private readonly onVisibilityChange = () => {
    // Detached cards can remain focused while their Reader owner document is
    // marked hidden. Focus-group events, not Page Visibility, own line visibility.
    if (this.owner.document.hidden) return;
    for (const [groupId, state] of this.groups)
      if (state.visible) {
        try {
          this.refreshers.get(groupId)?.();
        } catch {
          // One stale group must not prevent other groups from refreshing.
        }
      }
  };
  private readonly onUnload = () => {
    void this.dispose();
  };
  private lastAckState = "";

  constructor(
    owner: Window,
    hostFactory: DesktopEdgeOverlayRuntimeHostFactory = createNativeDesktopEdgeOverlayHost,
  ) {
    this.owner = owner;
    this.host = hostFactory({
      onSnapshotAck: (ack) => this.reportSnapshotAck(ack),
    });
    this.host.setFailureHandler((error) => this.onHostFailure(error));
    owner.addEventListener("screenschange", this.onTopologyChange);
    owner.addEventListener("resize", this.onTopologyChange);
    owner.addEventListener("unload", this.onUnload, { once: true });
    owner.document.addEventListener(
      "visibilitychange",
      this.onVisibilityChange,
    );
    owner.screen?.addEventListener?.("change", this.onTopologyChange);
    activeRuntimes.add(this);
  }

  register(groupId: string, refresh: () => void): () => void {
    if (this.disposed) return () => {};
    this.refreshers.set(groupId, refresh);
    if (!this.groups.has(groupId))
      this.groups.set(groupId, { curves: [], visible: true });
    return () => {
      if (this.refreshers.get(groupId) === refresh)
        this.refreshers.delete(groupId);
      this.removeGroup(groupId);
    };
  }

  setGroup(groupId: string, curves: readonly DesktopEdgeCurve[]): void {
    if (this.disposed) return;
    const previous = this.groups.get(groupId);
    this.groups.set(groupId, {
      curves,
      visible: previous?.visible ?? true,
    });
    if (this.manager) this.applyGroup(groupId);
    this.startIfActive();
    this.scheduleIdleShutdown();
  }

  setGroupVisible(groupId: string, visible: boolean): void {
    if (this.disposed) return;
    const state = this.groups.get(groupId) ?? { curves: [], visible };
    state.visible = visible;
    this.groups.set(groupId, state);
    this.manager?.setGroupVisible(groupId, visible);
    this.startIfActive();
    this.scheduleIdleShutdown();
  }

  removeGroup(groupId: string): void {
    if (this.disposed) return;
    this.groups.delete(groupId);
    this.manager?.removeGroup(groupId);
    this.scheduleIdleShutdown();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.clearIdleTimer();
    this.owner.removeEventListener("screenschange", this.onTopologyChange);
    this.owner.removeEventListener("resize", this.onTopologyChange);
    this.owner.removeEventListener("unload", this.onUnload);
    this.owner.document.removeEventListener(
      "visibilitychange",
      this.onVisibilityChange,
    );
    this.owner.screen?.removeEventListener?.("change", this.onTopologyChange);
    this.refreshers.clear();
    this.groups.clear();
    this.manager?.dispose();
    this.manager = undefined;
    await this.host.dispose();
    activeRuntimes.delete(this);
    runtimes.delete(this.owner);
  }

  private applyGroup(groupId: string): void {
    const state = this.groups.get(groupId);
    if (!state || !this.manager) return;
    const displays = state.curves.length
      ? desktopDisplaysForCurves(state.curves)
      : [];
    recordDesktopEdgeDiagnostics("overlay", {
      groupCount: this.groups.size,
      curveCount: state.curves.length,
      visible: state.visible,
      documentHidden: this.owner.document.hidden,
      displays: displays.map(({ rect }) => rect),
    });
    const renderResult = this.manager.setGroup(groupId, state.curves, displays);
    recordDesktopEdgeDiagnostics("overlay", {
      groupCount: this.groups.size,
      curveCount: state.curves.length,
      visible: state.visible,
      documentHidden: this.owner.document.hidden,
      displays: displays.map(({ rect }) => rect),
      renderResult,
    });
  }

  private startIfActive(): void {
    if (this.disposed || !this.hasVisibleCurves()) return;
    this.clearIdleTimer();
    if (this.manager || this.startTask) return;
    this.startTask = (async () => {
      recordDesktopEdgeDiagnostics("helper", { state: "starting" });
      await this.host.prepare();
      if (this.disposed) {
        await this.host.stop();
        return;
      }
      recordDesktopEdgeDiagnostics("helper", { state: "ready" });
      this.manager = new DesktopEdgeOverlayManager(this.host);
      for (const groupId of this.groups.keys()) this.applyGroup(groupId);
    })()
      .catch((error: unknown) => {
        this.manager?.dispose();
        this.manager = undefined;
        void this.host.stop();
        const failure =
          error instanceof Error ? error : new Error(String(error));
        recordDesktopEdgeDiagnostics("helper", {
          state: "failed",
          error: failure.message.slice(0, 240),
        });
        this.logFailure(failure);
      })
      .finally(() => {
        this.startTask = undefined;
        this.scheduleIdleShutdown();
      });
  }

  private hasVisibleCurves(): boolean {
    return [...this.groups.values()].some(
      (group) => group.visible && group.curves.length > 0,
    );
  }

  private scheduleIdleShutdown(): void {
    if (this.disposed || this.hasVisibleCurves() || this.startTask) return;
    this.clearIdleTimer();
    if (!this.manager) return;
    this.idleTimer = this.owner.setTimeout(() => {
      this.idleTimer = undefined;
      if (this.disposed || this.hasVisibleCurves()) return;
      this.manager?.dispose();
      this.manager = undefined;
      void this.host.stop().catch((error: unknown) => {
        this.logFailure(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    }, IDLE_SHUTDOWN_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer === undefined) return;
    this.owner.clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private onHostFailure(error: Error): void {
    if (this.disposed) return;
    recordDesktopEdgeDiagnostics("helper", {
      state: "failed",
      error: error.message.slice(0, 240),
    });
    this.manager?.dispose();
    this.manager = undefined;
    void this.host.stop();
    this.logFailure(error);
  }

  private logFailure(error: Error): void {
    try {
      Zotero.debug(
        `[Zotero Obsidian Bridge] Native line overlay is fail-closed: ${error.message}`,
      );
    } catch {
      // Zotero may already be shutting down.
    }
  }

  private reportSnapshotAck(ack: DesktopOverlaySnapshotAck): void {
    const state = [
      ack.status ?? "unknown",
      ack.activeWindows ?? "?",
      ack.visibleWindows ?? "?",
      ack.curveCount ?? "?",
    ].join(":");
    recordDesktopEdgeIpcEvent({
      event: "ack",
      generation: ack.generation,
      roundTripMs: ack.roundTripMs,
      status: ack.status,
      activeWindows: ack.activeWindows,
      visibleWindows: ack.visibleWindows,
      curveCount: ack.curveCount,
    });
    recordDesktopEdgeDiagnostics("helper", {
      state: "acknowledged",
      generation: ack.generation,
      roundTripMs: ack.roundTripMs,
      status: ack.status,
      activeWindows: ack.activeWindows,
      visibleWindows: ack.visibleWindows,
      curveCount: ack.curveCount,
    });
    recordDesktopEdgeDiagnostics("ipc", {
      event: "ack",
      generation: ack.generation,
      roundTripMs: ack.roundTripMs,
      status: ack.status,
      activeWindows: ack.activeWindows,
      visibleWindows: ack.visibleWindows,
      curveCount: ack.curveCount,
    });
    recordDesktopEdgeRenderedAck({
      zoteroPID: Services.appinfo.processID,
      generation: ack.generation,
      roundTripMs: ack.roundTripMs,
      status: ack.status,
      activeWindows: ack.activeWindows,
      visibleWindows: ack.visibleWindows,
      curveCount: ack.curveCount,
    });
    if (state === this.lastAckState) return;
    this.lastAckState = state;
    try {
      Zotero.debug(
        `[Zotero Obsidian Bridge] Native line overlay ACK: generation=${ack.generation}, status=${state}`,
      );
    } catch {
      // Zotero may already be shutting down.
    }
  }
}

export function getDesktopEdgeOverlayRuntime(
  hostFactory?: DesktopEdgeOverlayRuntimeHostFactory,
): DesktopEdgeOverlayRuntime {
  const owner = Zotero.getMainWindow();
  let runtime = runtimes.get(owner);
  if (!runtime) {
    runtime = new DesktopEdgeOverlayRuntime(owner, hostFactory);
    runtimes.set(owner, runtime);
  }
  return runtime;
}

export async function shutdownDesktopEdgeOverlayRuntimes(): Promise<void> {
  await Promise.all([...activeRuntimes].map((runtime) => runtime.dispose()));
}
