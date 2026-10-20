import PDFDocument from "pdfkit";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { laboratoryRobustnessCases } from "../src/test/fixtures/laboratory-robustness";

/** Explicit offline corpus generator. Never imported by builds or application routes. */
const directory = new URL("../src/test/fixtures/laboratory-robustness-pdfs/", import.meta.url);
await mkdir(directory, { recursive: true });
execFileSync(
  "python3",
  [fileURLToPath(new URL("./generate-laboratory-robustness-rasters.py", import.meta.url))],
  { stdio: "inherit" },
);
const hashes: Record<string, string> = {};
for (const item of laboratoryRobustnessCases) {
  const pdf = new PDFDocument({
    autoFirstPage: false,
    info: {
      Title: `Synthetic laboratory robustness: ${item.id}`,
      CreationDate: new Date("2026-01-01T00:00:00Z"),
      ModDate: new Date("2026-01-01T00:00:00Z"),
    },
  });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  for (const text of item.pages) {
    pdf.addPage({ size: "A4", margin: 35 });
    if (item.rendering === "raster") {
      if (!item.raster) throw new Error("Missing synthetic raster");
      pdf.image(await readFile(new URL(item.raster, directory)), 35, 35, { fit: [525, 740] });
    } else if (item.rendering === "geometric-table") {
      pdf
        .font("Helvetica")
        .fontSize(9)
        .text("DOCUMENTO SINTÉTICO - SOMENTE TESTE - SEM PACIENTE REAL", 35, 35);
      pdf.text("Somente a coluna Resultado atual representa resultados atuais.", 35, 55);
      const columns = [35, 180, 290, 405, 465];
      const table = [
        ["Exame", "Resultado atual", "Resultado anterior", "Unidade", "Referência"],
        ["Glicose", "91", "109", "mg/dL", "70 - 99"],
        ["Ureia", "32", "41", "mg/dL", "10 - 50"],
        ["T4 livre", "1,3", "1,1", "ng/dL", "0,8 - 1,8"],
      ];
      table.forEach((cells, row) => {
        const y = 95 + row * 42;
        pdf
          .moveTo(35, y - 9)
          .lineTo(560, y - 9)
          .strokeColor("#cccccc")
          .stroke();
        cells.forEach((value, col) =>
          pdf.text(value, columns[col]!, y, {
            width: col === 0 ? 135 : col === 4 ? 95 : col === 3 ? 60 : 105,
            lineBreak: false,
          }),
        );
      });
    } else pdf.font("Helvetica").fontSize(10).text(text, { lineGap: 4 });
  }
  pdf.end();
  const bytes = await complete;
  await writeFile(new URL(`${item.id}.pdf`, directory), bytes);
  hashes[item.id] = createHash("sha256").update(bytes).digest("hex");
}
await writeFile(new URL("sha256.json", directory), JSON.stringify(hashes, null, 2) + "\n");
const manifest = {
  classification: "SYNTHETIC_ONLY_NO_REAL_PATIENT_DATA",
  referenceBasis:
    "Hand-authored source specimens and independent expected observations; never model-generated or derived from predictions.",
  generator: "scripts/generate-laboratory-robustness.ts",
  dependencies:
    "Existing PDFKit; Python 3 + Pillow and system DejaVuSans for raster fixtures. Not a runtime dependency.",
  cases: laboratoryRobustnessCases.map(
    ({ id, format, tags, pages, reference, notes, rendering, raster, expectedUnresolved }) => ({
      id,
      format,
      tags,
      pages: pages.length,
      sha256: hashes[id],
      legibleObservations: reference.length,
      notes,
      rendering: rendering ?? "text",
      raster: raster ?? null,
      expectedUnresolved: expectedUnresolved ?? [],
    }),
  ),
};
await writeFile(new URL("manifest.json", directory), JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `Generated ${laboratoryRobustnessCases.length} synthetic robustness PDFs; no provider calls.`,
);
