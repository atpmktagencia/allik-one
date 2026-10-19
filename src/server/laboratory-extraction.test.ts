import { afterEach, expect, it, vi } from "vitest";
import { extractLaboratoryPdf } from "./laboratory-extraction";
import { emptyLaboratoryRow } from "../lib/laboratory-results";
const sdk = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", () => ({
  generateText: sdk.generate,
  Output: { object: (value: unknown) => value },
  gateway: { getAvailableModels: vi.fn() },
}));
afterEach(() => {
  sdk.generate.mockReset();
  vi.useRealTimers();
});
const extractedRow = () => {
  const row: Partial<ReturnType<typeof emptyLaboratoryRow>> = {
    ...emptyLaboratoryRow(),
    name: "Exame",
    result: "Não reagente",
  };
  delete row.verified;
  return row;
};
it("sends PDF bytes to structured output without tools or retries and returns unconfirmed literal rows", async () => {
  sdk.generate.mockResolvedValue({ output: { notes: "Transcrição", rows: [extractedRow()] } });
  const bytes = new TextEncoder().encode("%PDF-1.7 synthetic");
  const draft = await extractLaboratoryPdf(bytes, "synthetic/model");
  expect(draft.patientConfirmed).toBe(false);
  expect(draft.rows[0]?.verified).toBe(false);
  expect(draft.rows[0]?.result).toBe("Não reagente");
  const call = sdk.generate.mock.calls[0]![0];
  expect(call.maxRetries).toBe(0);
  expect(call.maxOutputTokens).toBe(16000);
  expect(call.tools).toBeUndefined();
  expect(call.messages[0].content[1]).toMatchObject({
    type: "file",
    mediaType: "application/pdf",
    data: bytes,
  });
});
it("rejects malformed dates and empty result sets rather than publishing fabricated values", async () => {
  sdk.generate.mockResolvedValueOnce({
    output: { notes: "", rows: [{ ...extractedRow(), collectedOn: "2026-02-30" }] },
  });
  await expect(extractLaboratoryPdf(new Uint8Array(), "synthetic/model")).rejects.toThrow();
  sdk.generate.mockResolvedValueOnce({ output: { notes: "Não é exame", rows: [] } });
  await expect(extractLaboratoryPdf(new Uint8Array(), "synthetic/model")).rejects.toThrow(
    "NO_RESULTS",
  );
});
it("aborts a stuck provider at the bounded deadline", async () => {
  vi.useFakeTimers();
  sdk.generate.mockImplementation(() => new Promise(() => {}));
  const pending = extractLaboratoryPdf(new Uint8Array(), "synthetic/model");
  const rejection = expect(pending).rejects.toThrow("EXTRACTION_TIMEOUT");
  await vi.advanceTimersByTimeAsync(60001);
  await rejection;
  expect(sdk.generate.mock.calls[0]![0].abortSignal.aborted).toBe(true);
});
