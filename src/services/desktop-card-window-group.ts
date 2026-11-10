import type {
  DesktopCardWindowIdentity,
  DesktopCardWindowLease,
  DesktopCardWindowReservation,
} from "../core/desktop-card-window-registry.ts";
import { DesktopCardWindowRegistry } from "../core/desktop-card-window-registry.ts";
import type {
  DesktopWindowHost,
  DesktopWindowOpenOptions,
} from "../adapters/desktop-window-host.ts";
import {
  ManagedWindowFocusGroup,
  installManagedCardWindowKeyboard,
} from "../adapters/managed-window-focus.ts";
import { fitWindowRectToScreen } from "../core/desktop-window-layout.ts";
import type { DesktopWindowRect } from "../core/desktop-window-layout.ts";

type ManagedWindow = Window & { closed?: boolean };

function sameRect(
  left: DesktopWindowRect | undefined,
  right: DesktopWindowRect,
): boolean {
  return Boolean(
    left &&
    Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5,
  );
}

export interface DesktopCardWindowGroupOptions {
  owner: Window;
  identity: Omit<DesktopCardWindowIdentity, "canonicalPath">;
  registry: DesktopCardWindowRegistry;
  host: DesktopWindowHost;
  openOptions(path: string): Omit<DesktopWindowOpenOptions, "args"> & {
    args: unknown[];
  };
  onGeometryChanged?(): void;
  onGeometryFrame?(): void;
  onFailure?(path: string, error: string): void;
  onWindowClosed?(lease: DesktopCardWindowLease): void;
  readyTimeoutMs?: number;
  setTimer?: (callback: () => void, delay: number) => number;
  clearTimer?: (timer: number) => void;
}

export interface DesktopCardWindowOpenResult {
  status: DesktopCardWindowReservation["status"];
  lease?: DesktopCardWindowLease;
  window?: Window;
  ready?: Promise<Window>;
}

interface OpenEntry {
  lease: DesktopCardWindowLease;
  window: ManagedWindow;
  removeFocus: () => void;
  removeKeyboard: () => void;
  onReady: () => void;
  onFailure: () => void;
  onUnload: () => void;
  timeout?: number;
  readyPoll?: number;
  ready: Promise<Window>;
  resolveReady(window: Window): void;
  rejectReady(error: Error): void;
  readySettled: boolean;
  suppressClose: boolean;
  geometryTimer?: number;
  onGeometry?: () => void;
  lastGeometry?: DesktopWindowRect;
}

/** Owns native card children while leaving root-session ownership explicit. */
export class DesktopCardWindowGroup {
  private readonly windows = new Map<string, OpenEntry>();
  private readonly focus: ManagedWindowFocusGroup;
  private disposed = false;
  private cancelGeometryPoll?: () => void;
  private readonly setTimer: (callback: () => void, delay: number) => number;
  private readonly clearTimer: (timer: number) => void;
  private readonly onOwnerUnload = () => this.dispose();
  private readonly options: DesktopCardWindowGroupOptions;

  constructor(options: DesktopCardWindowGroupOptions) {
    this.options = options;
    this.setTimer =
      options.setTimer ??
      ((callback, delay) => options.owner.setTimeout(callback, delay));
    this.clearTimer =
      options.clearTimer ?? ((timer) => options.owner.clearTimeout(timer));
    this.focus = new ManagedWindowFocusGroup(options.owner);
    options.owner.addEventListener("unload", this.onOwnerUnload, {
      once: true,
    });
  }

