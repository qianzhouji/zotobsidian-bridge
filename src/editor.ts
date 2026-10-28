import { initializeEditorWindow } from "./services/editor-window.ts";

const editorWindow = globalThis as unknown as Window & {
  arguments?: unknown[];
};

editorWindow.addEventListener(
  "load",
  () => initializeEditorWindow(editorWindow),
  { once: true },
);
