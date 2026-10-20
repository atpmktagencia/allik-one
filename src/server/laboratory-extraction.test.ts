import { afterEach, expect, it, vi } from "vitest";
import {
  extractLaboratoryPdf,
  laboratoryFailureCode,
  laboratoryExtractionConfiguration,
  laboratoryProviderStatus,
} from "./laboratory-extraction";
import { LABORATORY_EXTRACTION_POLICY as limits } from "../lib/laboratory-extraction-policy";
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
  vi.unstubAllEnvs();
});
const extractedRow = () => {
  const row: Partial<ReturnType<typeof emptyLaboratoryRow>> = {
    ...emptyLaboratoryRow(),
    name: "Exame",
    result: "Não reagente",
    issuedOn: null,
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
  await vi.advanceTimersByTimeAsync(limits.totalMilliseconds + 1);
  await rejection;
  expect(sdk.generate.mock.calls[0]![0].abortSignal.aborted).toBe(true);
});

it("classifies provider failures without leaking arbitrary messages or response data", () => {
  expect(laboratoryFailureCode({ statusCode: 402, message: "SECRET" })).toBe("PROVIDER_CREDITS");
  expect(
    laboratoryFailureCode({
      statusCode: 403,
      responseBody: JSON.stringify({
        error: { code: "customer_verification_required", message: "SECRET" },
      }),
    }),
  ).toBe("PROVIDER_VERIFICATION");
  expect(
    laboratoryFailureCode({
      statusCode: 429,
      responseBody: JSON.stringify({ error: { code: "insufficient_quota" } }),
    }),
  ).toBe("PROVIDER_CREDITS");
  expect(laboratoryFailureCode({ cause: { statusCode: 401 } })).toBe("PROVIDER_AUTHENTICATION");
  expect(
    laboratoryFailureCode({ name: "AI_NoObjectGeneratedError", message: "PATIENT DATA" }),
  ).toBe("PROVIDER_INVALID_OUTPUT");
  expect(laboratoryFailureCode({ statusCode: 400 })).toBe("PROVIDER_REQUEST_REJECTED");
  expect(laboratoryFailureCode(new Error("SECRET PATIENT DATA"))).toBe("EXTRACTION_FAILED");
});
it("does not fall back to Gateway or call a provider when direct OpenAI credentials are missing", async () => {
  vi.stubEnv("LAB_EXTRACTION_PROVIDER", "openai");
  vi.stubEnv("LAB_EXTRACTION_MODEL", "openai/gpt-6-luna");
  vi.stubEnv("OPENAI_API_KEY", "");
  expect(laboratoryExtractionConfiguration().problem).toBe("PROVIDER_AUTHENTICATION");
  await expect(extractLaboratoryPdf(new Uint8Array(), "openai/gpt-6-luna")).rejects.toThrow(
    "PROVIDER_AUTHENTICATION",
  );
  expect(sdk.generate).not.toHaveBeenCalled();
  expect(await laboratoryProviderStatus()).toMatchObject({
    ready: false,
    failureCode: "PROVIDER_AUTHENTICATION",
  });
});

it("uses direct Responses with storage disabled and preserves required human confirmation", async () => {
  vi.stubEnv("LAB_EXTRACTION_PROVIDER", "openai");
  vi.stubEnv("LAB_EXTRACTION_MODEL", "openai/gpt-6-luna");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-not-a-credential");
  sdk.generate.mockResolvedValue({ output: { notes: "", rows: [extractedRow()] } });
  const result = await extractLaboratoryPdf(new Uint8Array(), "openai/gpt-6-luna");
  const call = sdk.generate.mock.calls[0]![0];
  expect(call.model.modelId).toBe("gpt-6-luna");
  expect(call.model.provider).toBe("openai.responses");
  expect(call.providerOptions).toEqual({ openai: { store: false, reasoningEffort: "low" } });
  expect(result.patientConfirmed).toBe(false);
  expect(result.rows[0]?.verified).toBe(false);
});
it("reports only sanitized aggregate usage through the extraction boundary", async () => {
  vi.stubEnv("LAB_EXTRACTION_PROVIDER", "openai");
  vi.stubEnv("LAB_EXTRACTION_MODEL", "openai/synthetic");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-not-a-credential");
  const observed = vi.fn();
  sdk.generate.mockResolvedValue({
    output: { notes: "PRIVATE SYNTHETIC NOTE", rows: [extractedRow()] },
    totalUsage: { inputTokens: 123, outputTokens: 45, raw: { arbitrary: "DO_NOT_STORE" } },
  });
  await extractLaboratoryPdf(new Uint8Array(), "openai/synthetic", undefined, observed);
  expect(observed).toHaveBeenCalledWith(
    expect.objectContaining({
      inputTokens: 123,
      outputTokens: 45,
      pipelineVersion: "lab-pipeline-2",
      promptVersion: "lab-transcription-2",
      extractedRows: 1,
      estimatedCostUsd: null,
    }),
  );
  expect(JSON.stringify(observed.mock.calls)).not.toMatch(/PRIVATE|DO_NOT_STORE|credential/);
});

const sourcePages = (count: number) => ({
  status: "available" as const,
  totalPages: count,
  pages: Array.from({ length: count }, (_, i) => ({
    page: i + 1,
    text:
      `Página ${i + 1}\nTSH <0,1 µUI/mL Referência 0,27–4,2\n` +
      "Texto literal da fonte. ".repeat(8),
  })),
});
const outputFor = (page: number) => ({
  output: {
    notes: "",
    rows: [{ ...extractedRow(), name: `Exame página ${page}`, sourcePage: page }],
  },
});

