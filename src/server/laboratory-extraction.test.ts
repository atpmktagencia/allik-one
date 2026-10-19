import { afterEach, expect, it, vi } from "vitest";
import {
  extractLaboratoryPdf,
  laboratoryFailureCode,
  laboratoryExtractionConfiguration,
  laboratoryProviderStatus,
} from "./laboratory-extraction";
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
  expect(call.providerOptions).toEqual({ openai: { store: false } });
  expect(result.patientConfirmed).toBe(false);
  expect(result.rows[0]?.verified).toBe(false);
});
