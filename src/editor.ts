import { initializeEditorWindow } from "./services/editor-window.ts";
import { initializeDesktopWindowPrototype } from "./services/desktop-window-prototype.ts";
import {
  initializeDesktopKnowledgeCardWindow,
  prepareDesktopKnowledgeCardWindowChrome,
} from "./services/desktop-knowledge-card-window.ts";

const editorWindow = globalThis as unknown as Window & {
  arguments?: unknown[];
};

const isDesktopKnowledgeCard =
  editorWindow.location.href.endsWith("desktop-knowledge-card.xhtml") ||
  editorWindow.location.href.endsWith("desktop-knowledge-card-macos.xhtml");
if (isDesktopKnowledgeCard)
  prepareDesktopKnowledgeCardWindowChrome(editorWindow);

editorWindow.addEventListener(
  "load",
  () => {
    if (isDesktopKnowledgeCard)
      initializeDesktopKnowledgeCardWindow(editorWindow);
    else if (
      editorWindow.location.href.endsWith("desktop-window-prototype.xhtml")
    )
      initializeDesktopWindowPrototype(editorWindow);
    else initializeEditorWindow(editorWindow);
  },
  { once: true },
);
