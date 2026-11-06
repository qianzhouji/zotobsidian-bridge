export function setEditorInputEnabled(
  content: HTMLElement,
  title: HTMLInputElement,
  enabled: boolean,
): void {
  // Reassigning contentEditable can reset Gecko's selection, even to the same value.
  const editable = String(enabled);
  if (content.contentEditable !== editable) content.contentEditable = editable;
  if (title.disabled === enabled) title.disabled = !enabled;
}
