import { config } from "../../package.json";
import { createDesktopWindowHost } from "../adapters/desktop-window-host.ts";
import type { NoteQueryClient } from "../adapters/note-query-client.ts";
import { desktopRectForElement } from "../core/desktop-card-anchor.ts";
import { recordDesktopEdgeDiagnostics } from "../adapters/desktop-edge-diagnostics.ts";
import type { DesktopCardWindowLease } from "../core/desktop-card-window-registry.ts";
import { routeDesktopEdge } from "../core/desktop-edge-routing.ts";
import {
  desktopRootLinkKey,
  projectDesktopEdges,
} from "../core/desktop-edge-projection.ts";
import {
  DesktopEdgePerformanceMetrics,
  type DesktopEdgePerformanceSnapshot,
} from "../core/desktop-edge-performance.ts";
import type {
  DesktopCardHeaderAnchor,
  RootDesktopAnchor,
  RootLinkAnchorCandidate,
} from "../core/desktop-edge-projection.ts";
import type {
  KnowledgeCardSurface,
  KnowledgeCardSurfaceOptions,
} from "../core/knowledge-card-surface.ts";
import {
  LINKED_CARD_GROUP_LIMIT,
  LINKED_CARD_WINDOW_LIMIT,
  type CardEdge,
} from "../core/linked-card-group.ts";
import { KnowledgeCardGroupSurface } from "./knowledge-card-group-surface.ts";
import { DesktopCardWindowGroup } from "./desktop-card-window-group.ts";
import {
  getDesktopWindowRegistration,
  makeDesktopGroupIdentity,
} from "./desktop-window-registry.ts";
import { installNoteUIStyles, noteIconButton } from "./note-ui.ts";
import {
  disposeMarkdownPreviewImages,
  syncMarkdownPreviewImages,
} from "../core/markdown-preview-resources.ts";
import { desktopKnowledgeCardWindowURL } from "./desktop-knowledge-card-window.ts";
import { getDesktopEdgeOverlayRuntime } from "./desktop-edge-overlay-runtime.ts";

type ManagedWindow = Window & { closed?: boolean };

interface DesktopCardEntry {
  key: string;
  panel: HTMLElement;
  header: HTMLElement;
  resizeHandle: HTMLElement;
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">;
  path?: string;
  leaseID?: string;
  pendingLease?: DesktopCardWindowLease;
  window?: ManagedWindow;
  windowGeneration?: number;
  mirrorGeneration: number;
  mirrorPanel?: HTMLElement;
  mirrorObserver?: MutationObserver;
  mirrorImageURLs: Map<string, string>;
  windowCleanup?: (() => void)[];
  fallback: boolean;
  mounted: Promise<void>;
}

function compatibleNode(source: Node, target: Node): boolean {
  return (
    source.nodeType === target.nodeType &&
    source.nodeName === target.nodeName &&
    (source as Element).namespaceURI === (target as Element).namespaceURI
  );
}

function syncNode(source: Node, target: Node, document: Document): void {
  if (source.nodeType === 3) {
    if (target.nodeValue !== source.nodeValue)
      target.nodeValue = source.nodeValue;
    return;
  }
  if (source.nodeType !== 1) return;

  const sourceElement = source as Element;
  const targetElement = target as Element;
  for (const attribute of [...targetElement.attributes])
    if (!sourceElement.hasAttributeNS(attribute.namespaceURI, attribute.name))
      targetElement.removeAttributeNS(
        attribute.namespaceURI,
        attribute.localName,
      );
  for (const attribute of [...sourceElement.attributes])
    if (
      targetElement.getAttributeNS(
        attribute.namespaceURI,
        attribute.localName,
      ) !== attribute.value
    )
      targetElement.setAttributeNS(
        attribute.namespaceURI,
        attribute.name,
        attribute.value,
      );

  const sourceChildren = Array.from(source.childNodes) as Node[];
  let targetChild = target.firstChild as Node | null;
  for (const sourceChild of sourceChildren) {
    const current = targetChild as Node | null;
    if (current === null) {
      const replacement = document.importNode(sourceChild as Node, true);
      target.appendChild(replacement);
      targetChild = replacement.nextSibling as Node | null;
      continue;
    }
    if (!compatibleNode(sourceChild as Node, current as Node)) {
      const replacement = document.importNode(sourceChild as Node, true);
      target.replaceChild(replacement, current as Node);
      targetChild = replacement.nextSibling as Node | null;
      continue;
    }
    syncNode(sourceChild as Node, current as Node, document);
    targetChild = (current as Node).nextSibling as Node | null;
  }
  while (targetChild !== null) {
    const current = targetChild as Node;
    const next = current.nextSibling as Node | null;
    target.removeChild(current);
    targetChild = next;
  }
}

