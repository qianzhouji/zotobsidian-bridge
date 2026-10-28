import {
  MAX_IMAGE_RESOURCE_BYTES,
  type SupportedImageMimeType,
} from "../core/image-resource.ts";

export type CompanionOperation = "create" | "replace" | "create-resource";
export const COMPANION_PROTOCOL_VERSION = 2 as const;

export const MAX_COMPANION_RESOURCE_BYTES = MAX_IMAGE_RESOURCE_BYTES;
export type CompanionImageMimeType = SupportedImageMimeType;

export interface CompanionMarkdownRequest {
  protocolVersion: typeof COMPANION_PROTOCOL_VERSION;
  requestId: string;
  createdAt: string;
  operation: "create" | "replace";
  cardId: string;
  sourceId: string;
  targetVaultId: string;
  outputFolder: string;
  relativePath: string;
  baseRevision: string | null;
  content: string;
  recoveryRelativePath?: string;
  recoveryContent?: string;
}

export interface CompanionResourceRequest {
  protocolVersion: typeof COMPANION_PROTOCOL_VERSION;
  requestId: string;
  createdAt: string;
  operation: "create-resource";
  cardId: string;
  sourceId: string;
  targetVaultId: string;
  outputFolder: string;
  relativePath: string;
  baseRevision: null;
  resourceMimeType: CompanionImageMimeType;
  resourceSha256: string;
  resourceSizeBytes: number;
}

export type CompanionWriteRequest =
  | CompanionMarkdownRequest
  | CompanionResourceRequest;

export type CompanionWriteResponse =
  | {
      protocolVersion: typeof COMPANION_PROTOCOL_VERSION;
      requestId: string;
      status: "applied";
      revision: string;
      completedAt: string;
    }
  | {
      protocolVersion: typeof COMPANION_PROTOCOL_VERSION;
      requestId: string;
      status: "conflict";
      message: string;
      completedAt: string;
    };

export interface CompanionWriteAck {
  protocolVersion: typeof COMPANION_PROTOCOL_VERSION;
  requestId: string;
  acknowledgedAt: string;
}

export function isValidCompanionVaultId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function validateCompanionResponse(
  value: unknown,
  expectedRequestId: string,
): CompanionWriteResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Obsidian returned an invalid companion response.");
  }
  const response = value as Partial<CompanionWriteResponse>;
  const validBase =
    response.protocolVersion === COMPANION_PROTOCOL_VERSION &&
    response.requestId === expectedRequestId &&
    typeof response.completedAt === "string" &&
    Number.isFinite(Date.parse(response.completedAt));
  if (
    validBase &&
    response.status === "applied" &&
    typeof response.revision === "string" &&
    /^[0-9a-f]{64}$/i.test(response.revision)
  ) {
    return response as CompanionWriteResponse;
  }
  if (
    validBase &&
    response.status === "conflict" &&
    typeof response.message === "string" &&
    response.message.length > 0
  ) {
    return response as CompanionWriteResponse;
  }
  throw new Error("Obsidian returned an invalid companion response.");
}

export function validateCompanionAck(
  value: unknown,
  expectedRequestId: string,
): CompanionWriteAck {
  if (!value || typeof value !== "object") {
    throw new Error("Zotero acknowledgement is malformed.");
  }
  const ack = value as Partial<CompanionWriteAck>;
  if (
    ack.protocolVersion !== COMPANION_PROTOCOL_VERSION ||
    ack.requestId !== expectedRequestId ||
    typeof ack.acknowledgedAt !== "string" ||
    !Number.isFinite(Date.parse(ack.acknowledgedAt))
  ) {
    throw new Error("Zotero acknowledgement is malformed.");
  }
  return ack as CompanionWriteAck;
}

export function normalizeVaultRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Companion paths must be normalized Vault-relative paths.");
  }
  return normalized;
}

const resourceExtensions: Record<CompanionImageMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
};

export function companionImageExtension(
  mimeType: CompanionImageMimeType,
): string {
  return resourceExtensions[mimeType];
}

export function assertAllowedCompanionPath(
  relativePath: string,
  outputFolder: string,
): string {
  const path = normalizeVaultRelativePath(relativePath);
  const root = normalizeVaultRelativePath(outputFolder);
  if (!path.startsWith(`${root}/`)) {
    throw new Error(
      "Companion requests may only target the configured output folder.",
    );
  }
  return path;
}

export function assertCompanionVaultPairing(
  requestVaultId: string,
  configuredVaultId: string,
): void {
  if (requestVaultId !== configuredVaultId) {
    throw new Error("Request is paired with a different Obsidian Vault.");
  }
}

