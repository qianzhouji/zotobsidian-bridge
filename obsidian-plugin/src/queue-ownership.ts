import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

interface OwnershipRecord {
  ownerToken: string;
  pid: number;
  vaultId: string;
  acquiredAt: string;
}

export class QueueOwnershipError extends Error {}

export interface QueueOwnership {
  lockPath: string;
  ownerToken: string;
  release(): Promise<void>;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readOwnership(lockPath: string): Promise<OwnershipRecord> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(lockPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw new QueueOwnershipError(
      `Cannot verify companion queue ownership (${String(error)}).`,
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as OwnershipRecord).ownerToken !== "string" ||
    !Number.isSafeInteger((value as OwnershipRecord).pid) ||
    typeof (value as OwnershipRecord).vaultId !== "string"
  ) {
    throw new QueueOwnershipError(
      "The companion queue has an unreadable owner lock; resolve it before processing requests.",
    );
  }
  return value as OwnershipRecord;
}

async function createOwnership(
  lockPath: string,
  record: OwnershipRecord,
): Promise<QueueOwnership> {
  let handle;
  try {
    handle = await fs.open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new QueueOwnershipError(
        "The companion queue is owned by another Obsidian instance.",
      );
    }
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify(record));
  } catch (error) {
    await handle.close();
    await fs.rm(lockPath, { force: true });
    throw error;
  }
  await handle.close();
  return {
    lockPath,
    ownerToken: record.ownerToken,
    async release() {
      try {
        const current = await readOwnership(lockPath);
        if (current.ownerToken === record.ownerToken) {
          await fs.rm(lockPath, { force: true });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}

export async function acquireQueueOwnership(
  queueRoot: string,
  vaultId: string,
): Promise<QueueOwnership> {
  const root = path.resolve(queueRoot);
  await fs.mkdir(root, { recursive: true });
  const lockPath = path.join(root, ".zotero-obsidian-bridge-owner.json");
  const record: OwnershipRecord = {
    ownerToken: randomUUID(),
    pid: process.pid,
    vaultId,
    acquiredAt: new Date().toISOString(),
  };

  try {
    return await createOwnership(lockPath, record);
  } catch (error) {
    if (!(error instanceof QueueOwnershipError)) throw error;
  }

  const previous = await readOwnership(lockPath);
  if (processIsAlive(previous.pid)) {
    throw new QueueOwnershipError(
      `The companion queue is owned by Obsidian process ${previous.pid}.`,
    );
  }

  const reclaimPath = `${lockPath}.reclaim`;
  let reclaimHandle;
  try {
    reclaimHandle = await fs.open(reclaimPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new QueueOwnershipError(
        "A stale companion queue lock is being recovered by another instance.",
      );
    }
    throw error;
  }

  try {
    const current = await readOwnership(lockPath);
    if (current.ownerToken !== previous.ownerToken) {
      if (processIsAlive(current.pid)) {
        throw new QueueOwnershipError(
          `The companion queue is owned by Obsidian process ${current.pid}.`,
        );
      }
    }
    if (processIsAlive(current.pid)) {
      throw new QueueOwnershipError(
        `The companion queue is owned by Obsidian process ${current.pid}.`,
      );
    }
    await fs.rm(lockPath, { force: true });
    return await createOwnership(lockPath, record);
  } finally {
    await reclaimHandle.close();
    await fs.rm(reclaimPath, { force: true });
  }
}
