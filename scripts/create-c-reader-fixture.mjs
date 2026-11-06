import { constants } from "node:fs";
import { promises as fs } from "node:fs";
import { Buffer } from "node:buffer";
import console from "node:console";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(repo, ".scaffold/c-reader-fixture.pdf");
const pages = [
  [
    "BT /F1 18 Tf 72 720 Td (ZotObsidian Bridge C0 Reader Fixture) Tj",
    "0 -48 Td (Select this sentence to test the Bridge annotation popup.) Tj",
    "0 -32 Td (Synthetic text only; no research content is included.) Tj",
    "ET",
  ].join("\n"),
  [
    "BT /F1 18 Tf 72 720 Td (C0 expanded editor fixture - page two) Tj",
    "0 -48 Td (Test the expanded editor and source-link controls here.) Tj",
    "0 -32 Td (PDF page label: 2; zero-based page index: 1.) Tj",
    "ET",
  ].join("\n"),
];
const stream = (content) =>
  `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`;
const objects = [
  "<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r /St 1 >> 1 << /S /D /St 2 >>] >> >>",
  "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
  stream(pages[0]),
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
  stream(pages[1]),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  "<< /Title (ZotObsidian Bridge C0 Reader Fixture) /Author (Synthetic test data only) >>",
];
let pdf = "%PDF-1.4\n";
const offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(pdf, "ascii"));
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf, "ascii");
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets.slice(1))
  pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
await fs.writeFile(target, pdf, {
  encoding: "ascii",
  flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
  mode: 0o600,
});
console.log(target);