it("transcribes text in bounded parallel batches, preserves source page numbers and original result order", async () => {
  const completions: Array<(value: ReturnType<typeof outputFor>) => void> = [];
  sdk.generate.mockImplementation(() => new Promise((resolve) => completions.push(resolve)));
  const pending = extractLaboratoryPdf(new Uint8Array(), "synthetic/model", sourcePages(5));
  expect(sdk.generate).toHaveBeenCalledTimes(2);
  expect(sdk.generate.mock.calls[0]![0].messages[0].content).toHaveLength(1);
  expect(sdk.generate.mock.calls[0]![0].messages[0].content[0].type).toBe("text");
  expect(sdk.generate.mock.calls[1]![0].messages[0].content[0].text).toContain("PÁGINA ORIGINAL 3");
  completions[1]!(outputFor(3));
  await vi.waitFor(() => expect(sdk.generate).toHaveBeenCalledTimes(3));
  completions[2]!(outputFor(5));
  completions[0]!(outputFor(1));
  const result = await pending;
  expect(result.rows.map((row) => row.sourcePage)).toEqual([1, 3, 5]);
  expect(result.rows.every((row) => !row.verified)).toBe(true);
  expect(result.patientConfirmed).toBe(false);
  expect(result.rows.every((row) => row.result === "Não reagente")).toBe(true);
});
it("retains the complete PDF for mixed scanned pages instead of silently omitting an empty page", async () => {
  const text = sourcePages(3);
  text.pages[1]!.text = "";
  sdk.generate.mockResolvedValue(outputFor(2));
  const bytes = new TextEncoder().encode("%PDF-1.7 synthetic");
  await extractLaboratoryPdf(bytes, "synthetic/model", text);
  expect(sdk.generate).toHaveBeenCalledOnce();
  expect(sdk.generate.mock.calls[0]![0].messages[0].content[1]).toMatchObject({
    type: "file",
    data: bytes,
  });
});
it("does not publish partial batches or keep scheduling paid calls after a provider failure", async () => {
  let rejectFirst: (error: unknown) => void = () => {};
  sdk.generate.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectFirst = reject;
      }),
  );
  sdk.generate.mockImplementation(() => new Promise(() => {}));
  const pending = extractLaboratoryPdf(new Uint8Array(), "synthetic/model", sourcePages(6));
  const denied = { statusCode: 401 };
  const rejection = expect(pending).rejects.toBe(denied);
  rejectFirst(denied);
  await rejection;
  expect(sdk.generate).toHaveBeenCalledTimes(2);
  for (const call of sdk.generate.mock.calls) expect(call[0].abortSignal.aborted).toBe(true);
});
it("bounds one text batch even when the provider ignores abort, and never returns partial output", async () => {
  vi.useFakeTimers();
  sdk.generate.mockImplementation(() => new Promise(() => {}));
  const pending = extractLaboratoryPdf(new Uint8Array(), "synthetic/model", sourcePages(4));
  const rejection = expect(pending).rejects.toThrow("EXTRACTION_TIMEOUT");
  await vi.advanceTimersByTimeAsync(limits.batchMilliseconds + 1);
  await rejection;
  expect(sdk.generate).toHaveBeenCalledTimes(2);
  expect(sdk.generate.mock.calls.every((call) => call[0].abortSignal.aborted)).toBe(true);
});
it("enforces a total deadline across otherwise successful batches", async () => {
  vi.useFakeTimers();
  sdk.generate.mockImplementation(
    (call) =>
      new Promise((resolve) => {
        const page = Number(call.messages[0].content[0].text.match(/PÁGINA ORIGINAL (\d+)/)[1]);
        setTimeout(() => resolve(outputFor(page)), 55000);
      }),
  );
  const pending = extractLaboratoryPdf(new Uint8Array(), "synthetic/model", sourcePages(12));
  const rejection = expect(pending).rejects.toThrow("EXTRACTION_TIMEOUT");
  await vi.advanceTimersByTimeAsync(limits.totalMilliseconds + 1);
  await rejection;
  expect(sdk.generate).toHaveBeenCalledTimes(6);
});
it("rejects invented source page provenance and aggregate overflow without truncating clinical results", async () => {
  sdk.generate.mockResolvedValueOnce(outputFor(9));
  await expect(
    extractLaboratoryPdf(new Uint8Array(), "synthetic/model", sourcePages(1)),
  ).rejects.toMatchObject({ name: "AI_TypeValidationError" });
  sdk.generate.mockResolvedValue({
    output: {
      notes: "",
      rows: Array.from({ length: 101 }, () => ({ ...extractedRow(), sourcePage: null })),
    },
  });
  await expect(
    extractLaboratoryPdf(new Uint8Array(), "synthetic/model", sourcePages(4)),
  ).rejects.toThrow();
});
it("caps the number of model calls for very large documents", async () => {
  sdk.generate.mockResolvedValue(outputFor(1));
  await extractLaboratoryPdf(
    new Uint8Array(),
    "synthetic/model",
    sourcePages(2 * limits.maxBatches + 1),
  );
  expect(sdk.generate).toHaveBeenCalledOnce();
  expect(sdk.generate.mock.calls[0]![0].messages[0].content[1].type).toBe("file");
});

it("allows a valid original-PDF response beyond the old 60-second cutoff within the new total deadline", async () => {
  vi.useFakeTimers();
  sdk.generate.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(outputFor(1)), 70000)),
  );
  const pending = extractLaboratoryPdf(new Uint8Array(), "synthetic/model");
  await vi.advanceTimersByTimeAsync(70001);
  const result = await pending;
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]?.verified).toBe(false);
  expect(result.patientConfirmed).toBe(false);
});