function applyNativeCardLayout(panel: HTMLElement): void {
  panel.setAttribute("contenteditable", "false");
  panel.style.position = "absolute";
  panel.style.inset = "0";
  panel.style.width = "100%";
  panel.style.height = "100%";
  panel.style.maxWidth = "none";
  panel.style.maxHeight = "none";
  panel.style.minWidth = "0";
  panel.style.minHeight = "0";
  panel.style.borderRadius = "0";
  panel.style.boxShadow = "none";
  const header = panel.querySelector<HTMLElement>(".zob-knowledge-header");
  if (header) header.style.cursor = "default";
  const resize = panel.querySelector<HTMLElement>(".zob-knowledge-resize");
  if (resize) resize.hidden = true;
}

function getTopLevelWindow(window: Window): Window {
  try {
    return window.top ?? window;
  } catch {
    return Zotero.getMainWindow();
  }
}

/** One native Zotero window per resolved knowledge note, owned by the root group. */
export class DesktopKnowledgeCardSurface implements KnowledgeCardSurface {
  private readonly doc: Document;
  private readonly owner: Window;
  private readonly identity: {
    profileInstanceId: string;
    ownerWindowId: string;
    rootSessionId: string;
    groupId: string;
    vaultId: string;
    pairingEpoch: string;
  };
  private readonly entries = new Map<string, DesktopCardEntry>();
  private readonly pathKeys = new Map<string, string>();
  private readonly group: DesktopCardWindowGroup;
  private readonly overlayRuntime = getDesktopEdgeOverlayRuntime();
  private readonly removeOverlayRefresh: () => void;
  private readonly fallback: KnowledgeCardGroupSurface;
  private readonly staging: HTMLElement;
  private readonly onCollapse: () => void;
  private readonly onWindowClosed?: (key: string) => void;
  private readonly onCardLink?: KnowledgeCardSurfaceOptions["onCardLink"];
  private readonly onExternalLink?: KnowledgeCardSurfaceOptions["onExternalLink"];
  private readonly collapseButton?: HTMLButtonElement;
  private readonly rootAnchors = new Map<string, HTMLElement>();
  private readonly edgeAnchors = new Map<string, HTMLElement[]>();
  private readonly anchorObservers = new Map<
    Document,
    { observer: MutationObserver; roots: Set<Node>; view?: Window }
  >();
  private edges: CardEdge[] = [];
  private relationGeneration = 0;
  private geometryFrame?: {
    cancel: () => void;
    requestedAt: number;
  };
  private readonly geometryMetrics = new DesktopEdgePerformanceMetrics();
  private lastDetailedDiagnosticsAt = Number.NEGATIVE_INFINITY;
  private lastDetailedDiagnosticsGeneration = -1;
  private disposed = false;
  private suppressCloseCallback = false;

