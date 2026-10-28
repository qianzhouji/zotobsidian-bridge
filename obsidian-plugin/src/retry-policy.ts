const retryableFileErrors = new Set([
  "EACCES",
  "EBUSY",
  "EIO",
  "ENOENT",
  "EMFILE",
  "ENFILE",
  "ENOSPC",
  "EPERM",
]);

export function isRetryableFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return retryableFileErrors.has(code || "");
}

export function retryDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt)
    ? Math.max(1, Math.floor(attempt))
    : 1;
  return Math.min(30_000, 1_000 * 2 ** (safeAttempt - 1));
}