export function validateCompanionRequest(
  value: unknown,
  configuredOutputFolder: string,
): CompanionWriteRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Companion request must be an object.");
  }
  const request = value as Omit<
    Partial<CompanionMarkdownRequest>,
    "operation"
  > & {
    operation?: CompanionOperation;
    resourceMimeType?: unknown;
    resourceSha256?: unknown;
    resourceSizeBytes?: unknown;
  };
  const sourceIdentity =
    typeof request.sourceId === "string"
      ? /^(user|group|feed):\d+\/(annotation|note|paper)\/[A-Za-z0-9_-]+$/.exec(
          request.sourceId,
        )
      : null;
  const validCardID =
    sourceIdentity?.[2] === "paper"
      ? request.cardId === request.sourceId
      : (sourceIdentity?.[2] === "annotation" ||
          sourceIdentity?.[2] === "note") &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          request.cardId || "",
        );
  const invalidFields: string[] = [];
  if (request.protocolVersion !== COMPANION_PROTOCOL_VERSION) {
    invalidFields.push("protocolVersion");
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      request.requestId || "",
    )
  ) {
    invalidFields.push("requestId");
  }
  if (
    !["create", "replace", "create-resource"].includes(request.operation || "")
  ) {
    invalidFields.push("operation");
  }
  if (typeof request.cardId !== "string" || !request.cardId || !validCardID) {
    invalidFields.push("cardId");
  }
  if (typeof request.sourceId !== "string" || !sourceIdentity) {
    invalidFields.push("sourceId");
  }
  if (!isValidCompanionVaultId(request.targetVaultId)) {
    invalidFields.push("targetVaultId");
  }
  if (typeof request.createdAt !== "string") invalidFields.push("createdAt");
  const isResource = request.operation === "create-resource";
  if (!isResource && typeof request.content !== "string") {
    invalidFields.push("content");
  }
  if (isResource && request.content !== undefined) {
    invalidFields.push("content");
  }
  if (
    request.outputFolder !== normalizeVaultRelativePath(configuredOutputFolder)
  ) {
    invalidFields.push("outputFolder");
  }
  if (
    (request.operation === "create" || isResource) &&
    request.baseRevision !== null
  ) {
    invalidFields.push("baseRevision");
  }
  if (
    request.operation === "replace" &&
    (typeof request.baseRevision !== "string" ||
      !/^[0-9a-f]{64}$/i.test(request.baseRevision))
  ) {
    invalidFields.push("baseRevision");
  }
  if (invalidFields.length > 0) {
    throw new Error(
      `Companion request is malformed or incompatible (${invalidFields.join(", ")}).`,
    );
  }
  const relativePath = assertAllowedCompanionPath(
    request.relativePath || "",
    configuredOutputFolder,
  );
  if (isResource) {
    const mimeType = request.resourceMimeType as CompanionImageMimeType;
    const extension = resourceExtensions[mimeType];
    const hash = request.resourceSha256;
    const sizeBytes = request.resourceSizeBytes;
    const filename = relativePath.split("/").at(-1) || "";
    if (
      !extension ||
      typeof hash !== "string" ||
      !/^[0-9a-f]{64}$/i.test(hash) ||
      !Number.isSafeInteger(sizeBytes) ||
      (sizeBytes as number) <= 0 ||
      (sizeBytes as number) > MAX_COMPANION_RESOURCE_BYTES ||
      !filename.endsWith(`-${hash}.${extension}`) ||
      !relativePath.split("/").includes("assets")
    ) {
      throw new Error("Companion image resource metadata is malformed.");
    }
    if (request.recoveryRelativePath || request.recoveryContent !== undefined) {
      throw new Error("Image resource requests cannot contain recovery data.");
    }
    return { ...request, relativePath } as CompanionResourceRequest;
  }
  if (!relativePath.toLowerCase().endsWith(".md")) {
    throw new Error(
      "Companion requests may only create or replace Markdown notes.",
    );
  }
  if (
    request.recoveryRelativePath !== undefined &&
    typeof request.recoveryRelativePath !== "string"
  ) {
    throw new Error("Companion recovery path is malformed.");
  }
  if (
    request.recoveryContent !== undefined &&
    typeof request.recoveryContent !== "string"
  ) {
    throw new Error("Companion recovery content is malformed.");
  }
  if (
    request.recoveryRelativePath &&
    !assertAllowedCompanionPath(
      request.recoveryRelativePath,
      configuredOutputFolder,
    ).endsWith(".bak")
  ) {
    throw new Error("Companion recovery files must use the .bak extension.");
  }
  if (
    Boolean(request.recoveryRelativePath) !== Boolean(request.recoveryContent)
  ) {
    throw new Error(
      "Companion recovery path and content must be provided together.",
    );
  }
  return { ...request, relativePath } as CompanionWriteRequest;
}
