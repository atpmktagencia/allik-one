import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-start/server-only", () => ({}));
import {
  completeLacunaSignatureSession,
  createLacunaSignatureSession,
  getLacunaSignatureConfiguration,
} from "../server/lacuna-signature-provider";

const sessionId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const original = Buffer.from("%PDF-1.7\noriginal immutable document\n%%EOF");
const signed = Buffer.from("%PDF-1.7\nsigned immutable document\n%%EOF");
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const cpf = "52998224725";
const cert = {
  pkiBrazil: { cpf },
  thumbprintSHA256: "a".repeat(64),
  subjectDisplayName: "Synthetic physician",
  issuerDisplayName: "Synthetic test CA",
  serialNumber: "123",
  validityStart: "2026-01-01T00:00:00Z",
  validityEnd: "2027-01-01T00:00:00Z",
};
const input = {
  sessionId,
  expectedSignerCpf: cpf,
  expectedOriginalSha256: sha256(original),
  callbackArgument: "single-use-opaque-callback",
};
function completed() {
  return {
    id: sessionId,
    callbackArgument: input.callbackArgument,
    status: "Completed",
    signerCertificate: cert,
    documents: [
      {
        id: documentId,
        status: "Completed",
        signatureType: "Pdf",
        dateSigned: "2026-10-14T12:00:00Z",
        originalFile: { content: original.toString("base64") },
        signedFile: { content: signed.toString("base64") },
      },
    ],
  };
}
function inspection() {
  return {
    success: true,
    document: { id: documentId },
    signers: [
      {
        certificate: cert,
        standardTrustAnchor: "PkiBrazil",
        validationResults: {
          errors: [],
          warnings: [],
          passedChecks: [{ type: "CertificateSignature" }],
        },
      },
    ],
  };
}
function responses(...values: unknown[]) {
  const fetchMock = vi.fn();
  for (const value of values)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
beforeEach(() => {
  vi.stubEnv("LACUNA_REST_PKI_CORE_API_KEY", "test-key-never-a-real-secret");
  vi.stubEnv("SIGNATURE_PUBLIC_ORIGIN", "https://allik.example.test");
  vi.stubEnv("LACUNA_REST_PKI_CORE_URL", "https://core.pki.rest/");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Lacuna fail-closed signature boundary", () => {
  it("does not contact the provider when integration is unavailable", async () => {
    vi.stubEnv("LACUNA_REST_PKI_CORE_API_KEY", "");
    const fetchMock = responses();
    expect(getLacunaSignatureConfiguration().configured).toBe(false);
    await expect(
      createLacunaSignatureSession({
        pdfBytes: original,
        expectedSignerCpf: cpf,
        returnUrl: "https://allik.example.test/return",
        callbackArgument: "opaque",
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["https://evil.example/", "http://core.pki.rest/", "https://core.pki.rest/?key=foo"])(
    "refuses unreviewed credential-bearing endpoint %s",
    (endpoint) => {
      vi.stubEnv("LACUNA_REST_PKI_CORE_URL", endpoint);
      expect(getLacunaSignatureConfiguration().configured).toBe(false);
    },
  );
  it("requires a valid CPF and same-origin return without disclosing secrets", async () => {
    const fetchMock = responses();
    for (const override of [
      { expectedSignerCpf: "11111111111" },
      { returnUrl: "https://evil.example/return" },
    ]) {
      await expect(
        createLacunaSignatureSession({
          pdfBytes: original,
          expectedSignerCpf: cpf,
          returnUrl: "https://allik.example.test/return",
          callbackArgument: "opaque",
          ...override,
        }),
      ).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("creates an ICP-Brasil restricted PDF session and refuses redirects", async () => {
    const fetchMock = responses({
      sessionId,
      redirectUrl: "https://core.pki.rest/session/example",
    });
    expect(
      await createLacunaSignatureSession({
        pdfBytes: original,
        expectedSignerCpf: cpf,
        returnUrl: "https://allik.example.test/return",
        callbackArgument: "opaque",
      }),
    ).toEqual({ sessionId, redirectUrl: "https://core.pki.rest/session/example" });
    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(options.redirect).toBe("error");
    const payload = JSON.parse(String(options.body));
    expect(payload.certificateRequirements).toEqual([{ type: "Cpf", argument: cpf }]);
    expect(payload.documents[0].file.content).toBe(original.toString("base64"));
  });
  it("rejects malformed or attacker-controlled authorization responses", async () => {
    for (const response of [{}, { sessionId, redirectUrl: "https://evil.example/steal" }]) {
      responses(response);
      await expect(
        createLacunaSignatureSession({
          pdfBytes: original,
          expectedSignerCpf: cpf,
          returnUrl: "https://allik.example.test/return",
          callbackArgument: "opaque",
        }),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });
  it.each([
    ["Pending", "pending"],
    ["Processing", "pending"],
    ["UserCancelled", "cancelled"],
    ["Expired", "expired"],
  ])("does not label %s as signed", async (providerStatus, status) => {
    const fetchMock = responses({
      id: sessionId,
      callbackArgument: input.callbackArgument,
      status: providerStatus,
    });
    expect(await completeLacunaSignatureSession(input)).toEqual({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects callback correlation mismatch", async () => {
    responses({ ...completed(), callbackArgument: "another-attempt" });
    await expect(completeLacunaSignatureSession(input)).rejects.toMatchObject({
      code: "validation_failed",
    });
  });
  it("rejects an original PDF changed after finalization", async () => {
    const session = completed();
    session.documents[0]!.originalFile.content = signed.toString("base64");
    const fetchMock = responses(session);
    await expect(completeLacunaSignatureSession(input)).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not fetch arbitrary signed document URLs", async () => {
    const session = completed();
    Object.assign(session.documents[0]!, {
      signedFile: { url: "https://evil.example/private.pdf" },
    });
    const fetchMock = responses(session);
    await expect(completeLacunaSignatureSession(input)).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["error", "warning", "untrusted", "otherCpf", "mismatchedThumbprint", "unsuccessful"])(
    "rejects certificate/inspection failure: %s",
    async (failure) => {
      const checked = inspection();
      const signer = checked.signers[0]!;
      if (failure === "error") signer.validationResults.errors = [{ type: "Revoked" }] as never[];
      if (failure === "warning")
        signer.validationResults.warnings = [{ type: "RevocationUnknown" }] as never[];
      if (failure === "untrusted") signer.standardTrustAnchor = "Custom";
      if (failure === "otherCpf")
        signer.certificate = { ...cert, pkiBrazil: { cpf: "11144477735" } };
      if (failure === "mismatchedThumbprint")
        signer.certificate = { ...cert, thumbprintSHA256: "b".repeat(64) };
      if (failure === "unsuccessful") checked.success = false;
      responses(completed(), checked);
      await expect(completeLacunaSignatureSession(input)).rejects.toMatchObject({
        code: "validation_failed",
      });
    },
  );
  it.each(["absent", "different"])(
    "accepts validated bytes when optional inspection metadata is %s",
    async (metadata) => {
      const checked = inspection();
      if (metadata === "absent") Reflect.deleteProperty(checked, "document");
      else checked.document.id = sessionId;
      responses(completed(), checked);
      const result = await completeLacunaSignatureSession(input);
      expect(result.status).toBe("completed");
      if (result.status !== "completed") throw new Error("Expected validated completion");
      expect(result.pdfBytes.equals(signed)).toBe(true);
      expect(result.validationEvidence.originalSha256).toBe(sha256(original));
      expect(result.validationEvidence.signedSha256).toBe(sha256(signed));
    },
  );
  it("retains exact signed bytes and verifiable hashes only after inspection", async () => {
    const fetchMock = responses(completed(), inspection());
    const result = await completeLacunaSignatureSession(input);
    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("Expected completion");
    expect(result.pdfBytes.equals(signed)).toBe(true);
    expect(result.validationEvidence).toMatchObject({
      originalSha256: sha256(original),
      signedSha256: sha256(signed),
      trustAnchor: "PkiBrazil",
      certificateThumbprintSha256: cert.thumbprintSHA256,
    });
    const inspectionRequest = JSON.parse(String(fetchMock.mock.calls[1]![1].body));
    expect(inspectionRequest).toMatchObject({
      validate: true,
      ignoreRevocationStatusUnknown: false,
      trustUncertifiedSigningTime: false,
    });
  });
});

it("disables certified signing explicitly when manuscript mode is selected", async () => {
  vi.stubEnv("CLINICAL_SIGNATURE_MODE", "MANUSCRIPT");
  const outgoing = vi.fn();
  vi.stubGlobal("fetch", outgoing);
  expect(getLacunaSignatureConfiguration()).toMatchObject({ configured: false });
  expect(getLacunaSignatureConfiguration().reason).toContain("Assinatura manuscrita");
  await expect(
    createLacunaSignatureSession({
      pdfBytes: original,
      expectedSignerCpf: cpf,
      returnUrl: "https://allik.example.test/return",
      callbackArgument: "opaque",
    }),
  ).rejects.toMatchObject({ code: "unavailable" });
  expect(outgoing).not.toHaveBeenCalled();
});
