import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";

// Official contract: https://docs.lacunasoftware.com/openapi/rest-pki-core.json
const ICP_BRASIL_CONTEXT = "201856ce-273c-4058-a872-8937bd547d36";
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type JsonObject = Record<string, unknown>;
export class LacunaSignatureError extends Error {
  constructor(
    public readonly code:
      "unavailable" | "provider_error" | "invalid_response" | "validation_failed",
    message: string,
  ) {
    super(message);
    this.name = "LacunaSignatureError";
  }
}
const fail = (code: LacunaSignatureError["code"] = "invalid_response"): never => {
  throw new LacunaSignatureError(
    code,
    code === "validation_failed"
      ? "Não foi possível validar a assinatura digital."
      : "O serviço de assinatura digital está indisponível. Tente novamente mais tarde.",
  );
};
function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as JsonObject;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value) return fail();
  return value;
}
function cpf(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return fail("validation_failed");
  for (let digit = 9; digit < 11; digit++) {
    const sum = [...digits.slice(0, digit)].reduce(
      (total, number, i) => total + Number(number) * (digit + 1 - i),
      0,
    );
    const check = (sum * 10) % 11;
    if (Number(digits[digit]) !== (check === 10 ? 0 : check)) return fail("validation_failed");
  }
  return digits;
}
function httpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail();
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443"))
    return fail();
  return url;
}
export function getLacunaSignatureConfiguration(): { configured: boolean; reason: string | null } {
  if (!process.env["LACUNA_REST_PKI_CORE_API_KEY"] || !process.env["SIGNATURE_PUBLIC_ORIGIN"])
    return { configured: false, reason: "A integração Lacuna ainda não foi configurada." };
  try {
    const endpoint = httpsUrl(process.env["LACUNA_REST_PKI_CORE_URL"] || "https://core.pki.rest/");
    const origin = httpsUrl(process.env["SIGNATURE_PUBLIC_ORIGIN"]);
    // Custom/on-premises hosts require a reviewed adapter; no arbitrary secret-bearing URLs.
    if (
      endpoint.hostname !== "core.pki.rest" ||
      endpoint.pathname !== "/" ||
      endpoint.search ||
      endpoint.hash ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      return {
        configured: false,
        reason: "A configuração da integração Lacuna precisa ser revisada.",
      };
    return { configured: true, reason: null };
  } catch {
    return {
      configured: false,
      reason: "A configuração da integração Lacuna precisa ser revisada.",
    };
  }
}
function configuration() {
  if (!getLacunaSignatureConfiguration().configured) return fail("unavailable");
  return {
    endpoint: process.env["LACUNA_REST_PKI_CORE_URL"] || "https://core.pki.rest/",
    apiKey: process.env["LACUNA_REST_PKI_CORE_API_KEY"]!,
    origin: httpsUrl(process.env["SIGNATURE_PUBLIC_ORIGIN"]!).origin,
  };
}
async function request(path: string, method = "GET", body?: unknown): Promise<JsonObject> {
  const config = configuration();
  try {
    const response = await fetch(new URL(path, config.endpoint), {
      method,
      headers: {
        "X-Api-Key": config.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return fail("provider_error");
    return object(await response.json());
  } catch (error) {
    if (error instanceof LacunaSignatureError) throw error;
    return fail("provider_error");
  }
}
function validPdf(bytes: Uint8Array): Buffer {
  const buffer = Buffer.from(bytes);
  if (
    !buffer.length ||
    buffer.length > MAX_PDF_BYTES ||
    buffer.subarray(0, 5).toString() !== "%PDF-"
  )
    return fail("validation_failed");
  return buffer;
}
async function download(fileValue: unknown): Promise<Buffer> {
  const file = object(fileValue);
  if (typeof file["content"] === "string") return validPdf(Buffer.from(file["content"], "base64"));
  const url = httpsUrl(string(file["url"]));
  // Only provider-generated download URLs, never forward API keys to blob storage.
  if (
    url.hostname !== "core.pki.rest" &&
    !/^[a-z0-9-]+\.blob\.core\.windows\.net$/.test(url.hostname)
  )
    return fail();
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok || Number(response.headers.get("content-length") || 0) > MAX_PDF_BYTES)
      return fail("provider_error");
    if (!response.body) return fail();
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_PDF_BYTES) {
        await reader.cancel();
        return fail();
      }
      chunks.push(Buffer.from(value));
    }
    return validPdf(Buffer.concat(chunks));
  } catch (error) {
    if (error instanceof LacunaSignatureError) throw error;
    return fail("provider_error");
  }
}
export async function createLacunaSignatureSession(input: {
  pdfBytes: Uint8Array;
  expectedSignerCpf: string;
  returnUrl: string;
  callbackArgument: string;
}): Promise<{ sessionId: string; redirectUrl: string }> {
  const config = configuration();
  const returnUrl = httpsUrl(input.returnUrl);
  if (
    returnUrl.origin !== config.origin ||
    !input.callbackArgument ||
    input.callbackArgument.length > 1024
  )
    return fail();
  const pdf = validPdf(input.pdfBytes);
  const response = await request("api/signature-sessions", "POST", {
    returnUrl: returnUrl.href,
    callbackArgument: input.callbackArgument,
    securityContextId: ICP_BRASIL_CONTEXT,
    certificateRequirements: [{ type: "Cpf", argument: cpf(input.expectedSignerCpf) }],
    disableDownloads: true,
    enableBackgroundProcessing: false,
    documents: [
      {
        file: {
          content: pdf.toString("base64"),
          name: "documento.pdf",
          mimeType: "application/pdf",
        },
        signatureType: "Pdf",
      },
    ],
  });
  const sessionId = string(response["sessionId"]);
  if (!UUID.test(sessionId)) return fail();
  const redirectUrl = httpsUrl(string(response["redirectUrl"]));
  if (redirectUrl.hostname !== "core.pki.rest") return fail();
  return { sessionId, redirectUrl: redirectUrl.href };
}
export type LacunaCompletion =
  | { status: "pending" | "cancelled" | "expired" }
  | {
      status: "completed";
      pdfBytes: Buffer;
      providerDocumentId: string;
      signedAt: string;
      certificate: {
        subjectName: string;
        issuerName: string;
        serialNumber: string;
        thumbprintSha256: string;
        validityStart: string;
        validityEnd: string;
      };
      validationEvidence: {
        securityContextId: string;
        trustAnchor: "PkiBrazil";
        validatedAt: string;
        certificateThumbprintSha256: string;
        originalSha256: string;
        signedSha256: string;
        passedChecks: string[];
      };
    };
