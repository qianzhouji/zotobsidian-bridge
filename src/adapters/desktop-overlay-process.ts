export const DESKTOP_OVERLAY_PROTOCOL_VERSION = 1;
export const DESKTOP_OVERLAY_MAX_MESSAGE_BYTES = 1_048_576;

export interface DesktopOverlayProcessCapabilities {
  transparent: boolean;
  nonActivating: boolean;
  controlledZOrder: boolean;
  systemMousePassthrough: boolean;
  multiDisplay: boolean;
  tracksNativeDrag: boolean;
}

export interface DesktopOverlaySnapshotDisplay {
  id: string;
  rect: { left: number; top: number; width: number; height: number };
  visible: boolean;
  curves: readonly {
    id: string;
    from: { x: number; y: number };
    control1: { x: number; y: number };
    control2: { x: number; y: number };
    to: { x: number; y: number };
    startArrow: boolean;
    endArrow: boolean;
  }[];
}

export interface DesktopOverlaySnapshotAck {
  generation: number;
  roundTripMs?: number;
  status?: string;
  activeWindows?: number;
  visibleWindows?: number;
  curveCount?: number;
}

export interface DesktopOverlayProcessPipe {
  write(value: string): Promise<void> | void;
  close(): void;
}

export interface DesktopOverlayOutputPipe {
  readString(): Promise<string>;
  close(): void;
}

export interface DesktopOverlayChildProcess {
  stdin: DesktopOverlayProcessPipe;
  stdout: DesktopOverlayOutputPipe;
  wait(): Promise<{ exitCode: number | null }>;
  kill(): void;
}

