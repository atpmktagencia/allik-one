import PDFDocument from "pdfkit";
import { afterEach, expect, it, vi } from "vitest";
import { extractLaboratoryPdfText, LABORATORY_PDF_TEXT_LIMITS } from "./laboratory-pdf-text";

const parser = vi.hoisted(() => ({ override: vi.fn() }));
vi.mock("unpdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("unpdf")>();
  return {
    ...actual,
    getDocumentProxy: (...args: Parameters<typeof actual.getDocumentProxy>) =>
      parser.override.getMockImplementation()
        ? parser.override(...args)
        : actual.getDocumentProxy(...args),
  };
});
afterEach(() => {
  parser.override.mockReset();
  vi.useRealTimers();
});

async function pdfBytes(pages: string[]) {
  const pdf = new PDFDocument({ autoFirstPage: false });
  const chunks: Buffer[] = [];
  const complete = new Promise<Uint8Array>((resolve, reject) => {
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    pdf.on("error", reject);
  });
  for (const text of pages) {
    pdf.addPage();
    if (text) pdf.text(text);
  }
  pdf.end();
  return complete;
}

it("extracts independent literal text with page provenance without detaching original bytes", async () => {
  const bytes = await pdfBytes(["TSH <0,1 mUI/L Ref. 0,4 - 4,0", "Vitamina B12 450 pg/mL"]);
  const original = new Uint8Array(bytes);
  const output = await extractLaboratoryPdfText(bytes);
  expect(output.status).toBe("available");
  if (output.status !== "available") throw new Error("Text extraction unavailable");
  expect(output.totalPages).toBe(2);
  expect(output.pages[0]).toEqual({ page: 1, text: "TSH <0,1 mUI/L Ref. 0,4 - 4,0" });
  expect(output.pages[1]?.text).toContain("450 pg/mL");
  expect(bytes).toEqual(original);
});

it("does not invent text for a scanned/blank page or return parser details for invalid input", async () => {
  expect(await extractLaboratoryPdfText(await pdfBytes([""]))).toEqual({
    status: "unavailable",
    reason: "NO_TEXT",
  });
  expect(await extractLaboratoryPdfText(new TextEncoder().encode("not PDF"))).toEqual({
    status: "unavailable",
    reason: "INVALID_PDF",
  });
  expect(await extractLaboratoryPdfText(new TextEncoder().encode("%PDF-broken"))).toEqual({
    status: "unavailable",
    reason: "INVALID_PDF",
  });
});

it("bounds file size and page fan-out before reading pages", async () => {
  expect(
    await extractLaboratoryPdfText(new Uint8Array(LABORATORY_PDF_TEXT_LIMITS.bytes + 1)),
  ).toEqual({ status: "unavailable", reason: "FILE_LIMIT" });
  const destroy = vi.fn().mockResolvedValue(undefined);
  const getPage = vi.fn();
  parser.override.mockResolvedValue({ numPages: 101, loadingTask: { destroy }, getPage });
  expect(await extractLaboratoryPdfText(new TextEncoder().encode("%PDF-test"))).toEqual({
    status: "unavailable",
    reason: "PAGE_LIMIT",
  });
  expect(getPage).not.toHaveBeenCalled();
  expect(destroy).toHaveBeenCalledOnce();
});

it("discards all partial text when a PDF exceeds the character bound", async () => {
  const cleanup = vi.fn();
  const destroy = vi.fn().mockResolvedValue(undefined);
  parser.override.mockResolvedValue({
    numPages: 1,
    loadingTask: { destroy },
    getPage: async () => ({
      cleanup,
      getTextContent: async () => ({
        items: [{ str: "a".repeat(LABORATORY_PDF_TEXT_LIMITS.characters + 1), hasEOL: false }],
      }),
    }),
  });
  expect(await extractLaboratoryPdfText(new TextEncoder().encode("%PDF-test"))).toEqual({
    status: "unavailable",
    reason: "TEXT_LIMIT",
  });
  expect(cleanup).toHaveBeenCalledOnce();
  expect(destroy).toHaveBeenCalledOnce();
});

it("bounds a stuck asynchronous parser and destroys a late document", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  parser.override.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = extractLaboratoryPdfText(new TextEncoder().encode("%PDF-test"));
  await vi.advanceTimersByTimeAsync(LABORATORY_PDF_TEXT_LIMITS.milliseconds + 1);
  expect(await pending).toEqual({ status: "unavailable", reason: "TIMEOUT" });
  const destroy = vi.fn().mockResolvedValue(undefined);
  finish({ loadingTask: { destroy } });
  await vi.advanceTimersByTimeAsync(1);
  expect(destroy).toHaveBeenCalledOnce();
});
