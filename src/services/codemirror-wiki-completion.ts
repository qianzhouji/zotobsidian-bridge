import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, tooltips, ViewPlugin } from "@codemirror/view";
import {
  autocompletion,
  startCompletion,
  closeCompletion,
  acceptCompletion,
  completionStatus,
  type Completion,
  type CompletionSource,
  pickedCompletion,
} from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import type { NoteQueryClient } from "../adapters/note-query-client.ts";
import {
  wikiCompletionContext,
  wikiCompletionEdit,
} from "../core/wiki-completion.ts";
import {
  WikiCompletionQuery,
  type WikiCompletionOption,
} from "./wiki-completion-query.ts";
import {
  highlightedLabel,
  installNoteUIStyles,
  noteElement,
  noteLabels,
} from "./note-ui.ts";

export function codemirrorWikiCompletion(
  doc: Document,
  sourcePath: string,
  createClient: () => NoteQueryClient,
): Extension {
  installNoteUIStyles(doc);
  const labels = noteLabels(doc);
  let query: WikiCompletionQuery | undefined;
  let pages: (string | undefined)[] = [undefined];
  let signature = "";
  let disposed = false;
  let generation = 0;
  const status = noteElement(doc, "span", "zob-note-state");
  status.setAttribute("role", "status");
  const detail = new WeakMap<
    Completion,
    {
      item?: WikiCompletionOption;
      query: string;
      range?: { from: number; to: number; text: string };
      alias?: string;
    }
  >();
  let activeView: EditorView | undefined;
  const applyItem = (
    view: EditorView,
    completion: Completion,
    from: number,
    to: number,
    item: WikiCompletionOption,
    alias: string | undefined,
    rangeText: string,
  ) => {
    if (
      view.composing ||
      from < 0 ||
      to < from ||
      to > view.state.doc.length ||
      view.state.doc.sliceString(from, to) !== rangeText
    )
      return false;
    const edit = wikiCompletionEdit(from, to, item, alias);
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: { anchor: edit.cursor },
      userEvent: "input.complete",
      annotations: [isolateHistory.of("full"), pickedCompletion.of(completion)],
    });
    closeCompletion(view);
    status.textContent = "";
    return true;
  };
  const source: CompletionSource = async (context) => {
    if (context.view) activeView = context.view;
    const text = context.state.doc.toString();
    const current = wikiCompletionContext(text, context.pos);
    const id = ++generation;
    if (!current || context.view?.composing || disposed) {
      query?.cancel();
      status.textContent = "";
      return null;
    }
    const key = JSON.stringify([current, context.pos]);
    if (signature !== key) {
      signature = key;
      pages = [undefined];
    }
    status.textContent = labels.loading;
    try {
      query ??= new WikiCompletionQuery(createClient());
      context.addEventListener(
        "abort",
        () => {
          if (id === generation) {
            query?.cancel();
            status.textContent = "";
          }
        },
        { onDocChange: true },
      );
      const result = await query.search(
        current,
        sourcePath || "pending.md",
        pages.at(-1),
        text,
      );
      if (context.aborted || disposed || id !== generation) return null;
      status.textContent =
        result.status === "ok"
          ? result.items.length
            ? ""
            : labels.empty
          : result.status === "cancelled"
            ? ""
            : labels[result.status];
      if (result.status !== "ok") return null;
      const options: Completion[] = result.items.map((item) => {
        const rangeText = text.slice(current.from, current.to);
        const option: Completion = {
          label: item.label,
          apply(view, completion, from, to) {
            applyItem(
              view,
              completion,
              from,
              to,
              item,
              current.alias,
              rangeText,
            );
          },
        };
        detail.set(option, {
          item,
          query: current.query,
          range: { from: current.from, to: current.to, text: rangeText },
          alias: current.alias,
        });
        return option;
      });
      const paginate = (label: string, go: () => void) => {
        const option: Completion = {
          label,
          apply(view) {
            go();
            closeCompletion(view);
            startCompletion(view);
          },
        };
        detail.set(option, { query: "" });
        options.push(option);
      };
      if (pages.length > 1) paginate(labels.back, () => pages.pop());
      if (result.cursor) paginate(labels.more, () => pages.push(result.cursor));
      return { from: current.from, to: current.to, options, filter: false };
    } catch {
      if (id === generation && !disposed) status.textContent = labels.offline;
      return null;
    }
  };
  return [
    tooltips({
      parent: (doc.body ?? doc.documentElement) as HTMLElement,
      position: "fixed",
    }),
    autocompletion({
      override: [source],
      activateOnTypingDelay: 120,
      maxRenderedOptions: 22,
      icons: false,
      tooltipClass: () => "zob-cm-completions label-popup",
      addToOptions: [
        {
          position: 50,
          render(completion) {
            const data = detail.get(completion);
            const row = noteElement(doc, "span");
            row.append(
              highlightedLabel(doc, completion.label, data?.query ?? ""),
            );
            const acceptPointer = (event: MouseEvent) => {
              const view = activeView;
              const range = data?.range;
              if (
                event.button !== 0 ||
                !view ||
                !data?.item ||
                !range ||
                !completionStatus(view.state) ||
                view.state.doc.sliceString(range.from, range.to) !== range.text
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              applyItem(
                view,
                completion,
                range.from,
                range.to,
                data.item,
                data.alias,
                range.text,
              );
            };
            row.addEventListener("mousedown", acceptPointer);
            row.addEventListener("click", acceptPointer);
            if (data?.item) {
              const path = noteElement(doc, "span", "zob-completion-path");
              path.textContent = [
                data.item.path,
                data.item.fragment,
                data.item.alias,
              ]
                .filter(Boolean)
                .join(" · ");
              row.append(path);
            }
            return row;
          },
        },
      ],
    }),
    Prec.highest(
      EditorView.inputHandler.of((view, from, to, text) => {
        if (
          view.composing ||
          text !== "[" ||
          from !== to ||
          from < 1 ||
          view.state.doc.sliceString(from - 1, from) !== "["
        )
          return false;
        const original = view.state.doc.toString();
        if (
          !wikiCompletionContext(
            original.slice(0, from) + "[" + original.slice(to),
            from + 1,
          )
        )
          return false;
        const tail = original.slice(to);
        view.dispatch({
          changes: {
            from,
            to,
            insert:
              "[" +
              (tail.startsWith("]]") ? "" : tail.startsWith("]") ? "]" : "]]"),
          },
          selection: { anchor: from + 1 },
          userEvent: "input.type",
        });
        return true;
      }),
    ),
    Prec.highest(
      keymap.of([
        {
          key: "Escape",
          run(view) {
            if (!view.composing && completionStatus(view.state)) {
              query?.cancel();
              status.textContent = "";
              return closeCompletion(view);
            }
            return false;
          },
        },
        {
          key: "Enter",
          run(view) {
            return !view.composing && acceptCompletion(view);
          },
        },
      ]),
    ),
    ViewPlugin.fromClass(
      class {
        constructor(view: EditorView) {
          view.dom.parentElement?.append(status);
        }
        update(update: import("@codemirror/view").ViewUpdate) {
          if (update.selectionSet) {
            const context = wikiCompletionContext(
              update.state.doc.toString(),
              update.state.selection.main.head,
            );
            const next = context
              ? JSON.stringify([context, update.state.selection.main.head])
              : "";
            if (next !== signature) {
              signature = next;
              pages = [undefined];
              query?.cancel();
              status.textContent = "";
              if (!context) {
                const view = update.view;
                const currentGeneration = ++generation;
                void Promise.resolve().then(() => {
                  if (
                    !disposed &&
                    generation === currentGeneration &&
                    !wikiCompletionContext(
                      view.state.doc.toString(),
                      view.state.selection.main.head,
                    )
                  )
                    closeCompletion(view);
                });
              }
            }
          }
        }
        destroy() {
          disposed = true;
          generation++;
          query?.close();
          status.remove();
        }
      },
    ),
  ];
}
