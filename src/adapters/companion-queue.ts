import {
  type CompanionOperation,
  type CompanionImageMimeType,
  type CompanionResourceRequest,
  type CompanionWriteRequest,
  type CompanionWriteResponse,
  COMPANION_PROTOCOL_VERSION,
  normalizeVaultRelativePath,
  validateCompanionAck,
  validateCompanionResponse,
} from "./companion-protocol.ts";

const prefPrefix = "extensions.zotero.zoteroobsidianbridge";
const responseTimeoutMs = 1500;
const pollIntervalMs = 200;

export class CompanionPendingError extends Error {
  public readonly requestId: string;

  constructor(requestId: string) {
    super(
      `Obsidian has not acknowledged request ${requestId}. The request remains queued; no direct-write fallback was used.`,
    );
    this.name = "CompanionPendingError";
    this.requestId = requestId;
  }
}

export type CompanionRequestOutcome =
  | { status: "pending" }
  | { status: "applied"; revision: string }
  | { status: "conflict"; message: string }
  | { status: "completed" };

function queueDirectory(): string {
  const value = Zotero.Prefs.get(`${prefPrefix}.companionQueuePath`, true);
  const path = typeof value === "string" ? value.trim() : "";
  if (!path || !PathUtils.isAbsolute(path)) {
    throw new Error(
      "Set the absolute companion queue folder in Zotero settings.",
    );
  }
  return PathUtils.normalize(path);
}

export async function getCompanionRequestOutcome(
  requestId: string,
): Promise<CompanionRequestOutcome> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    throw new Error("Invalid companion request ID.");
  }
  const root = queueDirectory();
  const responsePath = PathUtils.join(root, "responses", `${requestId}.json`);
  if (await IOUtils.exists(responsePath)) {
    const response = validateCompanionResponse(
      await IOUtils.readJSON(responsePath),
      requestId,
    );
    return response.status === "applied"
      ? { status: "applied", revision: response.revision }
      : { status: "conflict", message: response.message };
  }
  const requestPath = PathUtils.join(root, "requests", `${requestId}.json`);
  return (await IOUtils.exists(requestPath))
    ? { status: "pending" }
    : { status: "completed" };
}

async function writeNewJSON(filePath: string, value: unknown): Promise<void> {
  const parent = PathUtils.parent(filePath);
  if (!parent) throw new Error("Could not resolve companion queue path.");
  await IOUtils.makeDirectory(parent, {
    createAncestors: true,
    ignoreExisting: true,
  });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await IOUtils.writeUTF8(temporaryPath, JSON.stringify(value), {
    mode: "create",
    flush: true,
  });
  try {
    await IOUtils.move(temporaryPath, filePath, { noOverwrite: true });
  } catch (error) {
    await IOUtils.remove(temporaryPath, { ignoreAbsent: true }).catch(() => {});
    throw error;
  }
}

async function writeNewBinary(
  filePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const parent = PathUtils.parent(filePath);
  if (!parent) throw new Error("Could not resolve companion payload path.");
  await IOUtils.makeDirectory(parent, {
    createAncestors: true,
    ignoreExisting: true,
  });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await IOUtils.write(temporaryPath, bytes, { mode: "create", flush: true });
  try {
    await IOUtils.move(temporaryPath, filePath, { noOverwrite: true });
  } catch (error) {
    await IOUtils.remove(temporaryPath, { ignoreAbsent: true }).catch(() => {});
    throw error;
  }
}

async function writeCompanionAck(
  ackPath: string,
  requestId: string,
): Promise<void> {
  const ack = {
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    requestId,
    acknowledgedAt: new Date().toISOString(),
  };
  try {
    await writeNewJSON(ackPath, ack);
  } catch (error) {
    if (!(await IOUtils.exists(ackPath))) throw error;
    validateCompanionAck(await IOUtils.readJSON(ackPath), requestId);
  }
}

