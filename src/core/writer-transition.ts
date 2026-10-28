export type WriterMode = "direct" | "companion";

export interface WriterTransitionHooks {
  setMode(mode: WriterMode | "transition"): void;
  waitForWrites(): Promise<void>;
  requestsPending(): Promise<boolean>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export async function transitionWriterMode(
  previousMode: WriterMode,
  nextMode: WriterMode,
  hooks: WriterTransitionHooks,
): Promise<void> {
  if (previousMode === nextMode) return;
  hooks.setMode("transition");
  try {
    await hooks.waitForWrites();
    const deadline = Date.now() + (hooks.timeoutMs ?? 10_000);
    while (await hooks.requestsPending()) {
      if (Date.now() >= deadline) {
        throw new Error(
          "The companion queue is still pending. Keep the current writer mode and retry after Obsidian processes the queue.",
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, hooks.pollIntervalMs ?? 200),
      );
    }
    hooks.setMode(nextMode);
  } catch (error) {
    hooks.setMode(previousMode);
    throw error;
  }
}
