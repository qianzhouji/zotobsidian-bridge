const previewResourcesKey = Symbol.for(
  "zotero-obsidian-bridge.preview-resources",
);

type ResourceElement = HTMLElement & {
  [previewResourcesKey]?: ReadonlyMap<string, Blob>;
};

export function setMarkdownPreviewResources(
  target: HTMLElement,
  imageResources: ReadonlyMap<string, Blob>,
): void {
  (target as ResourceElement)[previewResourcesKey] = imageResources;
}

export function syncMarkdownPreviewImages(
  sourceRoot: HTMLElement,
  targetRoot: HTMLElement,
  targetDocument: Document,
  ownedURLs: Map<string, string>,
): void {
  const resources =
    (sourceRoot as ResourceElement)[previewResourcesKey] ?? new Map();
  const sourceImages = sourceRoot.querySelectorAll<HTMLImageElement>("img");
  const targetImages = targetRoot.querySelectorAll<HTMLImageElement>("img");
  const active = new Set<string>();
  const targetURL = targetDocument.defaultView?.URL ?? URL;

  for (let index = 0; index < sourceImages.length; index++) {
    const sourceURL = sourceImages[index].getAttribute("src") ?? "";
    const blob = resources.get(sourceURL);
    const target = targetImages[index];
    if (!target || !blob) {
      target?.removeAttribute("src");
      continue;
    }
    active.add(sourceURL);
    let mirroredURL = ownedURLs.get(sourceURL);
    if (!mirroredURL) {
      const createdURL = targetURL.createObjectURL(blob);
      if (!createdURL) {
        target.removeAttribute("src");
        continue;
      }
      ownedURLs.set(sourceURL, createdURL);
      mirroredURL = createdURL;
    }
    if (target.getAttribute("src") !== mirroredURL)
      target.setAttribute("src", mirroredURL);
  }

  for (const [sourceURL, mirroredURL] of ownedURLs) {
    if (active.has(sourceURL)) continue;
    targetURL.revokeObjectURL(mirroredURL);
    ownedURLs.delete(sourceURL);
  }
}

export function disposeMarkdownPreviewImages(
  targetDocument: Document,
  ownedURLs: Map<string, string>,
): void {
  const targetURL = targetDocument.defaultView?.URL ?? URL;
  for (const mirroredURL of ownedURLs.values())
    targetURL.revokeObjectURL(mirroredURL);
  ownedURLs.clear();
}
