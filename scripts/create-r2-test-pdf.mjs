import fs from "node:fs/promises";
import { Buffer } from "node:buffer";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixtureDirectory = path.join(projectRoot, ".scaffold/r2-fixtures");
const outputPath = path.join(fixtureDirectory, "bridge-r2-test.pdf");

const pageOne = [
  "BT /F1 18 Tf 72 720 Td (Zotero Obsidian Bridge - R2 Test Fixture) Tj",
  "0 -42 Td (Page one: select this sentence and save a PDF annotation.) Tj",
  "0 -28 Td (The PDF page label is i while its zero-based index is 0.) Tj",
  "0 -42 Td (Repeated annotation-card creation must reuse the same card.) Tj",
  "ET",
].join("\n");
const pageTwo = [
  "BT /F1 18 Tf 72 720 Td (R2 Fixture - Page Two) Tj",
  "0 -42 Td (Use this page to verify page-label and page-index mapping.) Tj",
  "0 -28 Td (The PDF page label is 2 while its zero-based index is 1.) Tj",
  "0 -42 Td (This page also supports editor, save, and source-link checks.) Tj",
  "ET",
].join("\n");

function streamObject(content) {
  const length = Buffer.byteLength(content, "ascii");
  return `<< /Length ${length} >>\nstream\n${content}\nendstream`;
}

const objects = [
  "<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r /St 1 >> 1 << /S /D /St 2 >>] >> >>",
  "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
  streamObject(pageOne),
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
  streamObject(pageTwo),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  "<< /Title (Zotero Obsidian Bridge R2 Test Fixture) /Author (Local Development Fixture) >>",
];

let pdf = "%PDF-1.4\n";
const offsets = [0];
for (let index = 0; index < objects.length; index++) {
  offsets.push(Buffer.byteLength(pdf, "ascii"));
  pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
}

const xrefOffset = Buffer.byteLength(pdf, "ascii");
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets.slice(1)) {
  pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

await fs.mkdir(fixtureDirectory, { recursive: true });
await fs.writeFile(outputPath, pdf, { encoding: "ascii" });
process.stdout.write(`${outputPath}\n`);