export async function completeLacunaSignatureSession(input: {
  sessionId: string;
  expectedSignerCpf: string;
  expectedOriginalSha256: string;
  callbackArgument: string;
}): Promise<LacunaCompletion> {
  if (!UUID.test(input.sessionId) || !/^[a-f0-9]{64}$/i.test(input.expectedOriginalSha256))
    return fail();
  const expectedCpf = cpf(input.expectedSignerCpf);
  const session = await request(`api/signature-sessions/${input.sessionId}`);
  if (session["id"] !== input.sessionId || session["callbackArgument"] !== input.callbackArgument)
    return fail("validation_failed");
  if (session["status"] === "Pending" || session["status"] === "Processing")
    return { status: "pending" };
  if (session["status"] === "UserCancelled") return { status: "cancelled" };
  if (session["status"] === "Expired") return { status: "expired" };
  if (
    session["status"] !== "Completed" ||
    !Array.isArray(session["documents"]) ||
    session["documents"].length !== 1
  )
    return fail("validation_failed");
  const sessionCertificate = object(session["signerCertificate"]);
  if (cpf(string(object(sessionCertificate["pkiBrazil"])["cpf"])) !== expectedCpf)
    return fail("validation_failed");
  const document = object(session["documents"][0]);
  if (
    document["status"] !== "Completed" ||
    document["signatureType"] !== "Pdf" ||
    !UUID.test(string(document["id"]))
  )
    return fail("validation_failed");
  const originalBytes = await download(document["originalFile"]);
  const originalSha256 = createHash("sha256").update(originalBytes).digest("hex");
  if (originalSha256 !== input.expectedOriginalSha256.toLowerCase())
    return fail("validation_failed");
  const pdfBytes = await download(document["signedFile"]);
  const inspection = await request("api/signature-inspection", "PUT", {
    file: {
      content: pdfBytes.toString("base64"),
      name: "documento-assinado.pdf",
      mimeType: "application/pdf",
    },
    validate: true,
    securityContextId: ICP_BRASIL_CONTEXT,
    ignoreRevocationStatusUnknown: false,
    trustUncertifiedSigningTime: false,
  });
  // Inspection validates the exact submitted bytes. Its optional document metadata
  // is not a session-binding contract; the provider session and source hash above are.
  if (
    inspection["success"] !== true ||
    !Array.isArray(inspection["signers"]) ||
    inspection["signers"].length !== 1
  )
    return fail("validation_failed");
  const signer = object(inspection["signers"][0]);
  const cert = object(signer["certificate"]);
  const validation = object(signer["validationResults"]);
  if (
    signer["isDocumentTimestamp"] === true ||
    signer["standardTrustAnchor"] !== "PkiBrazil" ||
    cpf(string(object(cert["pkiBrazil"])["cpf"])) !== expectedCpf ||
    !Array.isArray(validation["errors"]) ||
    validation["errors"].length ||
    !Array.isArray(validation["warnings"]) ||
    validation["warnings"].length ||
    !Array.isArray(validation["passedChecks"]) ||
    !validation["passedChecks"].length
  )
    return fail("validation_failed");
  const thumbprint = string(cert["thumbprintSHA256"]).toLowerCase();
  if (
    !/^[a-f0-9]{64}$/.test(thumbprint) ||
    thumbprint !== string(sessionCertificate["thumbprintSHA256"]).toLowerCase()
  )
    return fail("validation_failed");
  const signedAt = string(document["dateSigned"]);
  if (!Number.isFinite(Date.parse(signedAt))) return fail();
  return {
    status: "completed",
    pdfBytes,
    providerDocumentId: string(document["id"]),
    signedAt,
    certificate: {
      subjectName: string(cert["subjectDisplayName"]),
      issuerName: string(cert["issuerDisplayName"]),
      serialNumber: string(cert["serialNumber"]),
      thumbprintSha256: thumbprint,
      validityStart: string(cert["validityStart"]),
      validityEnd: string(cert["validityEnd"]),
    },
    validationEvidence: {
      securityContextId: ICP_BRASIL_CONTEXT,
      trustAnchor: "PkiBrazil",
      validatedAt: new Date().toISOString(),
      certificateThumbprintSha256: thumbprint,
      originalSha256,
      signedSha256: createHash("sha256").update(pdfBytes).digest("hex"),
      passedChecks: validation["passedChecks"].map((item) => string(object(item)["type"])),
    },
  };
}
