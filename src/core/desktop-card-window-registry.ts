export type DesktopCardWindowState =
  | "opening"
  | "ready"
  | "closing"
  | "closed"
  | "failed";

export interface DesktopCardWindowIdentity {
  profileInstanceId: string;
  ownerWindowId: string;
  rootSessionId: string;
  groupId: string;
  vaultId: string;
  pairingEpoch: string;
  canonicalPath: string;
}

export interface DesktopCardWindowLease {
  id: string;
  generation: number;
  identity: DesktopCardWindowIdentity;
  state: DesktopCardWindowState;
}

export type DesktopCardWindowReservation =
  | { status: "reserved" | "existing"; lease: DesktopCardWindowLease }
  | { status: "group-limit" | "owner-limit" };

const ACTIVE_STATES = new Set<DesktopCardWindowState>([
  "opening",
  "ready",
  "closing",
]);

const TRANSITIONS: Record<
  DesktopCardWindowState,
  ReadonlySet<DesktopCardWindowState>
> = {
  opening: new Set(["ready", "closing", "failed"]),
  ready: new Set(["closing", "failed"]),
  closing: new Set(["closed", "failed"]),
  failed: new Set(["closing", "closed"]),
  closed: new Set(),
};

function identityKey(identity: DesktopCardWindowIdentity): string {
  return JSON.stringify([
    identity.profileInstanceId,
    identity.ownerWindowId,
    identity.rootSessionId,
    identity.groupId,
    identity.vaultId,
    identity.pairingEpoch,
    identity.canonicalPath,
  ]);
}

function groupKey(identity: DesktopCardWindowIdentity): string {
  return JSON.stringify([
    identity.profileInstanceId,
    identity.ownerWindowId,
    identity.rootSessionId,
    identity.groupId,
    identity.vaultId,
    identity.pairingEpoch,
  ]);
}

function ownerKey(identity: DesktopCardWindowIdentity): string {
  return JSON.stringify([identity.profileInstanceId, identity.ownerWindowId]);
}

/** Tracks desktop card windows without coupling identity to their DOM documents. */
export class DesktopCardWindowRegistry {
  private readonly byKey = new Map<string, DesktopCardWindowLease>();
  private readonly byID = new Map<string, DesktopCardWindowLease>();
  private nextID = 0;
  private generation = 0;
  readonly groupLimit: number;
  readonly ownerLimit: number;

  constructor(groupLimit = 8, ownerLimit = 16) {
    this.groupLimit = groupLimit;
    this.ownerLimit = ownerLimit;
  }

  reserve(identity: DesktopCardWindowIdentity): DesktopCardWindowReservation {
    const key = identityKey(identity);
    const existing = this.byKey.get(key);
    if (existing && ACTIVE_STATES.has(existing.state))
      return { status: "existing", lease: { ...existing } };
    if (existing) this.remove(existing);

    const group = groupKey(identity);
    const owner = ownerKey(identity);
    let groupCount = 0;
    let ownerCount = 0;
    for (const lease of this.byID.values()) {
      if (!ACTIVE_STATES.has(lease.state)) continue;
      if (groupKey(lease.identity) === group) groupCount++;
      if (ownerKey(lease.identity) === owner) ownerCount++;
    }
    if (groupCount >= this.groupLimit) return { status: "group-limit" };
    if (ownerCount >= this.ownerLimit) return { status: "owner-limit" };

    const lease: DesktopCardWindowLease = {
      id: `desktop-card-window-${++this.nextID}`,
      generation: ++this.generation,
      identity: { ...identity },
      state: "opening",
    };
    this.byKey.set(key, lease);
    this.byID.set(lease.id, lease);
    return { status: "reserved", lease: { ...lease } };
  }

  get(id: string): DesktopCardWindowLease | undefined {
    const lease = this.byID.get(id);
    return lease ? { ...lease, identity: { ...lease.identity } } : undefined;
  }

  transition(
    id: string,
    generation: number,
    next: DesktopCardWindowState,
  ): boolean {
    const lease = this.byID.get(id);
    if (
      !lease ||
      lease.generation !== generation ||
      !TRANSITIONS[lease.state].has(next)
    )
      return false;
    lease.state = next;
    if (next === "closed") this.remove(lease);
    return true;
  }

  beginGroupClose(
    identity: Omit<DesktopCardWindowIdentity, "canonicalPath">,
  ): DesktopCardWindowLease[] {
    const key = groupKey({ ...identity, canonicalPath: "" });
    const closing: DesktopCardWindowLease[] = [];
    for (const lease of this.byID.values()) {
      if (groupKey(lease.identity) !== key || lease.state === "closing")
        continue;
      if (this.transition(lease.id, lease.generation, "closing"))
        closing.push({ ...lease, identity: { ...lease.identity } });
    }
    return closing;
  }

  countGroup(
    identity: Omit<DesktopCardWindowIdentity, "canonicalPath">,
  ): number {
    const key = groupKey({ ...identity, canonicalPath: "" });
    return [...this.byID.values()].filter(
      (lease) =>
        groupKey(lease.identity) === key && ACTIVE_STATES.has(lease.state),
    ).length;
  }

  countOwner(profileInstanceId: string, ownerWindowId: string): number {
    const key = JSON.stringify([profileInstanceId, ownerWindowId]);
    return [...this.byID.values()].filter(
      (lease) =>
        ownerKey(lease.identity) === key && ACTIVE_STATES.has(lease.state),
    ).length;
  }

  release(id: string, generation: number): boolean {
    const lease = this.byID.get(id);
    if (!lease || lease.generation !== generation) return false;
    if (lease.state !== "closed") {
      if (!TRANSITIONS[lease.state].has("closed")) return false;
      lease.state = "closed";
    }
    this.remove(lease);
    return true;
  }

  private remove(lease: DesktopCardWindowLease): void {
    this.byID.delete(lease.id);
    const key = identityKey(lease.identity);
    if (this.byKey.get(key)?.id === lease.id) this.byKey.delete(key);
  }
}
