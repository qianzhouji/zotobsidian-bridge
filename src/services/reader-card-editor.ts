export function createReaderCardMarkdownTextarea(
  doc: Document,
  value: string,
): HTMLTextAreaElement {
  const textarea = doc.createElement("textarea");
  textarea.className = "zob-reader-card-textarea";
  textarea.value = value;
  textarea.spellcheck = false;
  return textarea;
}

export function markReaderEditorAsTextEntry(root: HTMLElement): () => void {
  // Zotero's Reader KeyboardManager runs on window capture and skips annotation
  // deletion for targets inside .label-popup. Stopping propagation later is too late.
  root.classList.add("label-popup");
  return () => root.classList.remove("label-popup");
}