  constructor(
    options: KnowledgeCardSurfaceOptions,
    scope: { vaultId: string; pairingEpoch: string },
  ) {
    this.doc = options.owner.ownerDocument!;
    this.onCollapse = options.onCollapse;
    this.onWindowClosed = options.onWindowClosed;
    this.onCardLink = options.onCardLink;
    this.onExternalLink = options.onExternalLink;
    const rootWindow = this.doc.defaultView!;
    this.owner = getTopLevelWindow(rootWindow);
    const groupID = crypto.randomUUID();
    this.identity = makeDesktopGroupIdentity(rootWindow, groupID, scope);
    this.fallback = new KnowledgeCardGroupSurface({
      ...options,
      controlHost: undefined,
    });
    if (
      this.fallback.setAuthorizationScope({
        vaultId: scope.vaultId,
        pairingEpoch: scope.pairingEpoch,
      }) === false
    )
      throw new Error("Could not register the fallback card surface.");
    this.staging = this.doc.createElement("div");
    this.staging.hidden = true;
    this.staging.dataset.zobDesktopCardStaging = groupID;
    (this.doc.body ?? this.doc.documentElement!).append(this.staging);

    if (options.controlHost) {
      const button = noteIconButton(
        this.doc,
        "collapse",
        options.collapseLabel,
      );
      button.hidden = true;
      button.addEventListener("click", this.onCollapse);
      options.controlHost.append(button);
      this.collapseButton = button;
    }

    const registry = getDesktopWindowRegistration(rootWindow).registry;
    const host = createDesktopWindowHost(
      Zotero.getMainWindow(),
      config.addonRef,
    );
    const platform = `${this.owner.navigator.platform} ${this.owner.navigator.userAgent}`;
    // Line visibility follows live geometry, not which Zotero window has focus.
    this.group = new DesktopCardWindowGroup({
      owner: this.owner,
      identity: this.identity,
      registry,
      host,
      onGeometryFrame: () => this.flushGeometryFrame(),
      openOptions: (path) => ({
        url: desktopKnowledgeCardWindowURL(config.addonRef, platform),
        name: `zob-card-${groupID}-${path}`,
        features:
          "chrome,dialog=no,resizable,centerscreen,width=480,height=420",
        args: [{ path }],
      }),
      onWindowClosed: (lease) => {
        if (this.suppressCloseCallback || this.disposed) return;
        const key = this.pathKeys.get(lease.identity.canonicalPath);
        if (key) options.onWindowClosed?.(key);
      },
      onGeometryChanged: () => this.scheduleGeometry(),
    });
    this.removeOverlayRefresh = this.overlayRuntime.register(groupID, () =>
      this.scheduleGeometry(),
    );
    installNoteUIStyles(this.doc);
  }

  get cardCount(): number {
    return this.entries.size;
  }

  get performanceSnapshot(): DesktopEdgePerformanceSnapshot {
    return this.geometryMetrics.snapshot();
  }

  setAuthorizationScope(scope: {
    vaultId: string;
    pairingEpoch: string;
  }): boolean {
    return (
      this.identity.vaultId === scope.vaultId &&
      this.identity.pairingEpoch === scope.pairingEpoch
    );
  }

  canAddCard(): boolean {
    return (
      !this.disposed &&
      Math.max(this.entries.size, this.groupRegistryCount()) <
        LINKED_CARD_GROUP_LIMIT &&
      this.groupRegistryCount() < LINKED_CARD_GROUP_LIMIT &&
      this.ownerRegistryCount() < LINKED_CARD_WINDOW_LIMIT
    );
  }

  addPanel(
    key: string,
    panel: HTMLElement,
    header: HTMLElement,
    resizeHandle: HTMLElement,
    anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  ): boolean {
    if (!this.canAddCard() || this.entries.has(key)) {
      this.showLimit(anchor);
      return false;
    }
    const pending = getDesktopWindowRegistration(
      this.doc.defaultView!,
    ).registry.reserve({
      ...this.identity,
      canonicalPath: `pending:${this.identity.groupId}:${key}`,
    });
    if (pending.status !== "reserved") {
      this.showLimit(anchor);
      return false;
    }
    this.entries.set(key, {
      key,
      panel,
      header,
      resizeHandle,
      anchor,
      pendingLease: pending.lease,
      mirrorGeneration: 0,
      mirrorImageURLs: new Map(),
      fallback: false,
      mounted: Promise.resolve(),
    });
    this.staging.append(panel);
    if (this.collapseButton) this.collapseButton.hidden = false;
    return true;
  }

