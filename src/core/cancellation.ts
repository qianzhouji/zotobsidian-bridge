export interface CancellationSignal {
  readonly aborted: boolean;
}

export interface CancellationController {
  readonly signal: CancellationSignal;
  abort(): void;
}

export function createCancellationController(): CancellationController {
  const signal = { aborted: false };
  return {
    signal,
    abort() {
      signal.aborted = true;
    },
  };
}
