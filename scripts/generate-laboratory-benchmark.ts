import PDFDocument from "pdfkit";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { laboratoryBenchmarkCases } from "../src/test/fixtures/laboratory-benchmark";

const directory = new URL("../src/test/fixtures/laboratory-pdfs/", import.meta.url);
await mkdir(directory, { recursive: true });
const hashes: Record<string, string> = {};
for (const item of laboratoryBenchmarkCases) {
  const pdf = new PDFDocument({
    autoFirstPage: false,
    info: {
      Title: `Synthetic laboratory benchmark: ${item.id}`,
      CreationDate: new Date("2026-01-01T00:00:00Z"),
      ModDate: new Date("2026-01-01T00:00:00Z"),
    },
  });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  for (const text of item.pages) {
    pdf.addPage({ size: "A4", margin: 35 });
    if (item.format === "scanned")
      pdf.image(await readFile(new URL("scan.png", directory)), 35, 35, { width: 520 });
    else pdf.font("Helvetica").fontSize(10).text(text, { lineGap: 4 });
  }
  pdf.end();
  const bytes = await complete;
  await writeFile(new URL(`${item.id}.pdf`, directory), bytes);
  hashes[item.id] = createHash("sha256").update(bytes).digest("hex");
}
await writeFile(new URL("sha256.json", directory), JSON.stringify(hashes, null, 2) + "\n");
console.log(`Generated ${laboratoryBenchmarkCases.length} synthetic PDFs; no provider calls.`);