  open(path: string): DesktopCardWindowOpenResult {
    if (this.disposed) throw new Error("The desktop card group is closed.");
    const identity = { ...this.options.identity, canonicalPath: path };
    const reservation = this.options.registry.reserve(identity);
    if (reservation.status === "group-limit") return reservation;
    if (reservation.status === "owner-limit") return reservation;

    if (reservation.status === "existing") {
      const existing = this.windows.get(reservation.lease.id);
      if (existing && !existing.window.closed) {
        existing.window.focus();
        return {
          status: "existing",
          lease: reservation.lease,
          window: existing.window,
          ready: existing.ready,
        };
      }
      if (existing) this.removeEntry(existing);
      else this.retireLease(reservation.lease);
      return this.open(path);
    }
    if (reservation.status !== "reserved")
      throw new Error("Unexpected desktop window reservation state.");
    const lease = reservation.lease;

    let openOptions: DesktopWindowOpenOptions;
    let window: Window | null;
    try {
      openOptions = this.options.openOptions(path);
      window = this.options.host.open(openOptions);
    } catch (error) {
      this.options.registry.transition(lease.id, lease.generation, "failed");
      this.options.registry.release(lease.id, lease.generation);
      throw error;
    }
    if (!window) {
      this.options.registry.transition(lease.id, lease.generation, "failed");
      this.options.registry.release(lease.id, lease.generation);
      throw new Error("Zotero did not create the desktop knowledge window.");
    }

    const child = window as ManagedWindow;
    let resolveReady!: (window: Window) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<Window>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    void ready.catch(() => {});
    const entry = {
      ready,
      resolveReady,
      rejectReady,
      readySettled: false,
      suppressClose: false,
      removeFocus: () => {},
      removeKeyboard: () => {},
    } as OpenEntry;
    const clearReadyTimeout = () => {
      if (entry.timeout !== undefined) {
        this.clearTimer(entry.timeout);
        entry.timeout = undefined;
      }
      if (entry.readyPoll !== undefined) {
        this.clearTimer(entry.readyPoll);
        entry.readyPoll = undefined;
      }
    };
    const fail = (message: string) => {
      const current = this.options.registry.get(entry.lease.id);
      if (
        !current ||
        current.generation !== entry.lease.generation ||
        current.state !== "opening"
      )
        return;
      this.options.registry.transition(
        current.id,
        current.generation,
        "failed",
      );
      this.rejectReady(entry, new Error(message));
      clearReadyTimeout();
      try {
        this.options.onFailure?.(path, message);
      } catch {
        // Reporting must not prevent window cleanup.
      }
      try {
        entry.suppressClose = true;
        child.close();
      } catch {
        this.removeEntry(entry, false);
      } finally {
        if (child.closed) this.removeEntry(entry, false);
      }
    };
    const onReady = () => {
      if (!this.isCurrent(entry) || entry.readySettled) return;
      let ready: string | null | undefined;
      try {
        if (child.location.href !== openOptions.url) return;
        ready = child.document
          .querySelector("[data-ready]")
          ?.getAttribute("data-ready");
      } catch {
        fail("Packaged window document is unavailable.");
        return;
      }
      if (ready === "failed") {
        fail("Packaged window initialization failed.");
        return;
      }
      if (ready !== "true") return;
      clearReadyTimeout();
      const transitioned = this.options.registry.transition(
        entry.lease.id,
        entry.lease.generation,
        "ready",
      );
      if (transitioned) {
        // openDialog's initial document can be replaced along with its listeners.
        entry.removeFocus = this.focus.add(child);
        entry.removeKeyboard = installManagedCardWindowKeyboard(child, () => {
          this.close(entry.lease.id, true);
        });
        child.addEventListener("unload", onUnload, { once: true });
        this.constrainWindow(entry);
        entry.lastGeometry = this.readWindowRect(entry);
        entry.onGeometry = () => {
          const rect = this.readWindowRect(entry);
          const changed = Boolean(rect && !sameRect(entry.lastGeometry, rect));
          entry.lastGeometry = rect;
          this.scheduleConstrain(entry);
          if (changed && this.options.onGeometryFrame)
            this.options.onGeometryFrame();
          else this.options.onGeometryChanged?.();
        };
        child.addEventListener("move", entry.onGeometry);
        child.addEventListener("resize", entry.onGeometry);
        child.addEventListener("sizemodechange", entry.onGeometry);
        this.resolveReady(entry, child);
        this.scheduleGeometryPolling();
      }
    };
    const onFailure = () => fail("Packaged window initialization failed.");
    const onUnload = () => {
      if (!entry.readySettled)
        this.rejectReady(
          entry,
          new Error("Desktop card window closed before ready."),
        );
      this.removeEntry(entry, !entry.suppressClose);
    };
    Object.assign(entry, {
      lease,
      window: child,
      onReady,
      onFailure,
      onUnload,
    });
    this.windows.set(entry.lease.id, entry);
    child.addEventListener("desktop-card-ready", onReady);
    child.addEventListener("desktop-card-failed", onFailure);
    child.addEventListener("load", onReady);
    onReady();
    if (
      this.options.registry.get(entry.lease.id)?.state === "opening" &&
      !child.closed
    ) {
      entry.timeout = this.setTimer(
        () => fail("Packaged window did not become ready before timeout."),
        this.options.readyTimeoutMs ?? 10000,
      );
      // The owner survives the child's about:blank -> chrome document switch.
      const pollReady = () => {
        entry.readyPoll = undefined;
        if (!this.isCurrent(entry) || entry.readySettled) return;
        if (child.closed) {
          onUnload();
          return;
        }
        onReady();
        if (!entry.readySettled && this.isCurrent(entry))
          entry.readyPoll = this.setTimer(pollReady, 50);
      };
      entry.readyPoll = this.setTimer(pollReady, 50);
    }
    if (child.closed) this.removeEntry(entry);
    return { status: "reserved", lease, window: child, ready };
  }

