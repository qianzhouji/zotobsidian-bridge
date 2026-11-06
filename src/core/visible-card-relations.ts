import { collectNoteLinks } from "./note-links.ts";
import type { CardEdge } from "./linked-card-group.ts";

export interface VisibleNoteSnapshot {
  path: string;
  markdown: string;
}

export interface VisibleCardRelation extends CardEdge {
  targets: string[];
}

/** Resolve semantic edges only among existing cards; never open or read a target. */
export async function resolveVisibleCardRelations(
  notes: VisibleNoteSnapshot[],
  resolve: (source: string, target: string) => Promise<string | undefined>,
  signal: AbortSignal,
): Promise<{ edges: VisibleCardRelation[]; partial: boolean }> {
  const visible = new Set(notes.map((note) => note.path));
  const tasks = notes.flatMap((note) =>
    [
      ...new Set(
        collectNoteLinks(note.markdown)
          .filter((link) => !link.embed && !link.target.startsWith("#"))
          .map((link) => link.target),
      ),
    ].map((target) => ({ from: note.path, target })),
  );
  const edges = new Map<string, VisibleCardRelation>();
  let index = 0;
  let partial = false;
  const worker = async () => {
    while (!signal.aborted && index < tasks.length) {
      const task = tasks[index++];
      let to: string | undefined;
      try {
        to = await resolve(task.from, task.target);
      } catch {
        partial = true;
      }
      if (signal.aborted) return;
      if (!to || !visible.has(to)) continue;
      const key = `${task.from}\0${to}`;
      const edge = edges.get(key) ?? { from: task.from, to, targets: [] };
      edge.targets.push(task.target);
      edges.set(key, edge);
    }
  };
  await Promise.all([worker(), worker()]);
  return {
    edges: [...edges.values()].sort((a, b) =>
      `${a.from}\0${a.to}`.localeCompare(`${b.from}\0${b.to}`),
    ),
    partial,
  };
}
