/** Independent, read-only protocol. No desktop, filesystem, or write-queue imports. */
export const NOTE_QUERY_PROTOCOL_VERSION = 1 as const;
export const NOTE_QUERY_NAMESPACE = "note-query";
export const NOTE_QUERY_OPERATIONS = [
  "search-notes",
  "resolve-link",
  "read-note",
  "read-note-resource",
] as const;
export const NOTE_QUERY_LIMITS = {
  maxTTL: 30_000,
  maxConcurrent: 4,
  maxQueryLength: 256,
  maxPathLength: 1024,
  maxResults: 50,
  maxRequestBytes: 16 * 1024,
  maxNoteBytes: 2 * 1024 * 1024,
  maxResourceBytes: 5 * 1024 * 1024,
  maxResponseBytes: 16 * 1024 * 1024,
  maxMetadataEntries: 4096,
} as const;
export const NOTE_QUERY_CAPABILITIES_TTL = 120_000;
export type NoteQueryOperation = (typeof NOTE_QUERY_OPERATIONS)[number];
export type NoteQueryStatus =
  | "ok"
  | "not-found"
  | "anchor-not-found"
  | "forbidden"
  | "unsupported"
  | "too-large"
  | "indexing"
  | "offline"
  | "timeout"
  | "invalid-request"
  | "busy"
  | "stale";
export interface NoteQueryEnvelope {
  readProtocolVersion: typeof NOTE_QUERY_PROTOCOL_VERSION;
  requestId: string;
  targetVaultId: string;
  pairingEpoch: string;
  clientSessionId: string;
  generation: number;
  operation: NoteQueryOperation;
  issuedAt: number;
  expiresAt: number;
}
export interface NoteQueryInputMap {
  "search-notes": {
    query: string;
    sourcePath: string;
    limit?: number;
    cursor?: string;
  };
  "resolve-link": { linkpath: string; sourcePath: string };
  "read-note": { path: string };
  "read-note-resource": { linkpath: string; sourcePath: string };
}
export type NoteQueryRequest = {
  [K in NoteQueryOperation]: NoteQueryEnvelope & {
    operation: K;
    input: NoteQueryInputMap[K];
  };
}[NoteQueryOperation];
export interface NoteQueryPosition {
  start: { line: number; col: number; offset: number };
  end: { line: number; col: number; offset: number };
}
export interface NoteQueryMetadata {
  valid: boolean;
  revision?: string;
  headings: { heading: string; level: number; position: NoteQueryPosition }[];
  blocks: { id: string; position: NoteQueryPosition }[];
}
export interface NoteQueryResultMap {
  "search-notes": {
    items: {
      path: string;
      basename: string;
      title: string;
      matchedAlias?: string;
    }[];
    indexGeneration: number;
    cursor?: string;
  };
  "resolve-link": {
    path: string;
    fragment?: string;
    revision: string;
    indexGeneration: number;
    anchorState: "none" | "found" | "missing" | "ambiguous" | "indexing";
    anchor?: {
      kind: "heading" | "block";
      id: string;
      position: NoteQueryPosition;
    };
  };
  "read-note": {
    path: string;
    markdown: string;
    revision: string;
    indexGeneration: number;
    readAt: number;
    metadata: NoteQueryMetadata;
  };
  "read-note-resource": {
    path: string;
    mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
    base64: string;
    byteLength: number;
    revision: string;
    readAt: number;
  };
}
export type NoteQueryResponse = {
  [K in NoteQueryOperation]: NoteQueryEnvelope & {
    operation: K;
    respondedAt: number;
  } & (
      | { status: "ok"; result: NoteQueryResultMap[K] }
      | { status: Exclude<NoteQueryStatus, "ok">; message?: string }
    );
}[NoteQueryOperation];
export interface NoteQueryCapabilities {
  readProtocolVersion: typeof NOTE_QUERY_PROTOCOL_VERSION;
  targetVaultId: string;
  pairingEpoch: string;
  enabled: boolean;
  ready: boolean;
  operations: NoteQueryOperation[];
  readFolders: string[];
  limits: typeof NOTE_QUERY_LIMITS;
  indexGeneration: number;
  updatedAt: number;
  expiresAt: number;
}

