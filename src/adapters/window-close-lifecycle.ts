export function observeWindowClose(
  target: Window,
  expectedURL: string,
  onClose: () => void,
): () => void {
  let active = true;
  const onUnload = () => {
    if (!active) return;
    active = false;
    target.removeEventListener("load", onLoad);
    target.removeEventListener("unload", onUnload);
    onClose();
  };
  const loadedTargetDocument = () =>
    target.location.href === expectedURL &&
    target.document.readyState !== "loading";
  const onLoad = () => {
    if (!active || !loadedTargetDocument()) return;
    target.removeEventListener("load", onLoad);
    target.addEventListener("unload", onUnload, { once: true });
  };
  if (loadedTargetDocument()) onLoad();
  else target.addEventListener("load", onLoad);
  return () => {
    if (!active) return;
    active = false;
    target.removeEventListener("load", onLoad);
    target.removeEventListener("unload", onUnload);
  };
}