  bindPath(path: string, key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry || this.disposed) return false;
    if (entry.path === path) return true;
    const duplicate = this.pathKeys.get(path);
    if (duplicate && duplicate !== key) {
      this.focus(duplicate);
      return false;
    }
    entry.path = path;
    this.pathKeys.set(path, key);
    this.releasePendingLease(entry);

    let result;
    try {
      result = this.group.open(path);
    } catch (error) {
      return this.moveToFallback(key, String(error));
    }
    if (result.status === "group-limit" || result.status === "owner-limit") {
      this.showLimit(entry.anchor);
      this.pathKeys.delete(path);
      entry.path = undefined;
      return false;
    }
    if (!result.lease || !result.window) {
      return this.moveToFallback(key, "Zotero did not return a native window.");
    }

    entry.leaseID = result.lease.id;
    entry.windowGeneration = result.lease.generation;
    entry.window = result.window as ManagedWindow;
    entry.mounted = (result.ready ?? Promise.resolve(result.window))
      .then((window) => {
        this.mountInWindow(key, window as ManagedWindow);
      })
      .catch((error: unknown) => {
        if (!this.moveToFallback(key, String(error)))
          this.onWindowClosed?.(key);
      });
    return true;
  }

  whenMounted(key: string): Promise<void> {
    return this.entries.get(key)?.mounted ?? Promise.resolve();
  }

  unbindPath(path: string): void {
    const key = this.pathKeys.get(path);
    this.pathKeys.delete(path);
    if (key && this.entries.get(key)?.fallback) this.fallback.unbindPath(path);
  }

  setRootAnchor(sourcePath: string, anchor: HTMLElement | undefined): void {
    if (anchor) {
      this.rootAnchors.set(sourcePath, anchor);
      this.observeAnchor(anchor);
    } else this.rootAnchors.delete(sourcePath);
    this.scheduleGeometry();
  }

  unbindRootAnchor(sourcePath: string): void {
    this.rootAnchors.delete(sourcePath);
    this.scheduleGeometry();
  }

  setEdges(edges: CardEdge[]): void {
    this.edges = edges.map((edge) => ({ ...edge }));
    this.relationGeneration++;
    const pairs = new Set(edges.map((edge) => `${edge.from}\0${edge.to}`));
    for (const key of this.edgeAnchors.keys())
      if (!pairs.has(key)) this.edgeAnchors.delete(key);
    this.scheduleGeometry();
  }

  setEdgeAnchors(from: string, to: string, anchors: HTMLElement[]): void {
    this.edgeAnchors.set(`${from}\0${to}`, [...anchors]);
    for (const anchor of anchors) this.observeAnchor(anchor);
    this.scheduleGeometry();
  }

  focus(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.fallback) {
      this.fallback.focus(key);
      return;
    }
    entry.window?.focus();
    entry.mirrorPanel?.focus({ preventScroll: true });
    this.scheduleGeometry();
  }

  removePanel(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    if (entry.path && this.pathKeys.get(entry.path) === key)
      this.pathKeys.delete(entry.path);
    this.disposeMirror(entry);
    if (entry.leaseID) this.group.close(entry.leaseID);
    this.releasePendingLease(entry);
    if (entry.fallback) this.fallback.removePanel(key);
    entry.panel.remove();
    if (!this.entries.size && this.collapseButton)
      this.collapseButton.hidden = true;
    this.scheduleGeometry();
  }

  clearPanels(): void {
    for (const key of [...this.entries.keys()]) this.removePanel(key);
    this.pathKeys.clear();
    this.edges = [];
    this.rootAnchors.clear();
    this.edgeAnchors.clear();
    this.overlayRuntime.removeGroup(this.identity.groupId);
    this.fallback.clearPanels();
  }

  showLimit(anchor?: Pick<DOMRect, "left" | "right" | "top" | "bottom">): void {
    this.fallback.showLimit(anchor);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.suppressCloseCallback = true;
    this.group.dispose();
    this.removeOverlayRefresh();
    this.overlayRuntime.removeGroup(this.identity.groupId);
    if (this.geometryFrame) {
      this.geometryFrame.cancel();
      this.geometryFrame = undefined;
    }
    for (const { observer, view } of this.anchorObservers.values()) {
      observer.disconnect();
      view?.removeEventListener("scroll", this.onAnchorGeometry, true);
      view?.removeEventListener("resize", this.onAnchorGeometry);
    }
    this.anchorObservers.clear();
    for (const entry of this.entries.values()) {
      this.disposeMirror(entry);
      this.releasePendingLease(entry);
      entry.panel.remove();
    }
    this.entries.clear();
    this.pathKeys.clear();
    this.edges = [];
    this.rootAnchors.clear();
    this.edgeAnchors.clear();
    this.fallback.dispose();
    this.staging.remove();
    this.collapseButton?.removeEventListener("click", this.onCollapse);
    this.collapseButton?.remove();
  }

  private groupRegistryCount(): number {
    return getDesktopWindowRegistration(this.owner).registry.countGroup(
      this.identity,
    );
  }

  private ownerRegistryCount(): number {
    return getDesktopWindowRegistration(this.owner).registry.countOwner(
      this.identity.profileInstanceId,
      this.identity.ownerWindowId,
    );
  }

  private observeAnchor(anchor: HTMLElement): void {
    const document = anchor.ownerDocument;
    if (!document) return;
    let record = this.anchorObservers.get(document);
    if (!record) {
      const Observer =
        document.defaultView?.MutationObserver ?? MutationObserver;
      const observer = new Observer(() => this.scheduleGeometry());
      record = {
        observer,
        roots: new Set(),
        view: document.defaultView ?? undefined,
      };
      record.view?.addEventListener("scroll", this.onAnchorGeometry, true);
      record.view?.addEventListener("resize", this.onAnchorGeometry);
      this.anchorObservers.set(document, record);
    }
    const root: Node = anchor.parentElement ?? anchor;
    if (record.roots.has(root)) return;
    record.roots.add(root);
    record.observer.observe(root, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  private readonly onAnchorGeometry = () => this.scheduleGeometry();

  private scheduleGeometry(): void {
    if (this.disposed) return;
    this.geometryMetrics.request(this.geometryFrame !== undefined);
    if (this.geometryFrame) return;
    const requestedAt = this.geometryNow();
    // Schedule on a visible detached card window so a hidden Reader cannot
    // throttle geometry updates during native window drags.
    this.geometryFrame = {
      cancel: this.group.requestGeometryFrame(() =>
        this.paintGeometryFrame(requestedAt),
      ),
      requestedAt,
    };
  }

  private flushGeometryFrame(): void {
    if (this.disposed) return;
    this.geometryMetrics.request(this.geometryFrame !== undefined);
    const requestedAt = this.geometryFrame?.requestedAt ?? this.geometryNow();
    this.geometryFrame?.cancel();
    this.geometryFrame = undefined;
    this.paintGeometryFrame(requestedAt);
  }

  private paintGeometryFrame(requestedAt: number): void {
    this.geometryFrame = undefined;
    const startedAt = this.geometryNow();
    let edgeCount = 0;
    try {
      edgeCount = this.paintDesktopEdges();
    } catch {
      this.overlayRuntime.removeGroup(this.identity.groupId);
    } finally {
      this.geometryMetrics.frame(
        startedAt - requestedAt,
        this.geometryNow() - startedAt,
        this.entries.size,
        edgeCount,
        startedAt,
      );
    }
  }

  private geometryNow(): number {
    try {
      const now = this.owner.performance?.now();
      return Number.isFinite(now) ? now! : Date.now();
    } catch {
      return Date.now();
    }
  }

  private paintDesktopEdges(): number {
    if (this.disposed) return 0;
    const rootPaths = new Set(
      [...this.rootAnchors.keys()].filter((path) => !this.pathKeys.has(path)),
    );
    const roots = new Map<string, RootDesktopAnchor>();
    for (const path of rootPaths) {
      const rect = desktopRectForElement(this.rootAnchors.get(path)!);
      roots.set(path, {
        visible: !!rect,
        titleVisible: !!rect,
        titleRect: rect ?? { left: 0, top: 0, width: 0, height: 0 },
        contentGeneration: this.relationGeneration,
      });
    }

    const rootLinks = new Map<string, readonly RootLinkAnchorCandidate[]>();
    for (const edge of this.edges) {
      if (!rootPaths.has(edge.from)) continue;
      const anchors = this.edgeAnchors.get(`${edge.from}\0${edge.to}`) ?? [];
      rootLinks.set(
        desktopRootLinkKey(edge.from, edge.to),
        anchors.map((anchor, occurrence) => {
          const rect = desktopRectForElement(anchor);
          return {
            occurrence,
            rect: rect ?? { left: 0, top: 0, width: 0, height: 0 },
            visible: !!rect,
            contentGeneration: this.relationGeneration,
          };
        }),
      );
    }

    const cards = new Map<string, DesktopCardHeaderAnchor>();
    for (const entry of this.entries.values()) {
      if (
        !entry.path ||
        !entry.window ||
        entry.window.closed ||
        !entry.mirrorPanel ||
        !Number.isInteger(entry.windowGeneration)
      )
        continue;
      const header = entry.mirrorPanel.querySelector<HTMLElement>(
        ".zob-knowledge-header",
      );
      const headerRect = header && desktopRectForElement(header);
      const windowRect = {
        left: entry.window.screenX,
        top: entry.window.screenY,
        width: entry.window.outerWidth,
        height: entry.window.outerHeight,
      };
      cards.set(entry.path, {
        visible: !!headerRect,
        headerRect: headerRect ?? { left: 0, top: 0, width: 0, height: 0 },
        windowRect:
          Object.values(windowRect).every(Number.isFinite) &&
          windowRect.width > 0 &&
          windowRect.height > 0
            ? windowRect
            : undefined,
        contentGeneration: entry.mirrorGeneration,
        windowGeneration: entry.windowGeneration!,
      });
    }

    const projected = projectDesktopEdges({
      edges: this.edges,
      rootPaths,
      roots,
      rootLinks,
      cards,
      relationGeneration: this.relationGeneration,
    });
    const routed = projected.map((edge) => routeDesktopEdge(edge));
    const diagnosticsNow = this.geometryNow();
    if (
      diagnosticsNow - this.lastDetailedDiagnosticsAt >= 500 ||
      this.lastDetailedDiagnosticsGeneration !== this.relationGeneration
    ) {
      this.lastDetailedDiagnosticsAt = diagnosticsNow;
      this.lastDetailedDiagnosticsGeneration = this.relationGeneration;
      this.doc.documentElement?.setAttribute(
        "data-desktop-edge-diagnostics",
        JSON.stringify({
          edgeCount: this.edges.length,
          rootCount: rootPaths.size,
          visibleRootCount: [...roots.values()].filter((root) => root.visible)
            .length,
          rootLinkCount: [...rootLinks.values()].reduce(
            (total, anchors) =>
              total + anchors.filter((anchor) => anchor.visible).length,
            0,
          ),
          cardCount: this.entries.size,
          visibleCardCount: [...cards.values()].filter((card) => card.visible)
            .length,
          projectedCount: projected.length,
        }),
      );
      recordDesktopEdgeDiagnostics("projection", {
        edgeCount: this.edges.length,
        performance: this.geometryMetrics.snapshot(),
        rootCount: rootPaths.size,
        roots: [...roots.values()].map(({ visible, titleRect }) => ({
          visible,
          titleRect,
        })),
        rootLinkCandidates: [...rootLinks.values()].flat().map((anchor) => ({
          occurrence: anchor.occurrence,
          visible: anchor.visible,
          rect: anchor.rect,
        })),
        cards: [...cards.values()].map((card) => ({
          visible: card.visible,
          headerRect: card.headerRect,
          windowRect: card.windowRect,
          contentGeneration: card.contentGeneration,
          windowGeneration: card.windowGeneration,
        })),
        projected: projected.map((edge) => ({
          fromKind: edge.from.kind,
          toKind: edge.to.kind,
          from: edge.from.point,
          to: edge.to.point,
          fromOccurrence:
            edge.from.kind === "root-link" ? edge.from.occurrence : undefined,
          toOccurrence:
            edge.to.kind === "root-link" ? edge.to.occurrence : undefined,
        })),
        curves: routed.map((curve) => ({
          from: curve.from,
          control1: curve.control1,
          control2: curve.control2,
          to: curve.to,
          routeStatus: curve.routeStatus,
        })),
      });
    }
    this.overlayRuntime.setGroup(this.identity.groupId, routed);
    return projected.length;
  }

  private releasePendingLease(entry: DesktopCardEntry): void {
    const lease = entry.pendingLease;
    if (!lease) return;
    entry.pendingLease = undefined;
    const registry = getDesktopWindowRegistration(this.owner).registry;
    const current = registry.get(lease.id);
    if (!current || current.generation !== lease.generation) return;
    if (current.state !== "closing")
      registry.transition(current.id, current.generation, "closing");
    registry.transition(current.id, current.generation, "closed");
  }

  private mountInWindow(key: string, window: ManagedWindow): void {
    const entry = this.entries.get(key);
    if (!entry || this.disposed || window.closed) return;
    const childDocument = window.document;
    const root = childDocument.getElementById("desktop-card-window");
    const host = childDocument.getElementById("card-host");
    const state = childDocument.getElementById("window-state");
    if (root?.getAttribute("data-ready") !== "true" || !host || !state)
      throw new Error("Desktop knowledge-card window host is not ready.");

    entry.window = window;
    root.setAttribute("data-mount-state", "mounting");
    state.textContent = "Mounting card content...";
    installNoteUIStyles(childDocument);
    const panel = childDocument.importNode(entry.panel, true) as HTMLElement;
    entry.mirrorPanel = panel;
    applyNativeCardLayout(panel);
    host.replaceChildren(panel);
    const sourceBody = entry.panel.querySelector<HTMLElement>(
      ".zob-knowledge-body",
    );
    const targetBody = panel.querySelector<HTMLElement>(".zob-knowledge-body");
    if (sourceBody && targetBody)
      syncMarkdownPreviewImages(
        sourceBody,
        targetBody,
        childDocument,
        entry.mirrorImageURLs,
      );
    root.setAttribute("data-mounted", "true");
    root.setAttribute("data-mount-state", "mounted");
    state.textContent = "Card content mounted.";
    entry.mirrorGeneration++;
    this.scheduleGeometry();

    const onClick = (rawEvent: Event) => {
      const event = rawEvent as MouseEvent;
      const target = event.target as Element | null;
      const action = target
        ?.closest("[data-zob-card-action]")
        ?.getAttribute("data-zob-card-action");
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        window.dispatchEvent(
          new window.CustomEvent("desktop-card-command", {
            detail: { key, action },
          }),
        );
        return;
      }
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const noteTarget = anchor.getAttribute("data-zob-note-link");
      if (noteTarget) {
        event.preventDefault();
        event.stopPropagation();
        const body = panel.querySelector<HTMLElement>(".zob-knowledge-body");
        const occurrence = body
          ? [
              ...body.querySelectorAll<HTMLAnchorElement>(
                "a[data-zob-note-link]",
              ),
            ]
              .filter(
                (candidate) =>
                  candidate.getAttribute("data-zob-note-link") === noteTarget,
              )
              .indexOf(anchor)
          : 0;
        window.dispatchEvent(
          new window.CustomEvent("desktop-card-link", {
            detail: {
              key,
              target: noteTarget,
              occurrence: Math.max(0, occurrence),
            },
          }),
        );
        return;
      }
      const href = anchor.getAttribute("href") ?? "";
      if (/^https?:\/\/[^\s]+$/.test(href) || /^mailto:[^\s]+$/.test(href)) {
        event.preventDefault();
        this.onExternalLink?.(href);
      }
    };
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; action?: string }>)
        .detail;
      if (detail?.key !== key || !detail.action) return;
      entry.panel
        .querySelector<HTMLButtonElement>(
          `[data-zob-card-action="${detail.action}"]`,
        )
        ?.click();
    };
    const onLink = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          key?: string;
          target?: string;
          occurrence?: number;
        }>
      ).detail;
      if (detail?.key !== key || !detail.target || !entry.path) return;
      this.onCardLink?.(
        key,
        detail.target,
        entry.path,
        Number.isInteger(detail.occurrence) ? detail.occurrence! : 0,
      );
    };
    panel.addEventListener("click", onClick);
    window.addEventListener("desktop-card-command", onCommand);
    window.addEventListener("desktop-card-link", onLink);
    entry.windowCleanup = [
      () => panel.removeEventListener("click", onClick),
      () => window.removeEventListener("desktop-card-command", onCommand),
      () => window.removeEventListener("desktop-card-link", onLink),
    ];

    const sync = () => {
      if (entry.mirrorPanel !== panel || window.closed) return;
      syncNode(entry.panel, panel, childDocument);
      applyNativeCardLayout(panel);
      const sourceBody = entry.panel.querySelector<HTMLElement>(
        ".zob-knowledge-body",
      );
      const targetBody = panel.querySelector<HTMLElement>(
        ".zob-knowledge-body",
      );
      if (sourceBody && targetBody)
        syncMarkdownPreviewImages(
          sourceBody,
          targetBody,
          childDocument,
          entry.mirrorImageURLs,
        );
      entry.mirrorGeneration++;
      this.scheduleGeometry();
    };
    const Observer = this.doc.defaultView?.MutationObserver ?? MutationObserver;
    const observer = new Observer(sync);
    entry.mirrorObserver = observer;
    observer.observe(entry.panel, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  private disposeMirror(entry: DesktopCardEntry): void {
    entry.mirrorObserver?.disconnect();
    entry.mirrorObserver = undefined;
    for (const cleanup of entry.windowCleanup ?? []) cleanup();
    entry.windowCleanup = undefined;
    if (entry.window)
      disposeMarkdownPreviewImages(
        entry.window.document,
        entry.mirrorImageURLs,
      );
    entry.mirrorPanel?.remove();
    entry.mirrorPanel = undefined;
  }

  private moveToFallback(key: string, error: string): boolean {
    const entry = this.entries.get(key);
    if (!entry || this.disposed) return false;
    if (entry.fallback) return true;
    this.disposeMirror(entry);
    if (entry.leaseID) this.group.close(entry.leaseID);
    entry.leaseID = undefined;
    entry.window = undefined;
    entry.panel.dataset.desktopWindowFallback = "true";
    entry.panel.dataset.desktopWindowError = error.slice(0, 240);
    if (entry.panel.ownerDocument !== this.doc)
      this.doc.adoptNode?.(entry.panel);
    entry.resizeHandle.hidden = false;
    entry.header.style.cursor = "grab";
    if (
      !this.fallback.addPanel(
        key,
        entry.panel,
        entry.header,
        entry.resizeHandle,
        entry.anchor,
      )
    ) {
      this.entries.delete(key);
      entry.panel.remove();
      this.pathKeys.delete(entry.path ?? "");
      this.showLimit(entry.anchor);
      return false;
    }
    entry.fallback = true;
    if (entry.path && !this.fallback.bindPath(entry.path, key)) {
      this.fallback.removePanel(key);
      this.entries.delete(key);
      entry.panel.remove();
      this.pathKeys.delete(entry.path);
      this.showLimit(entry.anchor);
      return false;
    }
    entry.mounted = Promise.resolve();
    return true;
  }
}

/** Uses only the note-query permission scope; it does not read or write Vault files. */
export async function createDesktopKnowledgeCardSurface(
  client: NoteQueryClient,
  options: KnowledgeCardSurfaceOptions,
): Promise<KnowledgeCardSurface> {
  const scope = await client.scopeIdentity();
  return new DesktopKnowledgeCardSurface(options, scope);
}

export function desktopKnowledgeCardsEnabled(): boolean {
  return (
    Zotero.Prefs.get(
      "extensions.zotero.zoteroobsidianbridge.desktopKnowledgeCards",
      true,
    ) === true
  );
}