function check(condition: unknown): asserts condition {
  if (!condition) throw new Error("Invalid or expired note-query message.");
}
function object(value: unknown): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  check(Object.keys(value).every((key) => keys.includes(key)));
}
function string(
  value: unknown,
  max: number,
  empty = false,
): asserts value is string {
  check(
    typeof value === "string" &&
      value.length <= max &&
      (empty || value.length > 0),
  );
}
function integer(
  value: unknown,
  max = Number.MAX_SAFE_INTEGER,
): asserts value is number {
  check(
    Number.isSafeInteger(value) &&
      (value as number) >= 0 &&
      (value as number) <= max,
  );
}
function token(value: unknown): void {
  string(value, 128);
  check(/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value));
}
/** Canonical Vault-relative paths only; raw links have a separate validator. */
export function validateNoteQueryPath(value: unknown): string {
  string(value, NOTE_QUERY_LIMITS.maxPathLength);
  check(!/[\\:%?#]/.test(value) && !hasControl(value));
  check(
    value.split("/").every((part) => part && part !== "." && part !== ".."),
  );
  return value;
}
function link(value: unknown): void {
  string(value, NOTE_QUERY_LIMITS.maxPathLength);
  check(
    !/^[/\\]|\\|^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !hasControl(value),
  );
  // Encoded path syntax is not canonical. The client decodes Markdown URLs once.
  check(!/%[0-9a-f]{2}/i.test(value) && !value.includes(":"));
}
function hasControl(value: string): boolean {
  return [...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
}
const envelopeKeys = [
  "readProtocolVersion",
  "requestId",
  "targetVaultId",
  "pairingEpoch",
  "clientSessionId",
  "generation",
  "operation",
  "issuedAt",
  "expiresAt",
];
function envelope(value: Record<string, unknown>, now: number): void {
  check(value.readProtocolVersion === NOTE_QUERY_PROTOCOL_VERSION);
  for (const key of [
    "requestId",
    "targetVaultId",
    "pairingEpoch",
    "clientSessionId",
  ])
    token(value[key]);
  integer(value.generation);
  check(NOTE_QUERY_OPERATIONS.includes(value.operation as NoteQueryOperation));
  lifetime(value.issuedAt, value.expiresAt, now);
}
function lifetime(start: unknown, end: unknown, now: number): void {
  integer(start);
  integer(end);
  check(
    start <= now + 1000 &&
      end > now &&
      end > start &&
      end - start <= NOTE_QUERY_LIMITS.maxTTL,
  );
}
function capabilitiesLifetime(start: unknown, end: unknown, now: number): void {
  integer(start);
  integer(end);
  check(
    start <= now + 1000 &&
      end > now &&
      end > start &&
      end - start <= NOTE_QUERY_CAPABILITIES_TTL,
  );
}
function boundedJSON(value: unknown, max: number): void {
  check(new TextEncoder().encode(JSON.stringify(value)).byteLength <= max);
}
export function validateNoteQueryRequest(
  value: unknown,
  now = Date.now(),
): NoteQueryRequest {
  boundedJSON(value, NOTE_QUERY_LIMITS.maxRequestBytes);
  const request = object(value);
  exact(request, [...envelopeKeys, "input"]);
  envelope(request, now);
  const input = object(request.input);
  switch (request.operation) {
    case "search-notes":
      exact(input, ["query", "sourcePath", "limit", "cursor"]);
      string(input.query, NOTE_QUERY_LIMITS.maxQueryLength, true);
      validateNoteQueryPath(input.sourcePath);
      if (input.limit !== undefined) {
        integer(input.limit, NOTE_QUERY_LIMITS.maxResults);
        check(input.limit > 0);
      }
      if (input.cursor !== undefined) {
        string(input.cursor, 160);
        check(/^\d+:\d+:[a-f0-9]{64}$/.test(input.cursor));
      }
      break;
    case "read-note":
      exact(input, ["path"]);
      validateNoteQueryPath(input.path);
      break;
    default:
      exact(input, ["linkpath", "sourcePath"]);
      link(input.linkpath);
      validateNoteQueryPath(input.sourcePath);
  }
  return value as NoteQueryRequest;
}
function revision(value: unknown): void {
  check(typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
}
function position(value: unknown, length = Number.MAX_SAFE_INTEGER): void {
  const pos = object(value);
  exact(pos, ["start", "end"]);
  for (const key of ["start", "end"]) {
    const point = object(pos[key]);
    exact(point, ["line", "col", "offset"]);
    integer(point.line);
    integer(point.col);
    integer(point.offset, length);
  }
  check(
    (pos.start as { offset: number }).offset <=
      (pos.end as { offset: number }).offset,
  );
}
function metadata(value: unknown, hash: unknown, length: number): void {
  const data = object(value);
  exact(data, ["valid", "revision", "headings", "blocks"]);
  check(typeof data.valid === "boolean");
  check(
    Array.isArray(data.headings) &&
      data.headings.length <= NOTE_QUERY_LIMITS.maxMetadataEntries,
  );
  check(
    Array.isArray(data.blocks) &&
      data.blocks.length <= NOTE_QUERY_LIMITS.maxMetadataEntries,
  );
  if (data.valid) check(data.revision === hash);
  else
    check(
      data.revision === undefined &&
        !data.headings.length &&
        !data.blocks.length,
    );
  for (const value of data.headings) {
    const item = object(value);
    exact(item, ["heading", "level", "position"]);
    string(item.heading, 1024);
    integer(item.level, 6);
    check(item.level > 0);
    position(item.position, length);
  }
  for (const value of data.blocks) {
    const item = object(value);
    exact(item, ["id", "position"]);
    string(item.id, 1024);
    position(item.position, length);
  }
}
export function validateNoteQueryResponse(
  value: unknown,
  now = Date.now(),
): NoteQueryResponse {
  boundedJSON(value, NOTE_QUERY_LIMITS.maxResponseBytes);
  const response = object(value);
  exact(response, [
    ...envelopeKeys,
    "respondedAt",
    "status",
    "result",
    "message",
  ]);
  envelope(response, now);
  integer(response.respondedAt);
  check(
    response.respondedAt >= (response.issuedAt as number) &&
      response.respondedAt <= now + 1000 &&
      response.respondedAt < (response.expiresAt as number),
  );
  if (response.status !== "ok") {
    check(
      [
        "not-found",
        "anchor-not-found",
        "forbidden",
        "unsupported",
        "too-large",
        "indexing",
        "offline",
        "timeout",
        "invalid-request",
        "busy",
        "stale",
      ].includes(response.status as string),
    );
    check(response.result === undefined);
    if (response.message !== undefined) string(response.message, 256);
    return value as NoteQueryResponse;
  }
  check(response.message === undefined);
  const result = object(response.result);
  if (response.operation === "search-notes") {
    exact(result, ["items", "indexGeneration", "cursor"]);
    integer(result.indexGeneration);
    check(
      Array.isArray(result.items) &&
        result.items.length <= NOTE_QUERY_LIMITS.maxResults,
    );
    for (const value of result.items) {
      const item = object(value);
      exact(item, ["path", "basename", "title", "matchedAlias"]);
      validateNoteQueryPath(item.path);
      string(item.basename, 1024);
      string(item.title, 1024);
      if (item.matchedAlias !== undefined) string(item.matchedAlias, 1024);
    }
    if (result.cursor !== undefined) {
      string(result.cursor, 160);
      check(/^\d+:\d+:[a-f0-9]{64}$/.test(result.cursor));
    }
  } else {
    validateNoteQueryPath(result.path);
    revision(result.revision);
    if (response.operation === "read-note") {
      exact(result, [
        "path",
        "markdown",
        "revision",
        "indexGeneration",
        "readAt",
        "metadata",
      ]);
      string(result.markdown, NOTE_QUERY_LIMITS.maxNoteBytes, true);
      check(
        new TextEncoder().encode(result.markdown).byteLength <=
          NOTE_QUERY_LIMITS.maxNoteBytes,
      );
      integer(result.indexGeneration);
      integer(result.readAt);
      metadata(result.metadata, result.revision, result.markdown.length);
    } else if (response.operation === "resolve-link") {
      exact(result, [
        "path",
        "fragment",
        "revision",
        "indexGeneration",
        "anchor",
        "anchorState",
      ]);
      integer(result.indexGeneration);
      check(
        ["none", "found", "missing", "ambiguous", "indexing"].includes(
          result.anchorState as string,
        ),
      );
      check((result.anchorState === "found") === (result.anchor !== undefined));
      if (result.fragment !== undefined) string(result.fragment, 1024);
      if (result.anchor !== undefined) {
        const anchor = object(result.anchor);
        exact(anchor, ["kind", "id", "position"]);
        check(anchor.kind === "heading" || anchor.kind === "block");
        string(anchor.id, 1024);
        position(anchor.position);
        check(typeof result.fragment === "string");
      }
    } else {
      exact(result, [
        "path",
        "mimeType",
        "base64",
        "byteLength",
        "revision",
        "readAt",
      ]);
      check(
        ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
          result.mimeType as string,
        ),
      );
      integer(result.byteLength, NOTE_QUERY_LIMITS.maxResourceBytes);
      check(result.byteLength > 0);
      integer(result.readAt);
      string(
        result.base64,
        Math.ceil(NOTE_QUERY_LIMITS.maxResourceBytes / 3) * 4,
      );
      check(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          result.base64,
        ),
      );
      const padding = result.base64.endsWith("==")
        ? 2
        : result.base64.endsWith("=")
          ? 1
          : 0;
      check((result.base64.length / 4) * 3 - padding === result.byteLength);
    }
  }
  return value as NoteQueryResponse;
}
export function validateNoteQueryCapabilities(
  value: unknown,
  now = Date.now(),
): NoteQueryCapabilities {
  boundedJSON(value, NOTE_QUERY_LIMITS.maxRequestBytes);
  const caps = object(value);
  exact(caps, [
    "readProtocolVersion",
    "targetVaultId",
    "pairingEpoch",
    "enabled",
    "ready",
    "operations",
    "readFolders",
    "limits",
    "indexGeneration",
    "updatedAt",
    "expiresAt",
  ]);
  check(caps.readProtocolVersion === NOTE_QUERY_PROTOCOL_VERSION);
  token(caps.targetVaultId);
  token(caps.pairingEpoch);
  check(typeof caps.enabled === "boolean" && typeof caps.ready === "boolean");
  check(
    Array.isArray(caps.operations) &&
      caps.operations.length === NOTE_QUERY_OPERATIONS.length &&
      NOTE_QUERY_OPERATIONS.every((operation) =>
        (caps.operations as unknown[]).includes(operation),
      ),
  );
  check(Array.isArray(caps.readFolders) && caps.readFolders.length <= 32);
  caps.readFolders.forEach(validateNoteQueryPath);
  integer(caps.indexGeneration);
  capabilitiesLifetime(caps.updatedAt, caps.expiresAt, now);
  const limits = object(caps.limits);
  exact(limits, Object.keys(NOTE_QUERY_LIMITS));
  for (const [key, value] of Object.entries(NOTE_QUERY_LIMITS))
    check(limits[key] === value);
  return value as NoteQueryCapabilities;
}
