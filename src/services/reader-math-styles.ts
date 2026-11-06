const mathStylesID = "zob-reader-card-katex-styles";
const mathStylesURL = "chrome://zoteroobsidianbridge/content/katex.min.css";
const fontBaseURL = "chrome://zoteroobsidianbridge/content/fonts/";
const pendingDocuments = new WeakMap<Document, Promise<void>>();

export function installReaderMathStyles(
  doc: Document,
  readStyles: (url: string) => Promise<string> = (url) =>
    Zotero.File.getContentsFromURLAsync(url),
): Promise<void> {
  if (doc.getElementById(mathStylesID)) return Promise.resolve();
  const pending = pendingDocuments.get(doc);
  if (pending) return pending;
  const target = doc.head ?? doc.documentElement;
  if (!target) return Promise.resolve();
  const load = readStyles(mathStylesURL)
    .then((css) => {
      if (doc.getElementById(mathStylesID)) return;
      const style = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "style",
      );
      style.id = mathStylesID;
      style.textContent = css
        .replaceAll("url(fonts/", `url(${fontBaseURL}`)
        .replace("body{counter-reset:katexEqnNo mmlEqnNo}", "");
      target.append(style);
    })
    .finally(() => pendingDocuments.delete(doc));
  pendingDocuments.set(doc, load);
  return load;
}