export async function submitCompanionWrite(input: {
  operation: Exclude<CompanionOperation, "create-resource">;
  cardId: string;
  sourceId: string;
  targetVaultId: string;
  outputFolder: string;
  relativePath: string;
  baseRevision: string | null;
  content: string;
  recoveryRelativePath?: string;
  recoveryContent?: string;
}): Promise<void> {
  const root = queueDirectory();
  const requestId = crypto.randomUUID();
  const request: CompanionWriteRequest = {
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    requestId,
    createdAt: new Date().toISOString(),
    ...input,
    outputFolder: normalizeVaultRelativePath(input.outputFolder),
    relativePath: normalizeVaultRelativePath(input.relativePath),
    recoveryRelativePath: input.recoveryRelativePath
      ? normalizeVaultRelativePath(input.recoveryRelativePath)
      : undefined,
  };
  const requestPath = PathUtils.join(root, "requests", `${requestId}.json`);
  const responsePath = PathUtils.join(root, "responses", `${requestId}.json`);
  const ackPath = PathUtils.join(root, "acks", `${requestId}.json`);
  await writeNewJSON(requestPath, request);

  const deadline = Date.now() + responseTimeoutMs;
  while (Date.now() < deadline) {
    if (await IOUtils.exists(responsePath)) {
      const response = validateCompanionResponse(
        await IOUtils.readJSON(responsePath),
        requestId,
      );
      if (response.status === "conflict") {
        await writeCompanionAck(ackPath, requestId);
        throw new Error(
          response.message || "Obsidian rejected the Vault write.",
        );
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new CompanionPendingError(requestId);
}

export async function submitCompanionResource(input: {
  cardId: string;
  sourceId: string;
  targetVaultId: string;
  outputFolder: string;
  relativePath: string;
  resourceMimeType: CompanionImageMimeType;
  resourceSha256: string;
  bytes: Uint8Array;
}): Promise<void> {
  const root = queueDirectory();
  const requestId = crypto.randomUUID();
  const request: CompanionResourceRequest = {
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    requestId,
    createdAt: new Date().toISOString(),
    operation: "create-resource",
    cardId: input.cardId,
    sourceId: input.sourceId,
    targetVaultId: input.targetVaultId,
    outputFolder: normalizeVaultRelativePath(input.outputFolder),
    relativePath: normalizeVaultRelativePath(input.relativePath),
    baseRevision: null,
    resourceMimeType: input.resourceMimeType,
    resourceSha256: input.resourceSha256,
    resourceSizeBytes: input.bytes.byteLength,
  };
  const payloadPath = PathUtils.join(root, "payloads", `${requestId}.bin`);
  const requestPath = PathUtils.join(root, "requests", `${requestId}.json`);
  const responsePath = PathUtils.join(root, "responses", `${requestId}.json`);
  const ackPath = PathUtils.join(root, "acks", `${requestId}.json`);
  await writeNewBinary(payloadPath, input.bytes);
  try {
    await writeNewJSON(requestPath, request);
  } catch (error) {
    await IOUtils.remove(payloadPath, { ignoreAbsent: true }).catch(() => {});
    throw error;
  }

  const deadline = Date.now() + responseTimeoutMs;
  while (Date.now() < deadline) {
    if (await IOUtils.exists(responsePath)) {
      const response = validateCompanionResponse(
        await IOUtils.readJSON(responsePath),
        requestId,
      );
      if (response.status === "conflict") {
        await writeCompanionAck(ackPath, requestId);
        throw new Error(
          response.message || "Obsidian rejected the image resource.",
        );
      }
      await writeCompanionAck(ackPath, requestId);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new CompanionPendingError(requestId);
}

export async function hasPendingCompanionRequests(): Promise<boolean> {
  const requestDirectory = PathUtils.join(queueDirectory(), "requests");
  const requests = await IOUtils.getChildren(requestDirectory, {
    ignoreAbsent: true,
  });
  return requests.some((requestPath) =>
    /^[0-9a-f-]{36}\.json$/i.test(PathUtils.split(requestPath).at(-1) || ""),
  );
}

export async function acknowledgeCompanionResponses(
  beforeAcknowledge: (sourceIDs: string[]) => Promise<void>,
): Promise<string[]> {
  const root = queueDirectory();
  const requestDirectory = PathUtils.join(root, "requests");
  const responseDirectory = PathUtils.join(root, "responses");
  const ackDirectory = PathUtils.join(root, "acks");
  const responsePaths = await IOUtils.getChildren(responseDirectory, {
    ignoreAbsent: true,
  });
  const reconciledSources = new Set<string>();
  const acknowledgements: Array<{ requestId: string; path: string }> = [];

  for (const responsePath of responsePaths) {
    const requestId = PathUtils.split(responsePath)
      .at(-1)
      ?.replace(/\.json$/i, "");
    if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) continue;
    const requestPath = PathUtils.join(requestDirectory, `${requestId}.json`);
    if (!(await IOUtils.exists(requestPath))) continue;
    const ackPath = PathUtils.join(ackDirectory, `${requestId}.json`);
    if (await IOUtils.exists(ackPath)) continue;

    let response: CompanionWriteResponse;
    try {
      response = validateCompanionResponse(
        await IOUtils.readJSON(responsePath),
        requestId,
      );
    } catch {
      continue;
    }
    if (response.status === "applied") {
      try {
        const request = (await IOUtils.readJSON(
          requestPath,
        )) as Partial<CompanionWriteRequest>;
        if (request.operation !== "create-resource") {
          if (
            typeof request.sourceId === "string" &&
            /^(user|group|feed):\d+\/(annotation|note)\/[A-Za-z0-9_-]+$/.test(
              request.sourceId,
            )
          ) {
            reconciledSources.add(request.sourceId);
          } else if (
            typeof request.sourceId !== "string" ||
            !/^(user|group|feed):\d+\/paper\/[A-Za-z0-9_-]+$/.test(
              request.sourceId,
            )
          ) {
            continue;
          }
        }
      } catch {
        continue;
      }
    }
    acknowledgements.push({ requestId, path: ackPath });
  }

  const sourceIDs = [...reconciledSources];
  if (sourceIDs.length > 0) await beforeAcknowledge(sourceIDs);

  for (const { requestId, path } of acknowledgements) {
    await writeCompanionAck(path, requestId);
  }
  return sourceIDs;
}
