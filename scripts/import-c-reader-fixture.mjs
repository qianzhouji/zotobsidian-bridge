import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import console from "node:console";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scaffold = await fs.realpath(path.join(repo, ".scaffold"));
const manifest = JSON.parse(
  await fs.readFile(path.join(scaffold, "c-host-manifest.json"), "utf8"),
);
assert.equal(manifest.paths.profile, path.join(scaffold, "c-profile"));
assert.equal(manifest.paths.data, path.join(scaffold, "c-data"));
const expectedArgs = `/Applications/Zotero.app/Contents/MacOS/zotero -no-remote -profile ${manifest.paths.profile} --dataDir ${manifest.paths.data}`;
const ps = execFileSync("ps", ["-axo", "args"], { encoding: "utf8" });
assert.ok(
  ps.split("\n").includes(expectedArgs),
  "C-isolated Zotero process is not running",
);

const pdfPath = path.join(scaffold, "c-reader-fixture.pdf");
const pdfStat = await fs.lstat(pdfPath);
assert.ok(pdfStat.isFile() && !pdfStat.isSymbolicLink() && pdfStat.nlink === 1);
const pdf = await fs.readFile(pdfPath);
assert.equal(pdf.subarray(0, 8).toString("ascii"), "%PDF-1.4");
const pdfHash = createHash("sha256").update(pdf).digest("hex");
const title = "ZotObsidian Bridge C0 Reader Fixture (Standalone PDF)";
const base = "http://127.0.0.1:23127";
const headers = { "Zotero-Allowed-Request": "true" };
const fixtureURL = "http://localhost/zotobsidian-bridge/c0-reader-fixture.pdf";

async function listItems() {
  const response = await globalThis.fetch(
    `${base}/api/users/0/items?format=json&limit=100`,
  );
  assert.equal(response.status, 200, "isolated local API did not respond");
  const items = await response.json();
  assert.ok(Array.isArray(items));
  return items;
}

const candidates = (items) =>
  items.filter(
    (item) =>
      item.data?.itemType === "attachment" &&
      item.data?.contentType === "application/pdf" &&
      item.data?.url === fixtureURL,
  );

let attachments = candidates(await listItems());
assert.ok(attachments.length <= 1, "duplicate C0 PDF fixture detected");
let importedNow = false;
if (attachments.length === 0) {
  const metadata = { sessionID: randomUUID(), title, url: fixtureURL };
  const saveAttachment = await globalThis.fetch(
    `${base}/connector/saveStandaloneAttachment`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "X-Metadata": JSON.stringify(metadata),
      },
      body: pdf,
    },
  );
  assert.equal(
    saveAttachment.status,
    201,
    `saveStandaloneAttachment failed: ${await saveAttachment.text()}`,
  );
  importedNow = true;
  for (let attempt = 0; attempt < 20 && attachments.length === 0; attempt++) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
    attachments = candidates(await listItems());
  }
}
assert.equal(attachments.length, 1, "C0 PDF attachment not found in local API");
const attachment = attachments[0];
const file = await globalThis.fetch(
  `${base}/api/users/0/items/${encodeURIComponent(attachment.key)}/file`,
  { redirect: "manual" },
);
assert.equal(file.status, 302, "expected Zotero local-file redirect");
const location = new globalThis.URL(file.headers.get("location"));
assert.equal(
  location.protocol,
  "file:",
  "attachment did not resolve to a local file",
);
const storageRoot = await fs.realpath(
  path.join(manifest.paths.data, "storage"),
);
const storageFile = await fs.realpath(fileURLToPath(location));
assert.ok(
  storageFile.startsWith(storageRoot + path.sep),
  "Zotero attachment redirect escaped the C-isolated storage directory",
);
const storageStat = await fs.lstat(fileURLToPath(location));
assert.ok(storageStat.isFile() && !storageStat.isSymbolicLink());
const stored = await fs.readFile(storageFile);
assert.equal(
  createHash("sha256").update(stored).digest("hex"),
  pdfHash,
  "stored PDF differs from the synthetic fixture",
);

const report = {
  result: "PASS",
  scope: "C isolated Zotero profile only",
  title,
  itemKey: attachment.key,
  parentItemKey: attachment.data.parentItem || null,
  importedNow,
  pdfSHA256: pdfHash,
  pdfBytes: pdf.length,
  importedAt: new Date().toISOString(),
};
await fs.writeFile(
  path.join(scaffold, "c-reader-fixture-import.json"),
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(report, null, 2));
