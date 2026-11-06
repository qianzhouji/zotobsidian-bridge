import type { NoteQueryClient } from "../adapters/note-query-client.ts";
import type { NoteQueryResultMap } from "../core/note-query-protocol.ts";
import {
  LinkedCardGraph,
  LINKED_CARD_GROUP_LIMIT,
} from "../core/linked-card-group.ts";
import {
  knowledgeNoteTitle,
  knowledgeNoteSource,
} from "../core/knowledge-note.ts";
import {
  resolveVisibleCardRelations,
  type VisibleCardRelation,
} from "../core/visible-card-relations.ts";
import { internalLinkTarget } from "../core/note-links.ts";
import { KnowledgeCardGroupSurface } from "./knowledge-card-group-surface.ts";
import {
  installNoteUIStyles,
  noteElement,
  noteIconButton,
  noteLabels,
} from "./note-ui.ts";
import { renderKnowledgeMarkdown } from "./knowledge-note-renderer.ts";
import {
  setMarkdownPreviewHTML,
  type RenderedCardMarkdown,
} from "./card-markdown-preview.ts";

type Resolved = NoteQueryResultMap["resolve-link"];
type SavedNote = NoteQueryResultMap["read-note"];
type CardState =
  | "loading"
  | "ready"
  | "cached"
  | "stale"
  | "not-found"
  | "forbidden"
  | "unsupported"
  | "error";

interface LinkAnchorPreference {
  target: string;
  occurrence: number;
}

interface KnowledgeCardInstance {
  id: string;
  panel: HTMLElement;
  client: NoteQueryClient;
  path?: string;
  requested: string;
  sourcePath: string;
  anchor?: HTMLElement;
  aliases: Set<string>;
  active?: { resolved: Resolved; note: SavedNote };
  cached?: { resolved: Resolved; note: SavedNote };
  rendered?: RenderedCardMarkdown;
  controller?: AbortController;
  generation: number;
  busy: boolean;
  checking: boolean;
  scope: string;
  dispose(): void;
  load(resolved: Resolved, preserve?: boolean): Promise<void>;
  fail(error: unknown): void;
  assignPath(path: string): void;
  focus(): void;
  poll(): Promise<void>;
}

let cardSequence = 0;