export type DesktopOverlayProcessState =
  | "stopped"
  | "starting"
  | "ready"
  | "stopping"
  | "failed";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function monotonicNow(): number {
  try {
    const value = globalThis.performance?.now();
    return Number.isFinite(value) ? value! : Date.now();
  } catch {
    return Date.now();
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface DesktopOverlayProcessClientOptions {
  launch(): Promise<DesktopOverlayChildProcess>;
  onFailure?(error: Error): void;
  onSnapshotAck?(ack: DesktopOverlaySnapshotAck): void;
  readyTimeoutMs?: number;
  acknowledgementTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

/** Versioned JSONL IPC client with bounded messages and latest-snapshot coalescing. */
export class DesktopOverlayProcessClient {
  private readonly options: DesktopOverlayProcessClientOptions;
  private child?: DesktopOverlayChildProcess;
  private stateValue: DesktopOverlayProcessState = "stopped";
  private readyDeferred?: Deferred<DesktopOverlayProcessCapabilities>;
  private shutdownDeferred?: Deferred<void>;
  private readonly acknowledgements = new Map<
    string | number,
    Deferred<void>
  >();
  private readonly snapshotSentAt = new Map<number, number>();
  private pendingSnapshot?: {
    generation: number;
    displays: readonly DesktopOverlaySnapshotDisplay[];
    result: Deferred<"acknowledged" | "superseded">;
  };
  private nextGeneration = 0;
  private flushTask?: Promise<void>;
  private readTask?: Promise<void>;
  private exitTask?: Promise<{ exitCode: number | null }>;
  private failedError?: Error;
  private closing = false;

  constructor(options: DesktopOverlayProcessClientOptions) {
    this.options = options;
  }

  get state(): DesktopOverlayProcessState {
    return this.stateValue;
  }

  async start(): Promise<DesktopOverlayProcessCapabilities> {
    if (this.stateValue === "ready") return this.readyDeferred!.promise;
    if (this.stateValue === "starting") return this.readyDeferred!.promise;
    if (this.stateValue === "stopping")
      throw new Error("The desktop overlay helper is stopping.");
    if (this.stateValue === "failed")
      throw this.failedError ?? new Error("The desktop overlay helper failed.");
    this.failedError = undefined;
    this.closing = false;
    this.stateValue = "starting";
    const ready = deferred<DesktopOverlayProcessCapabilities>();
    void ready.promise.catch(() => undefined);
    this.readyDeferred = ready;
    try {
      this.child = await this.options.launch();
      const child = this.child;
      this.readTask = this.readOutput(child);
      this.exitTask = child.wait();
      void this.exitTask.then(({ exitCode }) => {
        if (this.child === child && !this.closing)
          this.fail(
            new Error(
              `Native overlay helper exited (${exitCode ?? "unknown"}).`,
            ),
          );
      });
      const capabilities = await withTimeout(
        ready.promise,
        this.options.readyTimeoutMs ?? 5000,
        "Native overlay handshake",
      );
      this.stateValue = "ready";
      return capabilities;
    } catch (error) {
      const failure = asError(error);
      this.fail(failure);
      throw failure;
    }
  }

  sendSnapshot(
    displays: readonly DesktopOverlaySnapshotDisplay[],
  ): Promise<"acknowledged" | "superseded"> {
    if (this.stateValue !== "ready")
      return Promise.reject(
        this.failedError ?? new Error("Native overlay is not ready."),
      );
    const result = deferred<"acknowledged" | "superseded">();
    if (this.pendingSnapshot) this.pendingSnapshot.result.resolve("superseded");
    this.pendingSnapshot = {
      generation: ++this.nextGeneration,
      displays,
      result,
    };
    if (!this.flushTask) {
      this.flushTask = this.flushSnapshots().finally(() => {
        this.flushTask = undefined;
        if (this.pendingSnapshot && this.stateValue === "ready")
          void this.sendPendingAgain();
      });
    }
    return result.promise;
  }

  async ping(nonce: string): Promise<void> {
    if (this.stateValue !== "ready" || !this.child)
      throw new Error("Native overlay is not ready.");
    const pong = deferred<void>();
    const key = `ping:${nonce}`;
    this.acknowledgements.set(key, pong);
    try {
      await this.child.stdin.write(
        `${JSON.stringify({ type: "ping", protocol: DESKTOP_OVERLAY_PROTOCOL_VERSION, nonce })}\n`,
      );
      await withTimeout(
        pong.promise,
        this.options.acknowledgementTimeoutMs ?? 1500,
        "Native overlay ping",
      );
    } finally {
      this.acknowledgements.delete(key);
    }
  }

  async stop(): Promise<void> {
    if (!this.child) {
      if (this.stateValue === "failed") {
        this.failedError = undefined;
        this.closing = false;
        this.stateValue = "stopped";
      }
      return;
    }
    if (this.stateValue === "stopped") return;
    if (this.stateValue === "stopping") {
      await this.exitTask?.catch(() => undefined);
      return;
    }
    this.closing = true;
    this.stateValue = "stopping";
    const child = this.child;
    const shutdown = deferred<void>();
    this.shutdownDeferred = shutdown;
    try {
      await child.stdin.write(
        `${JSON.stringify({ type: "shutdown", protocol: DESKTOP_OVERLAY_PROTOCOL_VERSION })}\n`,
      );
      await withTimeout(
        shutdown.promise,
        800,
        "Native overlay shutdown acknowledgement",
      );
    } catch {
      // Closing stdin remains the helper's independent graceful-exit signal.
    }
    try {
      child.stdin.close();
    } catch {
      // It may have closed after an early child exit.
    }
    try {
      await withTimeout(
        this.exitTask ?? child.wait(),
        this.options.shutdownTimeoutMs ?? 1500,
        "Native overlay process exit",
      );
    } catch {
      child.kill();
      await Promise.race([
        (this.exitTask ?? child.wait()).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    }
    try {
      child.stdout.close();
    } catch {
      // The read loop may already have closed at EOF.
    }
    await this.readTask?.catch(() => undefined);
    this.child = undefined;
    this.stateValue = "stopped";
    this.shutdownDeferred = undefined;
    this.acknowledgements.clear();
    this.snapshotSentAt.clear();
  }

  private async sendPendingAgain(): Promise<void> {
    if (this.flushTask || !this.pendingSnapshot || this.stateValue !== "ready")
      return;
    this.flushTask = this.flushSnapshots().finally(() => {
      this.flushTask = undefined;
      if (this.pendingSnapshot && this.stateValue === "ready")
        void this.sendPendingAgain();
    });
  }

  private async flushSnapshots(): Promise<void> {
    while (this.pendingSnapshot && this.stateValue === "ready" && this.child) {
      const current = this.pendingSnapshot;
      this.pendingSnapshot = undefined;
      const acknowledgement = deferred<void>();
      this.acknowledgements.set(current.generation, acknowledgement);
      this.snapshotSentAt.set(current.generation, monotonicNow());
      try {
        await this.child.stdin.write(
          `${JSON.stringify({
            type: "sync",
            protocol: DESKTOP_OVERLAY_PROTOCOL_VERSION,
            generation: current.generation,
            displays: current.displays,
          })}\n`,
        );
        await withTimeout(
          acknowledgement.promise,
          this.options.acknowledgementTimeoutMs ?? 1500,
          "Native overlay snapshot acknowledgement",
        );
        current.result.resolve("acknowledged");
      } catch (error) {
        current.result.reject(error);
        this.fail(asError(error));
        return;
      } finally {
        this.acknowledgements.delete(current.generation);
        this.snapshotSentAt.delete(current.generation);
      }
    }
  }

  private async readOutput(child: DesktopOverlayChildProcess): Promise<void> {
    let buffer = "";
    try {
      while (this.child === child) {
        const chunk = await child.stdout.readString();
        if (!chunk) break;
        buffer += chunk;
        if (buffer.length > DESKTOP_OVERLAY_MAX_MESSAGE_BYTES) {
          this.fail(
            new Error("Native overlay output exceeded the message limit."),
          );
          return;
        }
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          this.handleOutputLine(line);
          newline = buffer.indexOf("\n");
        }
      }
      if (buffer.trim()) this.handleOutputLine(buffer);
      if (!this.closing)
        this.fail(new Error("Native overlay helper closed its output pipe."));
    } catch (error) {
      if (!this.closing) this.fail(asError(error));
    }
  }

  private handleOutputLine(line: string): void {
    if (!line || line.length > DESKTOP_OVERLAY_MAX_MESSAGE_BYTES) {
      this.fail(new Error("Native overlay sent an invalid output frame."));
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.fail(new Error("Native overlay sent malformed JSON."));
      return;
    }
    if (message.type === "ready") {
      if (message.protocol !== DESKTOP_OVERLAY_PROTOCOL_VERSION) {
        this.fail(new Error("Native overlay protocol version mismatch."));
        return;
      }
      const value = message.capabilities as Record<string, unknown> | undefined;
      const required = [
        "transparent",
        "nonActivating",
        "controlledZOrder",
        "systemMousePassthrough",
        "multiDisplay",
        "tracksNativeDrag",
      ] as const;
      if (!value || required.some((key) => value[key] !== true)) {
        this.fail(
          new Error("Native overlay handshake omitted required capabilities."),
        );
        return;
      }
      this.readyDeferred?.resolve(
        value as unknown as DesktopOverlayProcessCapabilities,
      );
      return;
    }
    if (message.type === "ack" && message.operation === "shutdown") {
      this.shutdownDeferred?.resolve();
      return;
    }
    if (message.type === "ack" && message.operation === "sync") {
      const generation = message.generation;
      if (typeof generation !== "number") return;
      const acknowledgement = this.acknowledgements.get(generation);
      if (!acknowledgement) return;
      try {
        this.options.onSnapshotAck?.({
          generation,
          roundTripMs: this.snapshotSentAt.has(generation)
            ? Math.max(0, monotonicNow() - this.snapshotSentAt.get(generation)!)
            : undefined,
          status:
            typeof message.status === "string" ? message.status : undefined,
          activeWindows:
            typeof message.activeWindows === "number"
              ? message.activeWindows
              : undefined,
          visibleWindows:
            typeof message.visibleWindows === "number"
              ? message.visibleWindows
              : undefined,
          curveCount:
            typeof message.curveCount === "number"
              ? message.curveCount
              : undefined,
        });
      } catch {
        // Diagnostics must not interrupt acknowledgement processing.
      }
      acknowledgement.resolve();
      return;
    }
    if (message.type === "pong" && typeof message.nonce === "string") {
      this.acknowledgements.get(`ping:${message.nonce}`)?.resolve();
      return;
    }
    if (message.type === "error") {
      this.fail(
        new Error(
          `Native overlay rejected a command (${String(message.code ?? "unknown")}).`,
        ),
      );
      return;
    }
    if (message.type !== "stopped")
      this.fail(new Error("Native overlay sent an unknown protocol message."));
  }

  private fail(error: Error): void {
    if (this.failedError || this.stateValue === "stopped") return;
    this.failedError = error;
    const wasStopping = this.closing;
    this.stateValue = wasStopping ? "stopping" : "failed";
    this.readyDeferred?.reject(error);
    this.shutdownDeferred?.reject(error);
    for (const acknowledgement of this.acknowledgements.values())
      acknowledgement.reject(error);
    this.acknowledgements.clear();
    this.pendingSnapshot?.result.reject(error);
    this.pendingSnapshot = undefined;
    if (!wasStopping) {
      try {
        this.child?.stdin.close();
      } catch {
        // Failure cleanup is best-effort; the caller still fails closed.
      }
      const child = this.child;
      if (child)
        setTimeout(() => {
          if (this.child === child && !this.closing) child.kill();
        }, 1500);
      this.options.onFailure?.(error);
    }
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
