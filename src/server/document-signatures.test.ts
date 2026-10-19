import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import { documentSignaturesResponse } from "./document-signatures";
import { signatureHash } from "./signature-identity";
import {
  createLacunaSignatureSession,
  completeLacunaSignatureSession,
  getLacunaSignatureConfiguration,
  LacunaSignatureError,
} from "./lacuna-signature-provider";
vi.mock("./lacuna-signature-provider", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLacunaSignatureSession: vi.fn(),
  completeLacunaSignatureSession: vi.fn(),
  getLacunaSignatureConfiguration: vi.fn(),
}));
const origin = "https://allik-test.example";
const signed = Buffer.from("%PDF-1.7\nsynthetic signed document\n%%EOF");
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw new Error("Dedicated test database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  process.env["DOCUMENT_SIGNATURE_SECRET"] = "synthetic-test-key-only-32-characters-long";
  process.env["SIGNATURE_PUBLIC_ORIGIN"] = origin;
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await getPool().end();
});
beforeEach(() => {
  vi.mocked(getLacunaSignatureConfiguration).mockReturnValue({ configured: true, reason: null });
  vi.mocked(createLacunaSignatureSession)
    .mockReset()
    .mockImplementation(async () => ({
      sessionId: randomUUID(),
      redirectUrl: "https://core.pki.rest/synthetic-session",
    }));
  vi.mocked(completeLacunaSignatureSession)
    .mockReset()
    .mockImplementation(async (input) => ({
      status: "completed",
      pdfBytes: signed,
      providerDocumentId: randomUUID(),
      signedAt: "2026-10-14T12:00:00Z",
      certificate: {
        subjectName: "Synthetic physician",
        issuerName: "Synthetic CA",
        serialNumber: "123",
        thumbprintSha256: "a".repeat(64),
        validityStart: "2026-01-01",
        validityEnd: "2027-01-01",
      },
      validationEvidence: {
        securityContextId: "201856ce-273c-4058-a872-8937bd547d36",
        trustAnchor: "PkiBrazil",
        validatedAt: "2026-10-14T12:00:00Z",
        certificateThumbprintSha256: "a".repeat(64),
        originalSha256: input.expectedOriginalSha256,
        signedSha256: signatureHash(signed),
        passedChecks: ["CertificateSignature"],
      },
    }));
});
async function fixture() {
  const pool = getPool();
  const org = randomUUID(),
    unit = randomUUID(),
    otherUnit = randomUUID(),
    patient = randomUUID(),
    author = randomUUID(),
    admin = randomUUID(),
    otherAuthor = randomUUID(),
    restricted = randomUUID(),
    viewer = randomUUID(),
    appointment = randomUUID(),
    document = randomUUID();
  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Signature test ${org}`,
  ]);
  await pool.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Fortaleza'),($2,$3,'Juazeiro')",
    [unit, otherUnit, org],
  );
  const tokens = new Map<string, string>();
  for (const [id, role, scope] of [
    [author, "PARTNER_ADMIN", unit],
    [admin, "SUPER_ADMIN", unit],
    [otherAuthor, "PARTNER_ADMIN", unit],
    [restricted, "PARTNER_ADMIN", otherUnit],
    [viewer, "VIEWER", unit],
  ]) {
    const membership = randomUUID(),
      token = randomUUID();
    tokens.set(id!, token);
    await pool.query(
      "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Synthetic physician',$2,'CRM',$3,'CE')",
      [
        id,
        `${id}@example.test`,
        id === author ? "12345" : String(BigInt("0x" + id!.replaceAll("-", "").slice(0, 12))),
      ],
    );
    await pool.query(
      "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)",
      [membership, id, org, role],
    );
    await pool.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
      membership,
      scope,
    ]);
    await pool.query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [id, hashToken(token)],
    );
  }
  await pool.query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'SIG-001','Synthetic patient')",
    [patient, org, unit],
  );
  await pool.query(
    "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION','2031-02-12T10:00:00Z','2031-02-12T11:00:00Z','Test room')",
    [appointment, org, unit, patient, author],
  );
  const snapshot = {
    snapshotVersion: 1,
    patientName: "Synthetic patient",
    patientCode: "SIG-001",
    unitName: "Fortaleza",
    authorName: "Synthetic physician",
    professionalCouncil: "CRM",
    councilNumber: "12345",
    councilRegion: "CE",
    title: "RECEITA MÉDICA",
    type: "PRESCRIPTION",
    content: "Synthetic instructions",
    finalizedAt: "2026-10-14T12:00:00Z",
  };
  await pool.query(
    "INSERT INTO inventory_encounter_documents(id,organization_id,unit_id,appointment_id,patient_id,author_user_id,author_name,professional_council,council_number,council_region,type,title,content,status,finalized_at,final_snapshot) VALUES($1,$2,$3,$4,$5,$6,'Synthetic physician','CRM','12345','CE','PRESCRIPTION','RECEITA MÉDICA','Synthetic instructions','FINAL',$7,$8)",
    [document, org, unit, appointment, patient, author, snapshot.finalizedAt, snapshot],
  );
  const request = (
    user: string,
    action?: string,
    extra: Record<string, unknown> = {},
    query = "",
  ) =>
    documentSignaturesResponse(
      new Request(`${origin}/api/v1/inventory/document-signatures?documentId=${document}${query}`, {
        method: action ? "POST" : "GET",
        headers: {
          cookie: `allik_inventory_session=${tokens.get(user)}`,
          origin,
          "Content-Type": "application/json",
        },
        ...(action ? { body: JSON.stringify({ action, documentId: document, ...extra }) } : {}),
      }),
    );
  const register = () => request(admin, "REGISTER_IDENTITY", { cpf: "52998224725" });
  const start = (extra: Record<string, unknown> = {}) =>
    request(author, "START", { operationId: randomUUID(), ...extra });
  return {
    org,
    unit,
    author,
    admin,
    otherAuthor,
    restricted,
    viewer,
    document,
    request,
    register,
    start,
  };
}
describe("individual document signature authorization and lifecycle", () => {
  it("audits authorized source PDF reads and omits denied IDOR requests", async () => {
    const f = await fixture();
    expect((await f.request(f.restricted, undefined, {}, "&source=true")).status).toBe(404);
    expect((await f.request(f.author, undefined, {}, "&source=true")).status).toBe(200);
    const events = (
      await getPool().query(
        "SELECT actor_user_id,unit_id,document_id,action,resource_ids FROM inventory_clinical_access_events WHERE document_id=$1",
        [f.document],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor_user_id: f.author,
      unit_id: f.unit,
      document_id: f.document,
      action: "PDF_SOURCE",
      resource_ids: [],
    });
    await expect(
      getPool().query(
        "UPDATE inventory_clinical_access_events SET action='READ' WHERE document_id=$1",
        [f.document],
      ),
    ).rejects.toThrow();
    await expect(
      getPool().query("DELETE FROM inventory_clinical_access_events WHERE document_id=$1", [
        f.document,
      ]),
    ).rejects.toThrow();
  });
  it("requires identity and configured provider before external calls", async () => {
    const f = await fixture();
    expect((await f.start()).status).toBe(409);
    expect((await f.register()).status).toBe(200);
    vi.mocked(getLacunaSignatureConfiguration).mockReturnValue({
      configured: false,
      reason: "Not configured",
    });
    expect((await f.start()).status).toBe(503);
    expect(createLacunaSignatureSession).not.toHaveBeenCalled();
  });
  it("protects unit scope, author identity and identity administration", async () => {
    const f = await fixture();
    expect((await f.request(f.restricted)).status).toBe(404);
    expect((await f.request(f.otherAuthor, "START", { operationId: randomUUID() })).status).toBe(
      403,
    );
    expect((await f.request(f.author, "REGISTER_IDENTITY", { cpf: "52998224725" })).status).toBe(
      403,
    );
    expect((await f.request(f.viewer, "START", { operationId: randomUUID() })).status).toBe(403);
    expect(createLacunaSignatureSession).not.toHaveBeenCalled();
  });
  it("encrypts CPF and omits private signing fields from API/audit", async () => {
    const f = await fixture();
    await f.register();
    const identity = (
      await getPool().query("SELECT * FROM inventory_signing_identities WHERE user_id=$1", [
        f.author,
      ])
    ).rows[0];
    expect(JSON.stringify(identity)).not.toContain("52998224725");
    const state = await (await f.request(f.author)).text();
    expect(state).not.toContain("52998224725");
    expect(state).not.toContain("cpfEncrypted");
    const events = (
      await getPool().query(
        "SELECT data FROM inventory_document_signature_events WHERE document_id=$1",
        [f.document],
      )
    ).rows;
    expect(JSON.stringify(events)).not.toContain("52998224725");
  });
  it("starts once under retry and refuses simultaneous independent attempts", async () => {
    const f = await fixture();
    await f.register();
    const operationId = randomUUID();
    const first = await f.start({ operationId });
    expect(first.status).toBe(201);
    const id = (await first.json()).data.id;
    const retry = await f.start({ operationId });
    expect(retry.status).toBe(200);
    expect((await retry.json()).data.id).toBe(id);
    expect((await f.start()).status).toBe(409);
    expect(createLacunaSignatureSession).toHaveBeenCalledTimes(1);
  });
  it("stores and downloads exact validated signed bytes, with immutable audit and idempotent completion", async () => {
    const f = await fixture();
    await f.register();
    const start = await f.start();
    const attemptId = (await start.json()).data.id;
    const result = await f.request(f.author, "COMPLETE", { attemptId });
    expect(result.status).toBe(200);
    expect((await result.json()).data.status).toBe("SIGNED");
    const retry = await f.request(f.author, "COMPLETE", { attemptId });
    expect(retry.status).toBe(200);
    expect(completeLacunaSignatureSession).toHaveBeenCalledTimes(1);
    const download = await f.request(f.author, undefined, {}, "&download=true");
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await download.arrayBuffer()).equals(signed)).toBe(true);
    const row = (
      await getPool().query("SELECT * FROM inventory_document_signature_attempts WHERE id=$1", [
        attemptId,
      ])
    ).rows[0];
    expect(row.signed_sha256).toBe(signatureHash(signed));
    expect(row.validation_evidence.originalSha256).toBe(row.source_sha256);
    const events = (
      await getPool().query(
        "SELECT actor_user_id,action FROM inventory_document_signature_events WHERE attempt_id=$1",
        [attemptId],
      )
    ).rows;
    expect(events.some((e) => e.action === "SIGNED" && e.actor_user_id === f.author)).toBe(true);
    await expect(
      getPool().query(
        "UPDATE inventory_document_signature_attempts SET signed_pdf=$2 WHERE id=$1",
        [attemptId, Buffer.from("%PDF-tampered")],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      getPool().query("DELETE FROM inventory_document_signature_attempts WHERE id=$1", [attemptId]),
    ).rejects.toThrow(/immutable/);
    await expect(
      getPool().query(
        "UPDATE inventory_document_signature_events SET data='{}'::jsonb WHERE attempt_id=$1",
        [attemptId],
      ),
    ).rejects.toThrow();
    await expect(
      getPool().query("DELETE FROM inventory_document_signature_events WHERE attempt_id=$1", [
        attemptId,
      ]),
    ).rejects.toThrow();

    expect((await f.request(f.restricted, undefined, {}, "&download=true")).status).toBe(404);
    const accessEvents = (
      await getPool().query(
        "SELECT actor_user_id,action FROM inventory_clinical_access_events WHERE document_id=$1",
        [f.document],
      )
    ).rows;
    expect(accessEvents).toEqual([{ actor_user_id: f.author, action: "SIGNED_DOWNLOAD" }]);
  });
  it("rejects forged callbacks and cancellation by another author", async () => {
    const f = await fixture();
    await f.register();
    const attemptId = (await (await f.start()).json()).data.id;
    expect(
      (
        await f.request(f.author, "COMPLETE", {
          attemptId,
          state: "forged",
          signatureSessionId: randomUUID(),
        })
      ).status,
    ).toBe(400);
    expect((await f.request(f.otherAuthor, "CANCEL", { attemptId })).status).toBe(403);
    expect(completeLacunaSignatureSession).not.toHaveBeenCalled();
    expect((await f.request(f.author, "CANCEL", { attemptId })).status).toBe(200);
    expect((await f.request(f.author, "COMPLETE", { attemptId })).status).toBe(409);
  });
  it("never stores a signed artifact when provider validation fails", async () => {
    const f = await fixture();
    await f.register();
    const attemptId = (await (await f.start()).json()).data.id;
    vi.mocked(completeLacunaSignatureSession).mockRejectedValue(
      new LacunaSignatureError("validation_failed", "Invalid signature"),
    );
    expect((await f.request(f.author, "COMPLETE", { attemptId })).status).toBe(422);
    const row = (
      await getPool().query(
        "SELECT status,signed_pdf FROM inventory_document_signature_attempts WHERE id=$1",
        [attemptId],
      )
    ).rows[0];
    expect(row.status).not.toBe("SIGNED");
    expect(row.signed_pdf).toBeNull();
  });
  it.each([
    ["pending", "AWAITING_SIGNATURE"],
    ["cancelled", "CANCELED"],
    ["expired", "EXPIRED"],
  ] as const)("keeps provider %s unsigned", async (status, storedStatus) => {
    const f = await fixture();
    await f.register();
    const attemptId = (await (await f.start()).json()).data.id;
    vi.mocked(completeLacunaSignatureSession).mockResolvedValue({ status });
    const response = await f.request(f.author, "COMPLETE", { attemptId });
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe(storedStatus);
    const row = (
      await getPool().query(
        "SELECT status,signed_pdf FROM inventory_document_signature_attempts WHERE id=$1",
        [attemptId],
      )
    ).rows[0];
    expect(row.status).toBe(storedStatus);
    expect(row.signed_pdf).toBeNull();
  });
  it("records failed provider startup without making a signed artifact", async () => {
    const f = await fixture();
    await f.register();
    vi.mocked(createLacunaSignatureSession).mockRejectedValue(
      new LacunaSignatureError("provider_error", "Unavailable"),
    );
    expect((await f.start()).status).toBe(503);
    const row = (
      await getPool().query(
        "SELECT status,signed_pdf FROM inventory_document_signature_attempts WHERE document_id=$1",
        [f.document],
      )
    ).rows[0];
    expect(row.status).toBe("FAILED");
    expect(row.signed_pdf).toBeNull();
  });
  it("cancels pending attempts when identity is reverified", async () => {
    const f = await fixture();
    await f.register();
    const attemptId = (await (await f.start()).json()).data.id;
    await f.register();
    expect((await f.request(f.author, "COMPLETE", { attemptId })).status).toBe(409);
    expect(completeLacunaSignatureSession).not.toHaveBeenCalled();
  });
});

describe("signature current patient scope after transfer", () => {
  it("refuses source and signature metadata outside the patient's current unit", async () => {
    const f = await fixture();
    const unit = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Transferred synthetic unit')",
      [unit, f.org],
    );
    await getPool().query(
      "UPDATE inventory_patients SET primary_unit_id=$1 WHERE id=(SELECT patient_id FROM inventory_encounter_documents WHERE id=$2)",
      [unit, f.document],
    );
    expect((await f.request(f.author)).status).toBe(404);
    expect((await f.request(f.author, undefined, {}, "&source=true")).status).toBe(404);
    expect((await f.start()).status).toBe(404);
    expect(createLacunaSignatureSession).not.toHaveBeenCalled();
  });
});