/** Read-only linked-note previews, isolated per editor and canonical Vault path. */
export function createKnowledgeNoteCard(options: {
  owner: HTMLElement;
  controlHost?: HTMLElement;
  createClient(): NoteQueryClient;
  vaultPath: string;
  launchURL(url: string): void;
  onNavigate?(target: string, sourcePath: string, anchor?: HTMLElement): void;
  root?: {
    sourcePath: string;
    markdown(): string;
    previews: HTMLElement[];
    anchor: HTMLElement;
  };
}) {
  const doc = options.owner.ownerDocument!;
  const win = doc.defaultView!;
  const labels = noteLabels(doc);
  installNoteUIStyles(doc);
  const graph = new LinkedCardGraph(LINKED_CARD_GROUP_LIMIT);
  const cards = new Map<string, KnowledgeCardInstance>();
  const paths = new Map<string, string>();
  const aliases = new Map<string, string>();
  const resolvedAliases = new Map<string, Resolved>();
  const pending = new Map<string, string>();
  const linkAnchorPreferences = new Map<string, LinkAnchorPreference>();
  const roots = new Set<string>();
  let disposed = false;
  let pollTimer: number | undefined;
  let pollIndex = 0;
  let relationTimer: number | undefined;
  let relationController: AbortController | undefined;
  let relationClient: NoteQueryClient | undefined;
  let relationSignature = "";
  let relationGeneration = 0;
  let semanticEdges: VisibleCardRelation[] = [];

  const surface = new KnowledgeCardGroupSurface({
    owner: options.owner,
    controlHost: options.controlHost,
    collapseLabel: labels.collapse,
    limitLabel: labels.cardLimit,
    onCollapse: () => clear(),
  });

  const aliasKey = (sourcePath: string, target: string) =>
    `${sourcePath}\0${target}`;

  const edgeKey = (from: string, to: string) => `${from}\0${to}`;

  const snapshots = () => {
    const root = options.root;
    const result = root
      ? [
          {
            path: root.sourcePath,
            markdown: root.markdown(),
            previews: root.previews,
          },
        ]
      : [];
    for (const card of cards.values()) {
      if (!card.active || !card.path) continue;
      result.push({
        path: card.path,
        markdown: knowledgeNoteSource(card.active.note.markdown),
        previews: [
          card.panel.querySelector<HTMLElement>(".zob-knowledge-body")!,
        ],
      });
    }
    return result;
  };

  const captureAnchorPreference = (
    sourcePath: string,
    anchor?: HTMLElement,
  ): LinkAnchorPreference | undefined => {
    const target = anchor?.getAttribute("data-zob-note-link");
    if (!target) return undefined;
    const source = snapshots().find((note) => note.path === sourcePath);
    if (!source) return { target, occurrence: 0 };
    const matching = source.previews.flatMap((preview) =>
      [
        ...preview.querySelectorAll<HTMLElement>("a[data-zob-note-link]"),
      ].filter(
        (candidate) => candidate.getAttribute("data-zob-note-link") === target,
      ),
    );
    const occurrence = matching.indexOf(anchor!);
    return { target, occurrence: Math.max(0, occurrence) };
  };

  const paintRelations = () => {
    if (!options.root) {
      surface.setEdges(graph.relations());
      return;
    }
    const sources = snapshots();
    for (const edge of semanticEdges) {
      const source = sources.find((note) => note.path === edge.from);
      const anchors =
        source?.previews.flatMap((preview) =>
          [
            ...preview.querySelectorAll<HTMLElement>("a[data-zob-note-link]"),
          ].filter((anchor) =>
            edge.targets.includes(
              anchor.getAttribute("data-zob-note-link") ?? "",
            ),
          ),
        ) ?? [];
      const preference = linkAnchorPreferences.get(edgeKey(edge.from, edge.to));
      if (preference && edge.targets.includes(preference.target)) {
        const exactTargets = anchors.filter(
          (anchor) =>
            anchor.getAttribute("data-zob-note-link") === preference.target,
        );
        const preferred = exactTargets[preference.occurrence];
        if (preferred)
          anchors.splice(
            0,
            anchors.length,
            preferred,
            ...anchors.filter((anchor) => anchor !== preferred),
          );
      } else {
        const targetOrder = new Map(
          [...edge.targets]
            .sort(
              (left, right) =>
                right.split("/").length - left.split("/").length ||
                right.length - left.length,
            )
            .map((target, index) => [target, index]),
        );
        anchors.sort(
          (left, right) =>
            (targetOrder.get(left.getAttribute("data-zob-note-link") ?? "") ??
              Number.MAX_SAFE_INTEGER) -
            (targetOrder.get(right.getAttribute("data-zob-note-link") ?? "") ??
              Number.MAX_SAFE_INTEGER),
        );
      }
      surface.setEdgeAnchors(edge.from, edge.to, anchors);
    }
    surface.setEdges(semanticEdges);
  };

  function refreshRelations(): void {
    if (disposed || !options.root) return;
    surface.setRootAnchor(options.root.sourcePath, options.root.anchor);
    const notes = snapshots();
    const signature = JSON.stringify(
      notes.map(({ path, markdown }) => [path, markdown]),
    );
    if (signature === relationSignature) {
      paintRelations();
      return;
    }
    relationSignature = signature;
    const generation = ++relationGeneration;
    relationController?.abort();
    if (relationTimer !== undefined) win.clearTimeout(relationTimer);
    semanticEdges = [];
    paintRelations();
    if (!cards.size) return;
    options.owner.dataset.relationsState = "loading";
    relationTimer = win.setTimeout(() => {
      relationTimer = undefined;
      const Controller = win.AbortController ?? AbortController;
      const controller = new Controller();
      relationController = controller;
      relationClient ??= options.createClient();
      const client = relationClient;
      void (async () => {
        const scope = await client.scope();
        const result = await resolveVisibleCardRelations(
          notes,
          async (sourcePath, linkpath) => {
            const response = await client.query(
              "resolve-link",
              { sourcePath, linkpath },
              {
                signal: controller.signal,
                timeoutMs: 4000,
              },
            );
            if (response.status === "ok") return response.result.path;
            if (
              response.status === "not-found" ||
              response.status === "unsupported"
            )
              return undefined;
            throw response;
          },
          controller.signal,
        );
        if (
          disposed ||
          controller.signal.aborted ||
          generation !== relationGeneration
        )
          return;
        if ((await client.scope()) !== scope) throw { status: "stale" };
        if (
          disposed ||
          controller.signal.aborted ||
          generation !== relationGeneration
        )
          return;
        semanticEdges = result.edges;
        options.owner.dataset.relationsState = result.partial
          ? "partial"
          : "ready";
        paintRelations();
      })().catch(() => {
        if (
          disposed ||
          controller.signal.aborted ||
          generation !== relationGeneration
        )
          return;
        options.owner.dataset.relationsState = "unavailable";
        relationSignature = "";
        semanticEdges = [];
        paintRelations();
      });
    }, 120);
  }

  const syncEdges = () => {
    if (options.root) refreshRelations();
    else paintRelations();
  };

  const rememberRoot = (sourcePath: string) => {
    if (paths.has(sourcePath)) return;
    roots.add(sourcePath);
    surface.setRootAnchor(sourcePath, options.root?.anchor ?? options.owner);
  };

  const rememberLink = (
    from: string,
    to: string,
    anchor?: HTMLElement,
    preference?: LinkAnchorPreference,
  ) => {
    if (preference) linkAnchorPreferences.set(edgeKey(from, to), preference);
    if (anchor) surface.setEdgeAnchors(from, to, [anchor]);
  };

  const removeCard = (card: KnowledgeCardInstance, prune = true) => {
    if (!cards.has(card.id)) return;
    card.dispose();
    cards.delete(card.id);
    if (card.path) {
      const edges = graph.relations();
      paths.delete(card.path);
      for (const [alias, resolvedPath] of aliases)
        if (resolvedPath === card.path) aliases.delete(alias);
      for (const [alias, resolved] of resolvedAliases)
        if (resolved.path === card.path) resolvedAliases.delete(alias);
      surface.unbindPath(card.path);
      graph.remove(card.path);
      for (const edge of edges) {
        if (
          (edge.from === card.path || edge.to === card.path) &&
          !graph.relations().some((remaining) => remaining.from === edge.from)
        )
          surface.unbindRootAnchor(edge.from);
      }
      for (const root of roots)
        if (!graph.relations().some((edge) => edge.from === root)) {
          roots.delete(root);
          surface.unbindRootAnchor(root);
        }
    }
    for (const alias of card.aliases) {
      if (pending.get(alias) === card.id) pending.delete(alias);
      if (aliases.get(alias) === card.path) aliases.delete(alias);
    }
    surface.removePanel(card.id);
    syncEdges();
    if (prune) pruneUnreachableCards();
    if (!cards.size && pollTimer !== undefined) {
      win.clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  const pruneUnreachableCards = () => {
    const reachable = graph.reachableFrom(roots);
    for (const path of graph.nodePaths()) {
      if (reachable.has(path)) continue;
      const id = paths.get(path);
      const orphan = id ? cards.get(id) : undefined;
      if (orphan) removeCard(orphan, false);
    }
  };

  const createCard = (
    requested: string,
    sourcePath: string,
    anchor?: HTMLElement,
  ): KnowledgeCardInstance => {
    const id = `zob-knowledge-${++cardSequence}`;
    const client = options.createClient();
    const panel = noteElement(doc, "section", "zob-knowledge-card");
    panel.dataset.state = "loading";
    panel.dataset.cardId = id;
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", labels.readonly);
    panel.tabIndex = -1;

    const header = noteElement(doc, "header", "zob-knowledge-header");
    const title = noteElement(doc, "strong", "zob-knowledge-title");
    title.textContent = requested;
    title.title = requested;
    const refresh = noteIconButton(doc, "refresh", labels.refresh);
    const openButton = noteIconButton(doc, "open", labels.open);
    const close = noteIconButton(doc, "close", labels.close);
    header.append(title, refresh, openButton, close);
    const pathLabel = noteElement(doc, "div", "zob-note-state");
    const status = noteElement(doc, "div", "zob-note-state");
    status.setAttribute("role", "status");
    const body = noteElement(doc, "div", "zob-knowledge-body");
    body.tabIndex = 0;
    const resize = noteIconButton(doc, "resize", labels.resize);
    resize.classList.add("zob-knowledge-resize");
    panel.append(header, pathLabel, status, body, resize);

    let controller: AbortController | undefined;
    let rendered: RenderedCardMarkdown | undefined;
    let active: { resolved: Resolved; note: SavedNote } | undefined;
    let cached: { resolved: Resolved; note: SavedNote } | undefined;
    let generation = 0;
    let busy = false;
    let checking = false;
    let scope = "";
    let highlightTimer: number | undefined;
    const resourceCache = new Map<
      string,
      NoteQueryResultMap["read-note-resource"]
    >();
    const card: KnowledgeCardInstance = {
      id,
      panel,
      client,
      requested,
      sourcePath,
      anchor,
      aliases: new Set(),
      generation,
      busy,
      checking,
      scope,
      dispose() {
        generation++;
        controller?.abort();
        client.close();
        rendered?.dispose();
        rendered = undefined;
        body.replaceChildren();
        if (highlightTimer) win.clearTimeout(highlightTimer);
        resourceCache.clear();
      },
      assignPath(path) {
        card.path = path;
        title.textContent =
          path.split("/").at(-1)?.replace(/\.md$/i, "") || path;
        title.title = path;
        pathLabel.textContent = path;
      },
      focus() {
        surface.focus(id);
        panel.focus({ preventScroll: true });
      },
      fail(error) {
        const code =
          typeof error === "string"
            ? error
            : (error as { status?: string })?.status;
        if (code === "forbidden" || code === "stale") {
          cached = undefined;
          active = undefined;
          card.active = undefined;
          rendered?.dispose();
          rendered = undefined;
          body.replaceChildren();
          setState(code);
          refreshRelations();
        } else if (code === "not-found") {
          active = undefined;
          cached = undefined;
          card.active = undefined;
          rendered?.dispose();
          rendered = undefined;
          body.replaceChildren();
          setState("not-found");
          refreshRelations();
        } else if (
          (code === "offline" || code === "timeout" || code === "busy") &&
          active
        ) {
          setState("cached");
        } else if (code === "unsupported") setState("unsupported");
        else
          setState(
            "error",
            code === "too-large"
              ? labels.tooLarge
              : code === "offline" || code === "timeout" || code === "busy"
                ? labels.offline
                : labels.error,
          );
      },
      async load(resolved, preserve = false) {
        controller?.abort();
        const AbortControllerConstructor =
          win.AbortController ?? AbortController;
        controller = new AbortControllerConstructor();
        const signal = controller!.signal;
        const current = ++generation;
        card.generation = generation;
        busy = true;
        card.busy = busy;
        setState("loading");
        try {
          await checkScope(current, true);
          const noteResponse = await client.query(
            "read-note",
            { path: resolved.path },
            { signal, channel: `knowledge:${id}` },
          );
          if (noteResponse.status !== "ok") throw noteResponse;
          const note = noteResponse.result;
          if (note.revision !== resolved.revision) throw { status: "stale" };
          const ratio =
            body.scrollTop / Math.max(1, body.scrollHeight - body.clientHeight);
          const result = await renderKnowledgeMarkdown(
            note.markdown,
            note.path,
            doc,
            client,
            signal,
            resourceCache,
          );
          if (disposed || signal.aborted || current !== generation) {
            result.dispose();
            return;
          }
          await checkScope(current);
          if (current !== generation || signal.aborted) {
            result.dispose();
            return;
          }
          rendered?.dispose();
          rendered = result;
          active = { resolved, note };
          cached = active;
          card.active = active;
          setMarkdownPreviewHTML(body, result.html);
          refreshRelations();
          card.assignPath(note.path);
          title.textContent = knowledgeNoteTitle(note.markdown, note.path);
          title.title = note.path;
          pathLabel.textContent = `${note.path} · ${labels.readonly} · ${new Date(note.readAt).toLocaleString()}`;
          setState("ready");
          if (preserve)
            body.scrollTop =
              ratio * Math.max(0, body.scrollHeight - body.clientHeight);
          else if (resolved.fragment) {
            if (
              resolved.anchorState !== "found" ||
              !resolved.anchor ||
              !note.metadata.valid ||
              note.revision !== resolved.revision
            ) {
              status.textContent += ` · ${labels.anchor}`;
              return;
            }
            const line = resolved.anchor.position.start.line;
            const candidates = [
              ...body.querySelectorAll<HTMLElement>("[data-note-line]"),
            ];
            const element =
              candidates.find(
                (node) => Number(node.dataset.noteLine) === line,
              ) ??
              candidates
                .filter((node) => Number(node.dataset.noteLine) <= line)
                .at(-1);
            if (element) {
              body.scrollTop +=
                element.getBoundingClientRect().top -
                body.getBoundingClientRect().top;
              element.classList.add("zob-anchor-target");
              if (highlightTimer) win.clearTimeout(highlightTimer);
              highlightTimer = win.setTimeout(
                () => element.classList.remove("zob-anchor-target"),
                1800,
              );
            } else status.textContent += ` · ${labels.anchor}`;
          } else body.scrollTop = 0;
        } catch (error) {
          if (disposed || signal.aborted || current !== generation) return;
          const code = (error as { status?: string })?.status;
          if (
            cached &&
            (code === "offline" || code === "timeout" || code === "busy")
          ) {
            await renderCached(cached, current, signal, preserve).catch(
              card.fail,
            );
          } else card.fail(error);
        } finally {
          if (current === generation) {
            busy = false;
            card.busy = busy;
          }
        }
      },
      async poll() {
        if (!active || busy || checking || disposed) return;
        checking = true;
        card.checking = checking;
        const current = generation;
        try {
          await checkScope(current);
          const response = await client.query(
            "resolve-link",
            { linkpath: active.note.path, sourcePath: active.note.path },
            { channel: `knowledge-poll:${id}` },
          );
          if (disposed || current !== generation) return;
          if (response.status !== "ok") card.fail(response.status);
          else if (response.result.revision !== active.note.revision)
            setState("stale");
          else if (panel.dataset.state === "cached") setState("ready");
        } catch (error) {
          if (disposed || current !== generation) return;
          const code = (error as { status?: string })?.status;
          if ((code === "offline" || code === "timeout") && active)
            setState("cached");
          else card.fail(error);
        } finally {
          checking = false;
          card.checking = checking;
        }
      },
    };

    function setState(state: CardState, text?: string) {
      panel.dataset.state = state;
      const labelsByState: Record<CardState, string> = {
        loading: labels.loading,
        ready: labels.ready,
        cached: labels.cached,
        stale: labels.stale,
        "not-found": labels.missing,
        forbidden: labels.forbidden,
        unsupported: labels.unsupported,
        error: labels.error,
      };
      status.textContent = text ?? labelsByState[state];
      openButton.disabled = state !== "ready";
    }

    async function checkScope(expected: number, allowChange = false) {
      const next = await client.scope();
      if (disposed || expected !== generation) throw { status: "cancelled" };
      if (!scope) scope = next;
      else if (scope !== next) {
        cached = undefined;
        active = undefined;
        rendered?.dispose();
        rendered = undefined;
        body.replaceChildren();
        card.active = undefined;
        refreshRelations();
        scope = next;
        if (!allowChange) {
          controller?.abort();
          generation++;
          card.generation = generation;
          throw { status: "stale" };
        }
      }
      card.scope = scope;
    }

    async function renderCached(
      value: { resolved: Resolved; note: SavedNote },
      current: number,
      signal: AbortSignal,
      preserve: boolean,
    ) {
      const result = await renderKnowledgeMarkdown(
        value.note.markdown,
        value.note.path,
        doc,
        client,
        signal,
        resourceCache,
        true,
      );
      if (disposed || signal.aborted || current !== generation) {
        result.dispose();
        return;
      }
      rendered?.dispose();
      rendered = result;
      active = value;
      card.active = value;
      card.assignPath(value.note.path);
      title.textContent = knowledgeNoteTitle(
        value.note.markdown,
        value.note.path,
      );
      pathLabel.textContent = `${value.note.path} · ${labels.readonly} · ${new Date(value.note.readAt).toLocaleString()}`;
      setMarkdownPreviewHTML(body, result.html);
      refreshRelations();
      setState("cached");
      if (!preserve) body.scrollTop = 0;
    }

    refresh.onclick = () => {
      const alias = [...card.aliases][0];
      if (!alias) return;
      const split = alias.indexOf("\0");
      void open(
        alias.slice(split + 1),
        alias.slice(0, split),
        card.anchor,
        card,
      );
    };
    close.onclick = () => removeCard(card);
    openButton.onclick = () => {
      if (!active || panel.dataset.state !== "ready") return;
      const current = generation;
      void (async () => {
        await checkScope(current);
        const verified = await client.query(
          "resolve-link",
          { linkpath: active!.note.path, sourcePath: active!.note.path },
          { channel: `knowledge-open:${id}` },
        );
        if (disposed || current !== generation) return;
        if (
          verified.status !== "ok" ||
          verified.result.path !== active!.note.path
        ) {
          card.fail(verified.status);
          return;
        }
        options.launchURL(
          `obsidian://open?path=${encodeURIComponent(`${options.vaultPath.replace(/\/$/, "")}/${active!.note.path}`)}`,
        );
      })().catch(card.fail);
    };
    body.addEventListener("click", (event) => {
      const anchorElement = (event.target as Element | null)?.closest("a");
      if (!anchorElement) return;
      event.preventDefault();
      event.stopPropagation();
      const link = anchorElement.getAttribute("data-zob-note-link");
      if (link && active) {
        if (options.onNavigate)
          options.onNavigate(
            link,
            active.note.path,
            anchorElement as HTMLElement,
          );
        else void open(link, active.note.path, anchorElement as HTMLElement);
        return;
      }
      const href = anchorElement.getAttribute("href") ?? "";
      if (/^https?:\/\/[^\s]+$/.test(href) || /^mailto:[^\s]+$/.test(href))
        options.launchURL(href);
    });
    panel.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Backspace" || event.key === "Delete")
        event.preventDefault();
      if (event.key === "Escape") {
        event.preventDefault();
        removeCard(card);
      }
    });

    if (
      !surface.addPanel(
        id,
        panel,
        header,
        resize,
        anchor?.getBoundingClientRect() ??
          options.owner.getBoundingClientRect(),
      )
    ) {
      client.close();
    }
    return card;
  };

  const resolveCard = async (
    card: KnowledgeCardInstance,
    target: string,
    sourcePath: string,
    anchor?: HTMLElement,
    preference?: LinkAnchorPreference,
  ) => {
    try {
      const response = await card.client.query(
        "resolve-link",
        { linkpath: target, sourcePath },
        { channel: `knowledge-resolve:${card.id}` },
      );
      if (disposed || !cards.has(card.id)) return;
      if (response.status !== "ok") throw response;
      const resolved = response.result;
      const alias = aliasKey(sourcePath, target);
      aliases.set(alias, resolved.path);
      resolvedAliases.set(alias, resolved);
      pending.delete(alias);
      card.aliases.add(alias);
      const existingId = paths.get(resolved.path);
      if (existingId && existingId !== card.id) {
        const existing = cards.get(existingId);
        const link = graph.link(sourcePath, resolved.path);
        if (link.atLimit) {
          surface.showLimit(anchor?.getBoundingClientRect());
          removeCard(card);
          return;
        }
        rememberRoot(sourcePath);
        rememberLink(sourcePath, resolved.path, anchor, preference);
        syncEdges();
        removeCard(card);
        existing?.focus();
        if (existing && resolved.fragment) void existing.load(resolved);
        return;
      }
      if (!card.path && graph.nodeCount >= LINKED_CARD_GROUP_LIMIT) {
        surface.showLimit(anchor?.getBoundingClientRect());
        removeCard(card);
        return;
      }
      const link = graph.link(sourcePath, resolved.path);
      if (link.atLimit) {
        surface.showLimit(anchor?.getBoundingClientRect());
        removeCard(card);
        return;
      }
      card.assignPath(resolved.path);
      rememberRoot(sourcePath);
      rememberLink(sourcePath, resolved.path, anchor, preference);
      paths.set(resolved.path, card.id);
      surface.bindPath(resolved.path, card.id);
      syncEdges();
      card.focus();
      await card.load(resolved);
    } catch (error) {
      if (disposed || !cards.has(card.id)) return;
      card.fail(error);
    }
  };

  async function open(
    link: string,
    sourcePath: string,
    anchor?: HTMLElement,
    reuse?: KnowledgeCardInstance,
  ) {
    if (disposed) return;
    const target = internalLinkTarget(link);
    if (!target) return;
    const preference = captureAnchorPreference(sourcePath, anchor);
    const key = aliasKey(sourcePath, target);
    const existingPending = pending.get(key);
    if (existingPending && existingPending !== reuse?.id) {
      cards.get(existingPending)?.focus();
      return;
    }
    const resolvedPath = aliases.get(key);
    const existingId = resolvedPath ? paths.get(resolvedPath) : undefined;
    if (existingId && existingId !== reuse?.id) {
      const existing = cards.get(existingId);
      const relation = graph.link(sourcePath, resolvedPath!);
      if (relation.atLimit) {
        surface.showLimit(anchor?.getBoundingClientRect());
        return;
      }
      rememberRoot(sourcePath);
      rememberLink(sourcePath, resolvedPath!, anchor, preference);
      syncEdges();
      existing?.focus();
      const resolved = resolvedAliases.get(key);
      if (existing && resolved?.fragment) void existing.load(resolved);
      return;
    }

    let card = reuse;
    if (!card) {
      if (!surface.canAddCard()) {
        surface.showLimit(anchor?.getBoundingClientRect());
        return;
      }
      card = createCard(target, sourcePath, anchor);
      if (!card.panel.isConnected) return;
      cards.set(card.id, card);
      card.aliases.add(key);
      pending.set(key, card.id);
      ensurePoller();
    } else {
      card.requested = target;
      card.sourcePath = sourcePath;
      card.anchor = anchor;
      card.aliases.add(key);
      pending.set(key, card.id);
      card.panel.dataset.state = "loading";
    }
    await resolveCard(card, target, sourcePath, anchor, preference);
  }

  function ensurePoller() {
    if (pollTimer !== undefined) return;
    pollTimer = win.setInterval(() => {
      const values = [...cards.values()];
      if (!values.length) return;
      for (let i = 0; i < values.length; i++) {
        const index = (pollIndex + i) % values.length;
        const card = values[index]!;
        if (card.active && !card.busy && !card.checking) {
          pollIndex = (index + 1) % values.length;
          void card.poll();
          if (
            options.root &&
            ["partial", "unavailable"].includes(
              options.owner.dataset.relationsState ?? "",
            )
          ) {
            relationSignature = "";
            refreshRelations();
          }
          return;
        }
      }
    }, 2500);
  }

  function clear() {
    relationGeneration++;
    relationController?.abort();
    if (relationTimer !== undefined) win.clearTimeout(relationTimer);
    relationTimer = undefined;
    relationSignature = "";
    semanticEdges = [];
    for (const card of [...cards.values()]) removeCard(card);
    graph.clear();
    paths.clear();
    aliases.clear();
    resolvedAliases.clear();
    pending.clear();
    roots.clear();
    surface.clearPanels();
    syncEdges();
  }

  return {
    open,
    refreshRelations,
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
      relationClient?.close();
      surface.dispose();
      if (pollTimer !== undefined) win.clearInterval(pollTimer);
      pollTimer = undefined;
    },
  };
}