  close(id: string, notifyOwner = false): void {
    const entry = this.windows.get(id);
    if (!entry) return;
    const current = this.options.registry.get(id);
    if (!current) return;
    if (current.state !== "closing")
      this.options.registry.transition(id, current.generation, "closing");
    entry.suppressClose = !notifyOwner;
    try {
      entry.window.close();
    } catch (error) {
      try {
        this.options.onFailure?.(
          entry.lease.identity.canonicalPath,
          `Window close failed: ${String(error)}`,
        );
      } finally {
        this.removeEntry(entry, notifyOwner);
      }
      return;
    }
    if (entry.window.closed) this.removeEntry(entry, notifyOwner);
  }

  closeAll(): void {
    const leases = this.options.registry.beginGroupClose(this.options.identity);
    const newlyClosing = new Map(leases.map((lease) => [lease.id, lease]));
    for (const entry of [...this.windows.values()]) {
      const current = this.options.registry.get(entry.lease.id);
      if (current && current.state !== "closing")
        this.options.registry.transition(
          current.id,
          current.generation,
          "closing",
        );
      try {
        entry.suppressClose = true;
        entry.window.close();
      } catch (error) {
        try {
          this.options.onFailure?.(
            entry.lease.identity.canonicalPath,
            `Window close failed: ${String(error)}`,
          );
        } catch {
          // Reporting must not prevent cleanup of other windows.
        }
        this.removeEntry(entry, false);
      } finally {
        if (entry.window.closed) this.removeEntry(entry, false);
      }
    }
    for (const lease of newlyClosing.values()) {
      if (!this.windows.has(lease.id))
        this.options.registry.transition(lease.id, lease.generation, "closed");
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopGeometryPolling();
    this.closeAll();
    this.options.owner.removeEventListener("unload", this.onOwnerUnload);
    this.focus.dispose();
  }

  private isCurrent(entry: OpenEntry): boolean {
    return (
      !this.disposed &&
      this.windows.get(entry.lease.id) === entry &&
      this.options.registry.get(entry.lease.id)?.generation ===
        entry.lease.generation
    );
  }

  private resolveReady(entry: OpenEntry, window: Window): void {
    if (entry.readySettled) return;
    entry.readySettled = true;
    entry.resolveReady(window);
  }

  private rejectReady(entry: OpenEntry, error: Error): void {
    if (entry.readySettled) return;
    entry.readySettled = true;
    entry.rejectReady(error);
  }

  private scheduleConstrain(entry: OpenEntry): void {
    if (!this.isCurrent(entry)) return;
    if (entry.geometryTimer !== undefined) this.clearTimer(entry.geometryTimer);
    entry.geometryTimer = this.setTimer(() => {
      entry.geometryTimer = undefined;
      this.constrainWindow(entry);
    }, 100);
  }

  private scheduleGeometryPolling(): void {
    if (
      this.disposed ||
      this.cancelGeometryPoll ||
      !this.options.host.getWindowRect ||
      ![...this.windows.values()].some(
        (entry) => entry.readySettled && !entry.window.closed,
      )
    )
      return;
    this.cancelGeometryPoll = this.requestGeometryFrame(() => {
      this.cancelGeometryPoll = undefined;
      if (this.disposed) return;
      let changed = false;
      for (const entry of this.windows.values()) {
        if (
          !this.isCurrent(entry) ||
          !entry.readySettled ||
          entry.window.closed
        )
          continue;
        const rect = this.readWindowRect(entry);
        if (!rect) continue;
        if (!sameRect(entry.lastGeometry, rect)) changed = true;
        entry.lastGeometry = rect;
      }
      if (changed) {
        if (this.options.onGeometryFrame) this.options.onGeometryFrame();
        else this.options.onGeometryChanged?.();
      }
      this.scheduleGeometryPolling();
    });
  }

  private stopGeometryPolling(): void {
    this.cancelGeometryPoll?.();
    this.cancelGeometryPoll = undefined;
  }

  /** Schedule geometry work on an active detached card's display frame. */
  requestGeometryFrame(callback: () => void): () => void {
    return this.requestGeometryFrameOnWindow(callback);
  }

  private requestGeometryFrameOnWindow(callback: () => void): () => void {
    const scheduler = this.geometrySchedulerWindow();
    if (
      typeof scheduler.requestAnimationFrame === "function" &&
      typeof scheduler.cancelAnimationFrame === "function"
    ) {
      const frame = scheduler.requestAnimationFrame(callback);
      return () => scheduler.cancelAnimationFrame(frame);
    }
    const timer = this.setTimer(callback, 16);
    return () => this.clearTimer(timer);
  }

  private geometrySchedulerWindow(): Window {
    const active = this.focus.activeWindow;
    if (
      active &&
      [...this.windows.values()].some(
        (entry) => entry.window === active && entry.readySettled,
      )
    )
      return active;
    return (
      [...this.windows.values()].find(
        (entry) => entry.readySettled && !entry.window.closed,
      )?.window ?? this.options.owner
    );
  }

  private readWindowRect(entry: OpenEntry): DesktopWindowRect | undefined {
    try {
      const rect = this.options.host.getWindowRect?.(entry.window) ?? {
        left: entry.window.screenX,
        top: entry.window.screenY,
        width: entry.window.outerWidth,
        height: entry.window.outerHeight,
      };
      return Object.values(rect).every(Number.isFinite) &&
        rect.width > 0 &&
        rect.height > 0
        ? { ...rect }
        : undefined;
    } catch {
      return undefined;
    }
  }

  private constrainWindow(entry: OpenEntry): void {
    const host = this.options.host;
    if (
      !this.isCurrent(entry) ||
      !host.getWindowRect ||
      !host.getAvailableScreenArea ||
      !host.setWindowRect
    )
      return;
    try {
      const rect = host.getWindowRect(entry.window);
      const area = host.getAvailableScreenArea(entry.window, rect);
      if (!area) return;
      const fitted = fitWindowRectToScreen(rect, area);
      if (
        Math.abs(fitted.left - rect.left) > 1 ||
        Math.abs(fitted.top - rect.top) > 1 ||
        Math.abs(fitted.width - rect.width) > 1 ||
        Math.abs(fitted.height - rect.height) > 1
      )
        host.setWindowRect(entry.window, fitted);
    } catch {
      // Screen recovery is best-effort; it must not fail card initialization.
    }
  }

  private removeEntry(entry: OpenEntry, notifyOwner = false): void {
    if (this.windows.get(entry.lease.id) !== entry) return;
    this.rejectReady(
      entry,
      new Error("Desktop card window closed before ready."),
    );
    this.windows.delete(entry.lease.id);
    if (entry.timeout !== undefined) this.clearTimer(entry.timeout);
    if (entry.readyPoll !== undefined) this.clearTimer(entry.readyPoll);
    if (entry.geometryTimer !== undefined) this.clearTimer(entry.geometryTimer);
    entry.window.removeEventListener("load", entry.onReady);
    entry.window.removeEventListener("desktop-card-ready", entry.onReady);
    entry.window.removeEventListener("desktop-card-failed", entry.onFailure);
    entry.window.removeEventListener("unload", entry.onUnload);
    if (entry.onGeometry) {
      entry.window.removeEventListener("move", entry.onGeometry);
      entry.window.removeEventListener("resize", entry.onGeometry);
      entry.window.removeEventListener("sizemodechange", entry.onGeometry);
    }
    entry.removeKeyboard();
    entry.removeFocus();
    if (
      ![...this.windows.values()].some(
        (remaining) => remaining.readySettled && !remaining.window.closed,
      )
    )
      this.stopGeometryPolling();
    const current = this.options.registry.get(entry.lease.id);
    if (!current) return;
    if (current.state !== "closing")
      this.options.registry.transition(
        current.id,
        current.generation,
        "closing",
      );
    this.options.registry.transition(current.id, current.generation, "closed");
    if (notifyOwner) {
      try {
        this.options.onWindowClosed?.({
          ...current,
          identity: { ...current.identity },
        });
      } catch {
        // A consumer callback must not prevent registry cleanup.
      }
    }
  }

  private retireLease(lease: DesktopCardWindowLease): void {
    const current = this.options.registry.get(lease.id);
    if (!current || current.generation !== lease.generation) return;
    if (current.state === "opening")
      this.options.registry.transition(
        current.id,
        current.generation,
        "failed",
      );
    const latest = this.options.registry.get(current.id);
    if (!latest) return;
    if (latest.state !== "closing")
      this.options.registry.transition(latest.id, latest.generation, "closing");
    this.options.registry.transition(latest.id, latest.generation, "closed");
  }
}
