export interface DesktopEdgePerformanceSnapshot {
  scheduledRequests: number;
  coalescedRequests: number;
  frames: number;
  p95FrameIntervalMs: number;
  maxFrameIntervalMs: number;
  p95DeliveryMs: number;
  p95PaintMs: number;
  maxCards: number;
  maxEdges: number;
}

const SAMPLE_LIMIT = 256;

function percentile95(samples: readonly number[]): number {
  if (!samples.length) return 0;
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? 0;
}

/** Bounded, content-free geometry measurements; it never starts a timer. */
export class DesktopEdgePerformanceMetrics {
  private readonly deliverySamples: number[] = [];
  private readonly frameIntervalSamples: number[] = [];
  private readonly paintSamples: number[] = [];
  private scheduledRequests = 0;
  private coalescedRequests = 0;
  private frames = 0;
  private maxCards = 0;
  private maxEdges = 0;
  private lastFrameAtMs?: number;

  request(coalesced: boolean): void {
    this.scheduledRequests++;
    if (coalesced) this.coalescedRequests++;
  }

  frame(
    queueDelayMs: number,
    paintMs: number,
    cardCount: number,
    edgeCount: number,
    frameAtMs: number,
  ): void {
    if (
      ![queueDelayMs, paintMs, frameAtMs].every(Number.isFinite) ||
      queueDelayMs < 0 ||
      paintMs < 0 ||
      !Number.isInteger(cardCount) ||
      cardCount < 0 ||
      !Number.isInteger(edgeCount) ||
      edgeCount < 0
    )
      return;
    this.frames++;
    if (this.lastFrameAtMs !== undefined && frameAtMs >= this.lastFrameAtMs)
      this.push(this.frameIntervalSamples, frameAtMs - this.lastFrameAtMs);
    this.lastFrameAtMs = frameAtMs;
    this.maxCards = Math.max(this.maxCards, cardCount);
    this.maxEdges = Math.max(this.maxEdges, edgeCount);
    this.push(this.deliverySamples, queueDelayMs + paintMs);
    this.push(this.paintSamples, paintMs);
  }

  snapshot(): DesktopEdgePerformanceSnapshot {
    return {
      scheduledRequests: this.scheduledRequests,
      coalescedRequests: this.coalescedRequests,
      frames: this.frames,
      p95FrameIntervalMs: percentile95(this.frameIntervalSamples),
      maxFrameIntervalMs: Math.max(0, ...this.frameIntervalSamples),
      p95DeliveryMs: percentile95(this.deliverySamples),
      p95PaintMs: percentile95(this.paintSamples),
      maxCards: this.maxCards,
      maxEdges: this.maxEdges,
    };
  }

  private push(samples: number[], value: number): void {
    samples.push(value);
    if (samples.length > SAMPLE_LIMIT) samples.shift();
  }
}
