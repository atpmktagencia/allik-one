import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { previewOperatorIdentity as demo } from "../lib/preview-operator-policy";
import { encounterDocumentsResponse } from "./encounter-documents";
import { patientDocumentsResponse, patientDocumentFileResponse } from "./patient-document-center";
import { authenticate } from "./auth";
const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock("../lib/preview-operator-policy", async (original) => ({
  ...(await original<typeof import("../lib/preview-operator-policy")>()),
  // The real deployment/branch/database predicate is covered independently in unit tests.
  fullPreviewOperatorEnabled: () => gate.enabled,
  sharedPreviewBoundaryEnabled: () => true,
}));
const storage = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => storage);
const origin = "http://localhost:4317";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw Error("Disposable database required");
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  gate.enabled = true;
});
afterAll(async () => {
  await getPool().end();
});
it("shared synthetic actor finalizes prescriptions and uploads/reads originals without a login, with auditable fictitious identity", async () => {
  vi.stubEnv("INVENTORY_ENVIRONMENT", "preview");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("INVENTORY_DISABLE_PREVIEW_LOGIN", "true");
  vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
  const db = getPool(),
    unit = randomUUID(),
    patient = randomUUID(),
    appointment = randomUUID();
  await db.query(
    "INSERT INTO inventory_organizations(id,name) VALUES($1,'Synthetic Preview') ON CONFLICT DO NOTHING",
    [demo.organizationId],
  );
  await db.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Synthetic test unit')",
    [unit, demo.organizationId],
  );
  await db.query(
    "INSERT INTO inventory_users(id,name,email,profession,professional_council,council_number,council_region,prescribing_address,prescribing_city,prescribing_state,prescribing_phone) VALUES($1,$2,$3,'Médico','CRM',$4,'CE','Endereço fictício','Fortaleza','CE','00000000000')",
    [demo.id, demo.name, demo.email, demo.councilNumber],
  );
  await db.query(
    "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'SUPER_ADMIN')",
    [demo.membershipId, demo.id, demo.organizationId],
  );
  await db.query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,$4,'Paciente fictício')",
    [patient, demo.organizationId, unit, `DEMO-${patient.slice(0, 8)}`],
  );
  await db.query(
    "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room,status) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour','Sala fictícia','IN_PROGRESS')",
    [appointment, demo.organizationId, unit, patient, demo.id],
  );
  const prescription = await encounterDocumentsResponse(
    new Request(`${origin}/api/v1/inventory/encounter-documents`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "FINALIZE",
        appointmentId: appointment,
        type: "PRESCRIPTION",
        title: "Receita fictícia de teste",
        content: "Somente teste, sem validade clínica.",
      }),
    }),
  );
  expect(prescription.status, await prescription.clone().text()).toBe(201);
  const document = (
    await db.query(
      "SELECT id,author_user_id,final_snapshot FROM inventory_encounter_documents WHERE appointment_id=$1",
      [appointment],
    )
  ).rows[0];
  expect(document.author_user_id).toBe(demo.id);
  expect(document.final_snapshot.authorName).toContain("TESTE SEM VALIDADE CLÍNICA");
  const printed = await encounterDocumentsResponse(
    new Request(
      `${origin}/api/v1/inventory/encounter-documents?documentId=${document.id}&print=true`,
    ),
  );
  expect(printed.status).toBe(200);
  expect(await printed.text()).toContain("TESTE SEM VALIDADE CLÍNICA");
  const id = randomUUID(),
    bytes = "%PDF-1.4 synthetic original";
  storage.put.mockImplementation(async (pathname: string) => ({ pathname }));
  const form = new FormData();
  form.set("id", id);
  form.set("patientId", patient);
  form.set("title", "Anexo fictício");
  form.set("categories", '["OTHER"]');
  form.set("file", new File([bytes], "test.pdf", { type: "application/pdf" }));
  expect(
    (
      await patientDocumentsResponse(
        new Request(`${origin}/api/v1/inventory/patient-documents`, {
          method: "POST",
          headers: { Origin: origin },
          body: form,
        }),
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await patientDocumentsResponse(
        new Request(`${origin}/api/v1/inventory/patient-documents?patientId=${patient}`),
      )
    ).status,
  ).toBe(200);
  storage.get.mockResolvedValue({ statusCode: 200, stream: new Blob([bytes]).stream() });
  const original = await patientDocumentFileResponse(
    new Request(
      `${origin}/api/v1/inventory/patient-document-file?patientId=${patient}&sourceKind=GENERAL_DOCUMENT&sourceId=${id}&download=true`,
    ),
  );
  expect(original.status).toBe(200);
  expect(await original.text()).toBe(bytes);
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM inventory_clinical_access_events WHERE patient_id=$1 AND actor_user_id=$2",
        [patient, demo.id],
      )
    ).rows[0].n,
  ).toBeGreaterThan(0);
  gate.enabled = false;
  expect(
    (
      await patientDocumentsResponse(
        new Request(`${origin}/api/v1/inventory/patient-documents?patientId=${patient}`),
      )
    ).status,
  ).toBe(403);
  expect((await authenticate(new Request(origin)))?.user.id).toBeNull();
});
