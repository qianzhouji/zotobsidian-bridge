import { promises as fs } from "node:fs";
import path from "node:path";

export function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

async function resolveExistingPath(candidate: string): Promise<string> {
  let current = path.resolve(candidate);
  while (true) {
    let entry: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      entry = await fs.lstat(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
      continue;
    }
    try {
      return await fs.realpath(current);
    } catch (error) {
      if (entry.isSymbolicLink()) {
        throw new Error(`Cannot resolve symbolic link in path: ${current}`, {
          cause: error,
        });
      }
      throw error;
    }
  }
}

export async function assertQueueOutsideVault(
  vaultRootPath: string,
  queuePath: string,
): Promise<void> {
  const [vaultRoot, resolvedQueue] = await Promise.all([
    fs.realpath(vaultRootPath),
    resolveExistingPath(queuePath),
  ]);
  if (isPathWithin(vaultRoot, resolvedQueue)) {
    throw new Error(
      "Keep the local request queue outside the Obsidian Vault, including through symbolic links.",
    );
  }
}

export async function assertVaultPathContained(
  vaultRootPath: string,
  relativePath: string,
): Promise<void> {
  const vaultRoot = await fs.realpath(vaultRootPath);
  const target = await resolveExistingPath(
    path.resolve(vaultRootPath, relativePath),
  );
  if (!isPathWithin(vaultRoot, target)) {
    throw new Error("Vault path resolves outside the configured Vault.");
  }
}
