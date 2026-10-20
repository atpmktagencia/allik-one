import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { getDocumentProxy } from "unpdf";
import { laboratoryRobustnessCases } from "../test/fixtures/laboratory-robustness";
import { laboratoryDraft } from "../lib/laboratory-results";

const directory = new URL("../test/fixtures/laboratory-robustness-pdfs/", import.meta.url);
const hashes = JSON.parse(await readFile(new URL("sha256.json", directory), "utf8"));
const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));

it("ties every synthetic specimen and manually authored reference to a versioned PDF hash", async () => {
  expect(manifest.classification).toBe("SYNTHETIC_ONLY_NO_REAL_PATIENT_DATA");
  expect(laboratoryRobustnessCases).toHaveLength(12);
  expect(new Set(laboratoryRobustnessCases.map((item) => item.id)).size).toBe(12);
  for (const item of laboratoryRobustnessCases) {
    const bytes = await readFile(new URL(`${item.id}.pdf`, directory));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hashes[item.id]);
    expect(manifest.cases.find((entry: { id: string }) => entry.id === item.id)).toMatchObject({
      sha256: hashes[item.id],
      pages: item.pages.length,
      legibleObservations: item.reference.length,
    });
    expect("predictions" in item).toBe(false);
    expect(
      laboratoryDraft.safeParse({
        patientConfirmed: false,
        notes: "",
        rows: item.reference.map((ref) => ref.row),
      }).success,
    ).toBe(true);
    expect(
      item.reference.every(({ row }) => !row.verified && row.sourcePage! <= item.pages.length),
    ).toBe(true);
  }
});

it("renders real pages and preserves the distinction between native text, geometry and raster-only evidence", async () => {
  for (const item of laboratoryRobustnessCases) {
    const bytes = await readFile(new URL(`${item.id}.pdf`, directory));
    const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
    try {
      expect(pdf.numPages).toBe(item.pages.length);
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        const strings = content.items.filter((entry) => "str" in entry).map((entry) => entry.str);
        if (item.format === "scanned") expect(strings.join("").trim()).toBe("");
        else expect(strings.join(" ")).toContain("SINTÉTICO");
        if (item.id === "many-pages-repeated-parameters") {
          expect(strings.join(" ").length).toBeGreaterThan(80);
          expect(strings.join(" ")).toContain("Anti-HCV");
          expect(item.reference.filter(({ row }) => row.sourcePage === number)).toHaveLength(3);
        }
        if (item.rendering === "geometric-table") {
          const actual = content.items.find(
            (entry) => "str" in entry && entry.str === "Resultado atual",
          );
          const previous = content.items.find(
            (entry) => "str" in entry && entry.str === "Resultado anterior",
          );
          expect(actual && "transform" in actual ? actual.transform[4] : null).toBe(180);
          expect(previous && "transform" in previous ? previous.transform[4] : null).toBe(290);
          expect(strings.join(" ")).not.toContain("|");
        }
        page.cleanup();
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
  }
});

it("does not invent golden values or resolved dates for masked and semantically ambiguous source fields", () => {
  const masked = laboratoryRobustnessCases.find((item) => item.id === "scan-partially-masked")!;
  expect(masked.reference.map(({ row }) => row.name)).toEqual(["TSH"]);
  expect(masked.expectedUnresolved).toEqual([
    { name: "Ferritina", sourcePage: 1, reason: "unreadable" },
  ]);
  const ambiguous = laboratoryRobustnessCases.find(
    (item) => item.id === "dates-ambiguous-no-format",
  )!;
  expect(ambiguous.reference[0]!.row).toMatchObject({
    collectedOn: null,
    reportedOn: null,
    issuedOn: null,
  });
  expect(ambiguous.expectedUnresolved?.[0]).toMatchObject({
    reason: "ambiguous_date",
    fields: ["collectedOn", "reportedOn", "issuedOn"],
  });
  const explicit = laboratoryRobustnessCases.find((item) => item.id === "dates-explicit-ddmm")!;
  expect(explicit.pages[0]).toContain("Formato das datas: DD/MM/AAAA");
  expect(explicit.reference[0]!.row).toMatchObject({
    collectedOn: "2026-01-02",
    reportedOn: "2026-01-04",
    issuedOn: "2026-01-05",
  });
});
