import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { get as getBlob } from "@vercel/blob";
import { getDb, getPool } from "./db";
import {
  authenticate,
  can,
  hasPreviewSession,
  hashPassword,
  hashToken,
  previewLogin,
  sessionResponse,
} from "./auth";
import { inventoryResponse } from "./inventory";
import { receivingResponse } from "./receiving";
import { purchasingResponse } from "./purchases";
import { stockOperationResponse } from "./stock-operations";
import { applicationResponse } from "./applications";
import { lotTraceResponse } from "./lot-trace";
import { writeOffResponse } from "./write-offs";
import { activationResponse, userAdminResponse } from "./user-admin";
import { integrationCredentialResponse } from "./integration-credentials";
import { pricingResponse } from "./pricing";
import { patientsResponse } from "./patients";
import { patientDetailResponse, prescriptionDownloadResponse } from "./patient-treatments";
import { patientDemandResponse } from "./patient-demand";
import { patientApplicationResponse } from "./patient-applications";
import { openPresentationResponse } from "./open-presentations";
import { patientScheduleResponse } from "./patient-schedule";
import { patientPurchaseNeedsResponse } from "./patient-purchase-needs";
import { careAppointmentsResponse } from "./care-appointments";
import { careSettingsResponse } from "./care-settings";
import { careEncounterResponse } from "./care-encounter";
import { clinicalProblemsResponse } from "./clinical-problems";
import { clinicalAlertsResponse } from "./clinical-alerts";
import { encounterPrescriptionsResponse } from "./encounter-prescriptions";
import { encounterQuotesResponse } from "./encounter-quotes";
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string) => ({ pathname })),
  del: vi.fn(async () => undefined),
  get: vi.fn(async () => null),
}));
const origin = "http://localhost:4317";
let cookie = "";
beforeAll(async () => {
  const url = new URL(process.env["DATABASE_URL"] ?? "postgres://invalid");
  if (!url.pathname.endsWith("_test"))
    throw new Error("Integration tests require a dedicated *_test database.");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  process.env["INVENTORY_PREVIEW_PASSWORD"] = "synthetic-test-password";
  process.env["INVENTORY_SESSION_SECRET"] = "synthetic-test-session-secret-32-characters";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  const response = await previewLogin(
    new Request(`${origin}/api/inventory-session`, {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "synthetic-test-password" }),
    }),
  );
  cookie = response.headers.get("set-cookie")!.split(";")[0]!;
});
afterAll(async () => {
  await getPool().end();
});
async function fixture(quantity = "10", days = 90) {
  const product = await getPool().query(
    `INSERT INTO inventory_products(organization_id,name,sku,category,unit) VALUES('a1100000-0000-4000-8000-000000000001','Produto de teste',$1,'Material','un') RETURNING id`,
    [randomUUID()],
  );
  const location = await getPool().query(
    "INSERT INTO inventory_locations(unit_id,name) VALUES('a1100000-0000-4000-8000-000000000102',$1) RETURNING id",
    [`Local ${randomUUID()}`],
  );
  const lot = await getPool().query(
    `INSERT INTO inventory_lots(product_id,number,expires_on,supplier,unit_cost) VALUES($1,$2,(NOW() AT TIME ZONE 'America/Fortaleza')::date + $3::integer,'Fornecedor sintético',2) RETURNING id`,
    [product.rows[0].id, randomUUID(), days],
  );
  const params = [lot.rows[0].id, location.rows[0].id];
  await movement(params, quantity, "IN");
  return { productId: product.rows[0].id as string, params };
}
function movement(params: unknown[], delta: string, type = "OUT") {
  return getPool().query(
    `INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,reference,reason,operation_key) VALUES($1,$2,$3,$4,'test-operator','TEST','Teste sintético',$5) RETURNING id`,
    [...params, type, delta, randomUUID()],
  );
}
const request = (resource: string) =>
  new Request(`${origin}/api/v1/inventory/${resource}`, { headers: { cookie } });
const receivingRequest = (body: unknown) =>
  new Request(`${origin}/api/v1/inventory/receipts`, {
    method: "POST",
    headers: { cookie, origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function scopedCookie(unitId: string, role = "VIEWER") {
  const token = randomUUID();
  const user = await getPool().query<{ id: string }>(
    "INSERT INTO inventory_users(name,email) VALUES($1,$2) RETURNING id",
    ["Usuário de escopo", `${randomUUID()}@example.test`],
  );
  const membership = await getPool().query<{ id: string }>(
    "INSERT INTO inventory_memberships(user_id,organization_id,role) VALUES($1,'a1100000-0000-4000-8000-000000000001',$2) RETURNING id",
    [user.rows[0]!.id, role],
  );
  await getPool().query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
    membership.rows[0]!.id,
    unitId,
  ]);
  await getPool().query(
    "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
    [user.rows[0]!.id, hashToken(token)],
  );
  return `allik_inventory_session=${token}`;
}

describe("revocable integration credentials", () => {
  it("creates a scoped secret, audits its use and revokes it immediately", async () => {
    const adminCookie = await scopedCookie("a1100000-0000-4000-8000-000000000101", "SUPER_ADMIN");
    const createResponse = await integrationCredentialResponse(
      new Request(`${origin}/api/v1/inventory/integration-credentials`, {
        method: "POST",
        headers: { cookie: adminCookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE",
          name: "Codex de teste",
          expiresInDays: 30,
          permissions: ["inventory.read", "inventory.catalog.manage"],
        }),
      }),
    );
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()).data as { id: string; token: string };
    expect(created.token).toMatch(/^allik_[A-Za-z0-9_-]{43}$/);

    const stored = await getPool().query(
      "SELECT token_hash,permissions FROM inventory_api_credentials WHERE id=$1",
      [created.id],
    );
    expect(stored.rows[0].token_hash).toBe(hashToken(created.token));
    expect(stored.rows[0].token_hash).not.toContain(created.token);

    const apiRequest = new Request(`${origin}/api/v1/inventory/catalog/products`, {
      headers: { authorization: `Bearer ${created.token}` },
    });
    const integration = await authenticate(apiRequest);
    expect(integration?.user.name).toBe("Integração: Codex de teste");
    expect(integration && can(integration, "inventory.catalog.manage")).toBe(true);
    expect(integration && can(integration, "inventory.adjust")).toBe(false);
    expect(integration && can(integration, "users.manage")).toBe(false);
    const uses = await getPool().query(
      "SELECT details FROM inventory_api_credential_events WHERE credential_id=$1 AND action='USE'",
      [created.id],
    );
    expect(uses.rows).toEqual([
      { details: { method: "GET", path: "/api/v1/inventory/catalog/products" } },
    ]);

    const revokeResponse = await integrationCredentialResponse(
      new Request(`${origin}/api/v1/inventory/integration-credentials`, {
        method: "POST",
        headers: { cookie: adminCookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVOKE", credentialId: created.id }),
      }),
    );
    expect(revokeResponse.status).toBe(200);
    await expect(authenticate(apiRequest)).resolves.toBeNull();
  });

  it("does not allow preview or integration identities to manage credentials", async () => {
    const response = await integrationCredentialResponse(
      new Request(`${origin}/api/v1/inventory/integration-credentials`, {
        headers: { cookie },
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe("fractional presentation and dose pricing", () => {
  it("persists audited Tirzepatide pricing and returns exact safety calculations", async () => {
    const presentationId = randomUUID();
    const presentationResponse = await pricingResponse(
      new Request(`${origin}/api/v1/inventory/pricing`, {
        method: "POST",
        headers: { cookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_PRESENTATION",
          id: presentationId,
          productId: null,
          name: `Tirzepatida teste ${presentationId}`,
          baseUnit: "MG",
          totalBaseQuantity: "20",
          totalVolumeMl: "0.8",
          acquisitionCost: "591.40",
          technicalLossPercent: "0",
          additionalPresentationCost: "0",
          minimumMeasurableVolumeMl: "0.01",
          beyondUseHours: 24,
          active: true,
          version: 0,
          reason: "Validação integrada da apresentação.",
        }),
      }),
    );
    expect(presentationResponse.status).toBe(201);
    const doseId = randomUUID();
    const doseResponse = await pricingResponse(
      new Request(`${origin}/api/v1/inventory/pricing`, {
        method: "POST",
        headers: { cookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_DOSE",
          id: doseId,
          presentationId,
          name: "Dose 2,4 mg",
          doseQuantity: "2.4",
          salePrice: "250",
          materialCost: "0",
          active: true,
          version: 0,
          reason: "Validação integrada da dose comercial.",
        }),
      }),
    );
    expect(doseResponse.status).toBe(201);
    const incompleteValidation = await pricingResponse(
      new Request(`${origin}/api/v1/inventory/pricing`, {
        method: "POST",
        headers: { cookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE_PRESENTATION",
          id: presentationId,
          productId: null,
          name: `Tirzepatida teste ${presentationId}`,
          baseUnit: "MG",
          totalBaseQuantity: "20",
          totalVolumeMl: "0.8",
          acquisitionCost: "591.40",
          technicalLossPercent: "0",
          additionalPresentationCost: "0",
          minimumMeasurableVolumeMl: null,
          beyondUseHours: null,
          pricingStatus: "VALIDATED",
          costSource: "Cotação de teste",
          costValidOn: "2026-10-11",
          assumptionsNotes: "Premissas de teste ainda incompletas.",
          assumptionsConfirmed: false,
          active: true,
          version: 0,
          reason: "Tentativa incompleta de validar a apresentação.",
        }),
      }),
    );
    expect(incompleteValidation.status).toBe(400);
    const validationResponse = await pricingResponse(
      new Request(`${origin}/api/v1/inventory/pricing`, {
        method: "POST",
        headers: { cookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE_PRESENTATION",
          id: presentationId,
          productId: null,
          name: `Tirzepatida teste ${presentationId}`,
          baseUnit: "MG",
          totalBaseQuantity: "20",
          totalVolumeMl: "0.8",
          acquisitionCost: "591.40",
          technicalLossPercent: "0",
          additionalPresentationCost: "0",
          minimumMeasurableVolumeMl: "0.001",
          beyondUseHours: 24,
          pricingStatus: "VALIDATED",
          costSource: "Cotação de teste",
          costValidOn: "2026-10-11",
          assumptionsNotes: "Premissas operacionais conferidas no teste.",
          assumptionsConfirmed: true,
          active: true,
          version: 0,
          reason: "Validação completa da apresentação no teste.",
        }),
      }),
    );
    expect(validationResponse.status).toBe(200);
    const response = await pricingResponse(
      new Request(`${origin}/api/v1/inventory/pricing`, { headers: { cookie } }),
    );
    const payload = (await response.json()).data;
    const created = payload.presentations.find(
      (presentation: { id: string }) => presentation.id === presentationId,
    );
    expect(created).toMatchObject({
      concentrationPerMl: "25",
      beyondUseHours: 24,
      pricingStatus: "VALIDATED",
      costSource: "Cotação de teste",
      validatedByActor: "preview-operator",
    });
    expect(created.doses[0]).toMatchObject({
      id: doseId,
      calculation: { doseVolumeMl: "0.096", measurable: true, dosesPerPresentation: 8 },
    });
    const changes = await getPool().query(
      "SELECT action FROM inventory_pricing_changes WHERE presentation_id=$1 ORDER BY created_at",
      [presentationId],
    );
    expect(changes.rows.map((row) => row.action)).toEqual([
      "CREATE_PRESENTATION",
      "CREATE_DOSE",
      "UPDATE_PRESENTATION",
    ]);
    await expect(
      getPool().query(
        "UPDATE inventory_pricing_changes SET reason='alteração proibida' WHERE presentation_id=$1",
        [presentationId],
      ),
    ).rejects.toThrow();
  });

  it("keeps write access server-side", async () => {
    const viewerCookie = await scopedCookie("a1100000-0000-4000-8000-000000000101", "VIEWER");
    const response = await pricingResponse(
      new Request(`${origin}/api/v1/inventory/pricing`, {
        method: "POST",
        headers: { cookie: viewerCookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe("operational patients", () => {
  it("creates an audited patient and enforces unit scope on reads and writes", async () => {
    const fortaleza = "a1100000-0000-4000-8000-000000000101";
    const juazeiro = "a1100000-0000-4000-8000-000000000102";
    const managerCookie = await scopedCookie(fortaleza, "UNIT_MANAGER");
    const patientId = randomUUID();
    const body = {
      action: "CREATE",
      id: patientId,
      primaryUnitId: fortaleza,
      internalCode: `PAC-${patientId.slice(0, 8)}`,
      fullName: "Paciente Operacional Sintético",
      phone: "85999990000",
      email: "paciente@example.test",
      active: true,
      consentStatus: "PENDING",
      version: 0,
      reason: "Cadastro sintético para validar o escopo por unidade.",
    };
    const created = await patientsResponse(
      new Request(`${origin}/api/v1/inventory/patients`, {
        method: "POST",
        headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(created.status).toBe(201);

    const list = await patientsResponse(
      new Request(`${origin}/api/v1/inventory/patients?unitId=${fortaleza}`, {
        headers: { cookie: managerCookie },
      }),
    );
    expect((await list.json()).data).toEqual(
      expect.objectContaining({
        patients: [
          expect.objectContaining({
            id: patientId,
            primaryUnitId: fortaleza,
            internalCode: expect.stringMatching(/^PAC-\d{6}$/),
          }),
        ],
        units: [expect.objectContaining({ id: fortaleza })],
        canManage: true,
      }),
    );
    const searched = await patientsResponse(
      new Request(`${origin}/api/v1/inventory/patients?search=999990000`, {
        headers: { cookie: managerCookie },
      }),
    );
    expect(searched.status).toBe(200);
    expect((await searched.json()).data.patients).toEqual([
      expect.objectContaining({ id: patientId, fullName: "Paciente Operacional Sintético" }),
    ]);
    const treatmentProductId = randomUUID();
    await getPool().query(
      `INSERT INTO inventory_products(id,organization_id,name,sku,category,unit,minimum)
       SELECT $1,organization_id,'Produto Tratamento Sintético',$2,'Teste','UN',0
       FROM inventory_patients WHERE id=$3`,
      [treatmentProductId, `TRAT-${patientId.slice(0, 8)}`, patientId],
    );
    await getPool().query(
      `INSERT INTO inventory_pricing_presentations(
        organization_id,product_id,name,base_unit,total_base_quantity,acquisition_cost,technical_loss_percent
       ) VALUES('a1100000-0000-4000-8000-000000000001',$1,$2,'MG',20,100,0)`,
      [treatmentProductId, `Apresentação tratamento ${patientId}`],
    );
    const treatmentLocation = await getPool().query<{ id: string }>(
      "INSERT INTO inventory_locations(unit_id,name) VALUES($1,$2) RETURNING id",
      [fortaleza, `Local tratamento ${patientId}`],
    );
    const treatmentLot = await getPool().query<{ id: string }>(
      `INSERT INTO inventory_lots(product_id,number,expires_on,supplier,unit_cost)
       VALUES($1,$2,'2099-12-31','Fornecedor sintético',100) RETURNING id`,
      [treatmentProductId, `TRAT-LOTE-${patientId.slice(0, 8)}`],
    );
    await movement([treatmentLot.rows[0]!.id, treatmentLocation.rows[0]!.id], "1", "IN");
    const treatmentId = randomUUID();
    const treatment = await patientDetailResponse(
      new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        method: "POST",
        headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_TREATMENT",
          id: treatmentId,
          patientId,
          productId: treatmentProductId,
          doseQuantity: 2.5,
          doseUnit: "MG",
          route: "SC",
          frequencyEveryDays: 7,
          firstScheduledOn: "2099-01-10",
          plannedAdministrations: 8,
          status: "PLANNED",
          version: 0,
          reason: "Tratamento sintético para validar frequência e auditoria.",
        }),
      }),
    );
    expect(treatment.status).toBe(201);

    const detail = await patientDetailResponse(
      new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        headers: { cookie: managerCookie },
      }),
    );
    const detailBody = (await detail.json()).data;
    expect(detailBody.treatments).toEqual([
      expect.objectContaining({ id: treatmentId, frequencyEveryDays: "7.00" }),
    ]);
    expect(detailBody.schedule).toHaveLength(8);
    expect(detailBody.schedule[1]).toEqual(
      expect.objectContaining({ sequence: 2, scheduledOn: "2099-01-17", status: "PLANNED" }),
    );
    const movementCount = await getPool().query(
      "SELECT count(*)::integer AS count FROM inventory_movements",
    );
    const purchaseId = randomUUID();
    expect(
      (
        await patientDetailResponse(
          new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patientId}`, {
            method: "POST",
            headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "CREATE_PURCHASE",
              id: purchaseId,
              patientId,
              treatmentId,
              purchasedQuantity: 2.5,
              totalValue: 250,
              reference: "VENDA-TESTE-001",
              purchasedOn: "2099-01-01",
              reason: "Compra sintética para validar cobertura do tratamento.",
            }),
          }),
        )
      ).status,
    ).toBe(201);
    const firstSchedule = detailBody.schedule[0];
    const secondScheduleForReservation = detailBody.schedule[1];
    const reserve = (schedule: { id: string; version: number }) =>
      patientDetailResponse(
        new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patientId}`, {
          method: "POST",
          headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "UPDATE_SCHEDULE_STATUS",
            patientId,
            scheduleId: schedule.id,
            status: "RESERVED",
            version: schedule.version,
            reason: "Reserva sintética concorrente limitada pela quantidade comprada.",
          }),
        }),
      );
    const concurrentReservations = await Promise.all([
      reserve(firstSchedule),
      reserve(secondScheduleForReservation),
    ]);
    expect(concurrentReservations.map((response) => response.status).sort()).toEqual([200, 409]);
    const reservedScheduleId =
      concurrentReservations[0]!.status === 200
        ? firstSchedule.id
        : secondScheduleForReservation.id;
    const movementCountAfter = await getPool().query(
      "SELECT count(*)::integer AS count FROM inventory_movements",
    );
    expect(movementCountAfter.rows[0].count).toBe(movementCount.rows[0].count);
    const supply = await patientDetailResponse(
      new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        headers: { cookie: managerCookie },
      }),
    );
    expect((await supply.json()).data).toEqual(
      expect.objectContaining({
        purchases: [expect.objectContaining({ id: purchaseId, purchasedQuantity: "2.500000" })],
        schedule: expect.arrayContaining([
          expect.objectContaining({ id: reservedScheduleId, status: "RESERVED" }),
        ]),
        supplySummaries: [
          expect.objectContaining({
            treatmentId,
            purchasedQuantity: 2.5,
            reservedQuantity: 2.5,
            consumedQuantity: 0,
            purchasedAvailableToReserve: 0,
            physicalUnreservedDose: 17.5,
          }),
        ],
      }),
    );
    const prescription = new FormData();
    prescription.set("treatmentId", treatmentId);
    prescription.set("prescriberName", "Dra. Prescritora Sintética");
    prescription.set("councilNumber", "CRM 12345");
    prescription.set("councilRegion", "CE");
    prescription.set("issuedOn", new Date().toISOString().slice(0, 10));
    prescription.set("validUntil", "2099-12-31");
    prescription.set("supersedesId", "");
    prescription.set("reason", "Prescrição sintética para validar armazenamento privado.");
    prescription.set(
      "file",
      new File(["%PDF-1.4 synthetic"], "prescricao-teste.pdf", { type: "application/pdf" }),
    );
    const uploaded = await patientDetailResponse(
      new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        method: "POST",
        headers: { cookie: managerCookie, origin },
        body: prescription,
      }),
    );
    expect(uploaded.status).toBe(201);
    const uploadedId = (await uploaded.json()).data.id as string;
    const replacement = new FormData();
    replacement.set("treatmentId", treatmentId);
    replacement.set("prescriberName", "Dra. Prescritora Sintética");
    replacement.set("councilNumber", "CRM 12345");
    replacement.set("councilRegion", "CE");
    replacement.set("issuedOn", new Date().toISOString().slice(0, 10));
    replacement.set("validUntil", "2099-12-31");
    replacement.set("supersedesId", uploadedId);
    replacement.set("reason", "Nova versão conferida para substituir a prescrição anterior.");
    replacement.set(
      "file",
      new File(["%PDF-1.4 synthetic replacement"], "prescricao-atualizada.pdf", {
        type: "application/pdf",
      }),
    );
    const replaced = await patientDetailResponse(
      new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        method: "POST",
        headers: { cookie: managerCookie, origin },
        body: replacement,
      }),
    );
    expect(replaced.status).toBe(201);
    const storedPrescription = await getPool().query(
      `SELECT blob_pathname,original_filename,prescriber_name,document_status,version,
        supersedes_id AS "supersedesId" FROM inventory_patient_prescriptions
       WHERE patient_id=$1 ORDER BY version`,
      [patientId],
    );
    expect(storedPrescription.rows).toEqual([
      expect.objectContaining({
        original_filename: "prescricao-teste.pdf",
        prescriber_name: "Dra. Prescritora Sintética",
        document_status: "SUPERSEDED",
        version: 1,
      }),
      expect.objectContaining({
        original_filename: "prescricao-atualizada.pdf",
        document_status: "ACTIVE",
        version: 2,
        supersedesId: uploadedId,
      }),
    ]);
    expect(storedPrescription.rows[0].blob_pathname).toMatch(
      new RegExp(`^prescriptions/.+/${patientId}/.+\\.pdf$`),
    );
    const juazeiroManager = await scopedCookie(juazeiro, "UNIT_MANAGER");
    const activePrescriptionId = (await replaced.json()).data.id as string;
    expect(
      (
        await prescriptionDownloadResponse(
          new Request(`${origin}/api/v1/inventory/prescriptions/${activePrescriptionId}`, {
            headers: { cookie: juazeiroManager },
          }),
          activePrescriptionId,
        )
      ).status,
    ).toBe(404);
    const inventoryManager = await scopedCookie(fortaleza, "INVENTORY_MANAGER");
    expect(
      (
        await prescriptionDownloadResponse(
          new Request(`${origin}/api/v1/inventory/prescriptions/${activePrescriptionId}`, {
            headers: { cookie: inventoryManager },
          }),
          activePrescriptionId,
        )
      ).status,
    ).toBe(403);
    vi.mocked(getBlob).mockResolvedValueOnce({
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("%PDF-1.4 synthetic replacement"));
          controller.close();
        },
      }),
    } as never);
    const downloaded = await prescriptionDownloadResponse(
      new Request(`${origin}/api/v1/inventory/prescriptions/${activePrescriptionId}`, {
        headers: { cookie: managerCookie },
      }),
      activePrescriptionId,
    );
    expect(downloaded.status).toBe(200);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::integer AS count FROM inventory_patient_prescription_access WHERE prescription_id=$1",
          [activePrescriptionId],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await patientDetailResponse(
          new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patientId}`, {
            headers: { cookie: juazeiroManager },
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await patientsResponse(
          new Request(`${origin}/api/v1/inventory/patients?unitId=${juazeiro}`, {
            headers: { cookie: managerCookie },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await patientsResponse(
          new Request(`${origin}/api/v1/inventory/patients`, {
            method: "POST",
            headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, id: randomUUID(), primaryUnitId: juazeiro }),
          }),
        )
      ).status,
    ).toBe(403);

    const changes = await getPool().query(
      "SELECT action,actor_user_id FROM inventory_patient_changes WHERE patient_id=$1",
      [patientId],
    );
    expect(changes.rows).toEqual([
      expect.objectContaining({ action: "CREATE", actor_user_id: expect.any(String) }),
    ]);
    await expect(
      getPool().query(
        "UPDATE inventory_patient_changes SET reason='alteração proibida' WHERE patient_id=$1",
        [patientId],
      ),
    ).rejects.toThrow();
  });

  it("does not expose patient identity to finance", async () => {
    const financeCookie = await scopedCookie("a1100000-0000-4000-8000-000000000101", "FINANCE");
    expect(
      (
        await patientsResponse(
          new Request(`${origin}/api/v1/inventory/patients`, {
            headers: { cookie: financeCookie },
          }),
        )
      ).status,
    ).toBe(403);
  });

  it("consolidates future demand, stock coverage and unit authorization", async () => {
    const fortaleza = "a1100000-0000-4000-8000-000000000101";
    const juazeiro = "a1100000-0000-4000-8000-000000000102";
    const managerCookie = await scopedCookie(fortaleza, "UNIT_MANAGER");
    const patientId = randomUUID();
    const productId = randomUUID();
    const treatmentId = randomUUID();
    const firstDate = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const rescheduledDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await getPool().query(
      `INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name,created_by_user_id,updated_by_user_id)
       VALUES($1,'a1100000-0000-4000-8000-000000000001',$2,$3,'Paciente Demanda Sintético',
         (SELECT user_id FROM inventory_memberships WHERE organization_id='a1100000-0000-4000-8000-000000000001' AND role='UNIT_MANAGER' ORDER BY created_at DESC LIMIT 1),
         (SELECT user_id FROM inventory_memberships WHERE organization_id='a1100000-0000-4000-8000-000000000001' AND role='UNIT_MANAGER' ORDER BY created_at DESC LIMIT 1))`,
      [patientId, fortaleza, `DEM-${patientId.slice(0, 8)}`],
    );
    await getPool().query(
      `INSERT INTO inventory_products(id,organization_id,name,sku,category,unit,minimum)
       VALUES($1,'a1100000-0000-4000-8000-000000000001','Produto Previsão Sintético',$2,'Teste','UN',0)`,
      [productId, `PREV-${patientId.slice(0, 8)}`],
    );
    const forecastSupplierId = randomUUID();
    const forecastCatalogId = randomUUID();
    await getPool().query(
      `INSERT INTO inventory_suppliers(id,organization_id,name)
       VALUES($1,'a1100000-0000-4000-8000-000000000001',$2)`,
      [forecastSupplierId, `Fornecedor previsão ${patientId}`],
    );
    await getPool().query(
      `INSERT INTO inventory_supplier_catalog(id,supplier_id,product_id,code,name,kind,description,packaging,contents,price,price_source)
       VALUES($1,$2,$3,$4,'Apresentação previsão','PRODUCT','Item sintético','Frasco','1 frasco',100,'Teste integrado')`,
      [forecastCatalogId, forecastSupplierId, productId, `PREV-CAT-${patientId.slice(0, 8)}`],
    );
    await getPool().query(
      `INSERT INTO inventory_pricing_presentations(organization_id,product_id,name,base_unit,total_base_quantity,total_volume_ml,acquisition_cost,technical_loss_percent,minimum_measurable_volume_ml,beyond_use_hours)
       VALUES('a1100000-0000-4000-8000-000000000001',$1,$2,'MG',20,0.8,100,10,0.11,24)`,
      [productId, `Apresentação demanda ${patientId}`],
    );
    const location = await getPool().query<{ id: string }>(
      "INSERT INTO inventory_locations(unit_id,name) VALUES($1,$2) RETURNING id",
      [fortaleza, `Local demanda ${patientId}`],
    );
    const lot = await getPool().query<{ id: string }>(
      `INSERT INTO inventory_lots(product_id,number,expires_on,supplier,unit_cost)
       VALUES($1,$2,current_date+180,'Fornecedor sintético',100) RETURNING id`,
      [productId, `LOTE-${patientId.slice(0, 8)}`],
    );
    await movement([lot.rows[0]!.id, location.rows[0]!.id], "2", "IN");
    const treatment = await patientDetailResponse(
      new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        method: "POST",
        headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_TREATMENT",
          id: treatmentId,
          patientId,
          productId,
          doseQuantity: 2.5,
          doseUnit: "MG",
          route: "SC",
          frequencyEveryDays: 7,
          firstScheduledOn: firstDate,
          plannedAdministrations: 4,
          status: "PLANNED",
          version: 0,
          reason: "Tratamento sintético para validar previsão consolidada.",
        }),
      }),
    );
    expect(treatment.status).toBe(201);
    const unprescribedSchedule = (
      await getPool().query<{ id: string; version: number }>(
        "SELECT id,version FROM inventory_patient_treatment_schedule WHERE treatment_id=$1 ORDER BY sequence LIMIT 1",
        [treatmentId],
      )
    ).rows[0]!;
    const withoutPrescription = await patientApplicationResponse(
      new Request(`${origin}/api/v1/inventory/patient-applications`, {
        method: "POST",
        headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: randomUUID(),
          patientId,
          scheduleId: unprescribedSchedule.id,
          scheduleVersion: unprescribedSchedule.version,
          locationId: location.rows[0]!.id,
          reference: `SEM-RECEITA-${patientId.slice(0, 8)}`,
          professional: "Profissional Sintético",
          administeredDoseQuantity: 2.5,
          route: "SC",
          occurrenceNotes: "",
          reason: "Tentativa sintética sem prescrição válida deve ser bloqueada.",
        }),
      }),
    );
    expect(withoutPrescription.status).toBe(409);
    expect((await withoutPrescription.json()).error).toContain("prescrição ativa e válida");
    await getPool().query(
      `INSERT INTO inventory_patient_prescriptions(
        organization_id,patient_id,treatment_id,blob_pathname,original_filename,content_type,
        size_bytes,prescriber_name,council_number,council_region,issued_on,valid_until
       ) VALUES('a1100000-0000-4000-8000-000000000001',$1,$2,$3,'receita-demanda.pdf',
         'application/pdf',100,'Dr. Demanda Sintético','CRM 99999','CE',current_date,current_date+365)`,
      [patientId, treatmentId, `prescriptions/test/${randomUUID()}.pdf`],
    );
    const demandPurchase = await patientDetailResponse(
      new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        method: "POST",
        headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_PURCHASE",
          id: randomUUID(),
          patientId,
          treatmentId,
          purchasedQuantity: 10,
          totalValue: 1000,
          reference: `VENDA-${patientId.slice(0, 8)}`,
          purchasedOn: firstDate,
          reason: "Compra sintética para validar aplicações e reservas.",
        }),
      }),
    );
    expect(demandPurchase.status).toBe(201);

    const response = await patientDemandResponse(
      new Request(`${origin}/api/v1/inventory/patient-demand?horizon=30&unitId=${fortaleza}`, {
        headers: { cookie: managerCookie },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(
      expect.objectContaining({
        horizon: 30,
        summary: expect.objectContaining({ administrations: 4, patients: 1 }),
        items: [
          expect.objectContaining({
            productId,
            unitId: fortaleza,
            demandQuantity: 10,
            usablePerPresentation: 18,
            requiredStockUnits: 4,
            availableStockUnits: 2,
            shortageStockUnits: 2,
            doseVolumeMl: 0.1,
            measurementWarning: true,
          }),
        ],
      }),
    );
    const scheduleResponse = await patientScheduleResponse(
      new Request(`${origin}/api/v1/inventory/patient-schedule?days=7&unitId=${fortaleza}`, {
        headers: { cookie: managerCookie },
      }),
    );
    expect(scheduleResponse.status).toBe(200);
    const scheduleData = (await scheduleResponse.json()).data;
    expect(scheduleData).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({ total: 1 }),
        items: [
          expect.objectContaining({
            patientId,
            productId,
            unitId: fortaleza,
            doseQuantity: 2.5,
            status: "PLANNED",
            attendanceStatus: "SCHEDULED",
            presentationMissing: false,
          }),
        ],
      }),
    );
    const operationalSchedule = scheduleData.items[0];
    expect(
      (
        await patientScheduleResponse(
          new Request(`${origin}/api/v1/inventory/patient-schedule`, {
            method: "POST",
            headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "CONFIRM",
              scheduleId: operationalSchedule.id,
              version: operationalSchedule.version,
              reason: "Paciente confirmou presença no atendimento sintético.",
            }),
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await patientScheduleResponse(
          new Request(`${origin}/api/v1/inventory/patient-schedule`, {
            method: "POST",
            headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "RESCHEDULE",
              scheduleId: operationalSchedule.id,
              version: operationalSchedule.version,
              scheduledOn: firstDate,
              reason: "Tentativa concorrente com versão antiga para validação.",
            }),
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await patientScheduleResponse(
          new Request(`${origin}/api/v1/inventory/patient-schedule`, {
            method: "POST",
            headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "RESCHEDULE",
              scheduleId: operationalSchedule.id,
              version: operationalSchedule.version + 1,
              scheduledOn: rescheduledDate,
              reason: "Paciente solicitou nova data para o atendimento sintético.",
            }),
          }),
        )
      ).status,
    ).toBe(200);
    const updatedSchedule = await patientScheduleResponse(
      new Request(`${origin}/api/v1/inventory/patient-schedule?days=7&unitId=${fortaleza}`, {
        headers: { cookie: managerCookie },
      }),
    );
    expect((await updatedSchedule.json()).data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: operationalSchedule.id,
          scheduledOn: rescheduledDate,
          attendanceStatus: "SCHEDULED",
          version: operationalSchedule.version + 2,
        }),
      ]),
    );
    const purchaseNeeds = await patientPurchaseNeedsResponse(
      new Request(
        `${origin}/api/v1/inventory/patient-purchase-needs?horizon=30&leadDays=7&unitId=${fortaleza}`,
        { headers: { cookie: managerCookie } },
      ),
    );
    expect(purchaseNeeds.status).toBe(200);
    expect((await purchaseNeeds.json()).data).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({ needingPurchase: 1, estimatedCost: 200 }),
        items: [
          expect.objectContaining({
            productId,
            unitId: fortaleza,
            requiredUnits: 4,
            physicalUnits: 2,
            recommendedUnits: 2,
            netAfterPending: 2,
            estimatedCost: 200,
            supplierId: forecastSupplierId,
            catalogItemId: forecastCatalogId,
            catalogPrice: "100.00",
          }),
        ],
      }),
    );
    const otherManager = await scopedCookie(juazeiro, "UNIT_MANAGER");
    expect(
      (
        await patientPurchaseNeedsResponse(
          new Request(`${origin}/api/v1/inventory/patient-purchase-needs?unitId=${fortaleza}`, {
            headers: { cookie: otherManager },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await patientScheduleResponse(
          new Request(`${origin}/api/v1/inventory/patient-schedule?unitId=${fortaleza}`, {
            headers: { cookie: otherManager },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await patientDemandResponse(
          new Request(`${origin}/api/v1/inventory/patient-demand?unitId=${fortaleza}`, {
            headers: { cookie: otherManager },
          }),
        )
      ).status,
    ).toBe(403);

    await getPool().query(
      "UPDATE inventory_pricing_presentations SET minimum_measurable_volume_ml=0.05 WHERE product_id=$1",
      [productId],
    );
    const earlierLot = await getPool().query<{ id: string }>(
      `INSERT INTO inventory_lots(product_id,number,expires_on,supplier,unit_cost)
       VALUES($1,$2,current_date+30,'Fornecedor FEFO sintético',100) RETURNING id`,
      [productId, `FEFO-${patientId.slice(0, 8)}`],
    );
    await movement([earlierLot.rows[0]!.id, location.rows[0]!.id], "1", "IN");
    const operationId = randomUUID();
    const applicationBody = {
      operationId,
      patientId,
      ...(
        await getPool().query<{ scheduleId: string; scheduleVersion: number }>(
          `SELECT id AS "scheduleId",version AS "scheduleVersion"
           FROM inventory_patient_treatment_schedule WHERE treatment_id=$1 ORDER BY sequence LIMIT 1`,
          [treatmentId],
        )
      ).rows[0]!,
      locationId: location.rows[0]!.id,
      reference: `APL-${patientId.slice(0, 8)}`,
      professional: "Profissional Sintético",
      administeredDoseQuantity: 2.5,
      route: "SC",
      occurrenceNotes: "Sem intercorrências no teste integrado.",
      reason: "Aplicação sintética para validar baixa física e FEFO.",
    };
    const applicationRequest = () =>
      new Request(`${origin}/api/v1/inventory/patient-applications`, {
        method: "POST",
        headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify(applicationBody),
      });
    const changedDose = await patientApplicationResponse(
      new Request(`${origin}/api/v1/inventory/patient-applications`, {
        method: "POST",
        headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...applicationBody,
          operationId: randomUUID(),
          reference: `DOSE-DIVERGENTE-${patientId.slice(0, 8)}`,
          administeredDoseQuantity: 5,
        }),
      }),
    );
    expect(changedDose.status).toBe(409);
    expect((await changedDose.json()).error).toContain("dose confirmada difere");
    const concurrent = await Promise.all([
      patientApplicationResponse(applicationRequest()),
      patientApplicationResponse(applicationRequest()),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 201]);
    const applied = concurrent.find((response) => response.status === 201)!;
    const replayed = concurrent.find((response) => response.status === 200)!;
    expect((await applied.json()).data).toEqual(
      expect.objectContaining({
        id: operationId,
        replayed: false,
        physicalQuantity: 1,
        doseQuantity: 2.5,
        doseUnit: "MG",
        route: "SC",
        doseVolumeMl: 0.1,
        prescriptionId: expect.any(String),
        allocations: [expect.objectContaining({ lotId: earlierLot.rows[0]!.id, quantity: 1 })],
      }),
    );
    expect((await replayed.json()).data.replayed).toBe(true);
    const state = await getPool().query(
      `SELECT s.status,s.version,b.quantity::text,
        pa.route,pa.dose_volume_ml::text,pa.occurrence_notes,pa.prescription_id,
        (SELECT count(*)::integer FROM inventory_patient_applications WHERE schedule_id=s.id) AS applications,
        (SELECT count(*)::integer FROM inventory_patient_application_movements pam
          JOIN inventory_patient_applications pa ON pa.id=pam.patient_application_id
          WHERE pa.schedule_id=s.id) AS movements
       FROM inventory_patient_treatment_schedule s
       JOIN inventory_patient_applications pa ON pa.schedule_id=s.id
       JOIN inventory_balances b ON b.lot_id=$2 AND b.location_id=$3
       WHERE s.id=$1`,
      [applicationBody.scheduleId, earlierLot.rows[0]!.id, location.rows[0]!.id],
    );
    expect(state.rows).toEqual([
      expect.objectContaining({
        status: "CONSUMED",
        version: applicationBody.scheduleVersion + 1,
        quantity: "0.000",
        applications: 1,
        movements: 1,
        route: "SC",
        dose_volume_ml: "0.100000",
        occurrence_notes: "Sem intercorrências no teste integrado.",
        prescription_id: expect.any(String),
      }),
    ]);
    const duplicate = await patientApplicationResponse(
      new Request(`${origin}/api/v1/inventory/patient-applications`, {
        method: "POST",
        headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...applicationBody,
          operationId: randomUUID(),
          reference: `DUP-${patientId.slice(0, 8)}`,
        }),
      }),
    );
    expect(duplicate.status).toBe(409);
    const secondSchedule = await getPool().query<{ id: string; version: number }>(
      "SELECT id,version FROM inventory_patient_treatment_schedule WHERE treatment_id=$1 AND sequence=2",
      [treatmentId],
    );
    const reused = await patientApplicationResponse(
      new Request(`${origin}/api/v1/inventory/patient-applications`, {
        method: "POST",
        headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...applicationBody,
          operationId: randomUUID(),
          scheduleId: secondSchedule.rows[0]!.id,
          scheduleVersion: secondSchedule.rows[0]!.version,
          reference: `APL2-${patientId.slice(0, 8)}`,
        }),
      }),
    );
    expect(reused.status).toBe(201);
    expect((await reused.json()).data).toEqual(
      expect.objectContaining({ physicalQuantity: 0, allocations: [] }),
    );
    const fraction = await getPool().query(
      `SELECT op.initial_base_quantity::text,op.remaining_base_quantity::text,op.status,
        COALESCE(sum(e.quantity) FILTER (WHERE e.type='TECHNICAL_LOSS'),0)::text AS technical_loss,
        COALESCE(sum(e.quantity) FILTER (WHERE e.type='CONSUME'),0)::text AS consumed,
        (SELECT count(*)::integer FROM inventory_patient_application_movements pam
          JOIN inventory_patient_applications pa ON pa.id=pam.patient_application_id
          WHERE pa.patient_id=$1) AS movements
       FROM inventory_open_presentations op
       JOIN inventory_open_presentation_events e ON e.open_presentation_id=op.id
       WHERE op.product_id=$2
       GROUP BY op.id`,
      [patientId, productId],
    );
    expect(fraction.rows).toEqual([
      expect.objectContaining({
        initial_base_quantity: "20.000000",
        remaining_base_quantity: "13.000000",
        status: "OPEN",
        technical_loss: "2.000000",
        consumed: "5.000000",
        movements: 1,
      }),
    ]);
    const openList = await openPresentationResponse(
      new Request(`${origin}/api/v1/inventory/open-presentations?unitId=${fortaleza}`, {
        headers: { cookie: managerCookie },
      }),
    );
    expect(openList.status).toBe(200);
    const openData = (await openList.json()).data;
    expect(openData.items).toEqual([
      expect.objectContaining({
        productId,
        remainingQuantity: "13.000000",
        consumedQuantity: "5.000000",
        lossQuantity: "2.000000",
        status: "OPEN",
      }),
    ]);
    const listedPresentation = openData.items[0];
    const discardBody = {
      eventId: randomUUID(),
      openPresentationId: listedPresentation.id,
      version: listedPresentation.version,
      type: "DAMAGE",
      reason: "Avaria sintética conferida no teste de integração.",
    };
    const discardRequest = (authorizationCookie: string) =>
      new Request(`${origin}/api/v1/inventory/open-presentations`, {
        method: "POST",
        headers: {
          cookie: authorizationCookie,
          origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(discardBody),
      });
    expect((await openPresentationResponse(discardRequest(otherManager))).status).toBe(403);
    expect((await openPresentationResponse(discardRequest(managerCookie))).status).toBe(201);
    expect((await openPresentationResponse(discardRequest(managerCookie))).status).toBe(200);
    const discarded = await getPool().query(
      `SELECT remaining_base_quantity::text,status,version FROM inventory_open_presentations
       WHERE id=$1`,
      [listedPresentation.id],
    );
    expect(discarded.rows).toEqual([
      { remaining_base_quantity: "0.000000", status: "DISCARDED", version: 3 },
    ]);
    const foreignAttempt = await patientApplicationResponse(
      new Request(`${origin}/api/v1/inventory/patient-applications`, {
        method: "POST",
        headers: { cookie: otherManager, origin, "Content-Type": "application/json" },
        body: JSON.stringify({ ...applicationBody, operationId: randomUUID() }),
      }),
    );
    expect(foreignAttempt.status).toBe(403);
    const cancellable = (
      await getPool().query<{ id: string; version: number }>(
        "SELECT id,version FROM inventory_patient_treatment_schedule WHERE treatment_id=$1 AND sequence=4",
        [treatmentId],
      )
    ).rows[0]!;
    const scheduleOperation = (cookie: string, body: Record<string, unknown>) =>
      patientScheduleResponse(
        new Request(`${origin}/api/v1/inventory/patient-schedule`, {
          method: "POST",
          headers: { cookie, origin, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    expect(
      (
        await scheduleOperation(otherManager, {
          action: "CANCEL",
          scheduleId: cancellable.id,
          version: cancellable.version,
          reason: "Tentativa de cancelamento por outra unidade.",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await scheduleOperation(managerCookie, {
          action: "NO_SHOW",
          scheduleId: cancellable.id,
          version: cancellable.version,
          reason: "Tentativa de falta antes da data agendada.",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await scheduleOperation(managerCookie, {
          action: "CANCEL",
          scheduleId: cancellable.id,
          version: cancellable.version,
          reason: "Aplicação cancelada no encerramento do cenário sintético.",
        })
      ).status,
    ).toBe(200);
    const canceled = await getPool().query(
      `SELECT status,attendance_status AS "attendanceStatus",version,
        (SELECT count(*)::integer FROM inventory_patient_schedule_changes WHERE schedule_id=$1) AS changes
       FROM inventory_patient_treatment_schedule WHERE id=$1`,
      [cancellable.id],
    );
    expect(canceled.rows).toEqual([
      expect.objectContaining({
        status: "CANCELED",
        attendanceStatus: "CANCELED",
        version: cancellable.version + 1,
        changes: 1,
      }),
    ]);
  });

  it("keeps patient codes immutable, preserves consent evidence and scopes partners", async () => {
    const fortaleza = "a1100000-0000-4000-8000-000000000101";
    const juazeiro = "a1100000-0000-4000-8000-000000000102";
    const managerCookie = await scopedCookie(fortaleza, "UNIT_MANAGER");
    const patientId = randomUUID();
    const marker = patientId.slice(0, 8);
    const body = {
      action: "CREATE",
      id: patientId,
      primaryUnitId: fortaleza,
      internalCode: "",
      fullName: `Paciente Imutável ${marker}`,
      phone: "85999990001",
      email: `${marker}@example.test`,
      active: true,
      consentStatus: "PENDING",
      privateData: { allergies: ["Alergia sintética"], vegan: null, notes: "Nota privada" },
      version: 0,
      reason: "Cadastro para validar código e consentimento imutáveis.",
    };
    const post = (value: unknown) =>
      patientsResponse(
        new Request(`${origin}/api/v1/inventory/patients`, {
          method: "POST",
          headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
          body: JSON.stringify(value),
        }),
      );
    expect((await post(body)).status).toBe(201);
    const created = await getPool().query(
      `SELECT internal_code,consent_recorded_at,consent_recorded_by_user_id
       FROM inventory_patients WHERE id=$1`,
      [patientId],
    );
    const originalCode = created.rows[0].internal_code;

    expect(
      (
        await post({
          ...body,
          action: "UPDATE",
          internalCode: "PAC-999999",
          consentStatus: "RECORDED",
          reason: "Consentimento registrado no teste de preservação.",
        })
      ).status,
    ).toBe(200);
    const recorded = await getPool().query(
      `SELECT internal_code,consent_recorded_at,consent_recorded_by_user_id
       FROM inventory_patients WHERE id=$1`,
      [patientId],
    );
    expect(recorded.rows[0].internal_code).toBe(originalCode);
    expect(recorded.rows[0].consent_recorded_at).not.toBeNull();
    expect(recorded.rows[0].consent_recorded_by_user_id).not.toBeNull();

    const inventoryManager = await scopedCookie(fortaleza, "INVENTORY_MANAGER");
    const redacted = await patientsResponse(
      new Request(`${origin}/api/v1/inventory/patients?search=${marker}`, {
        headers: { cookie: inventoryManager },
      }),
    );
    expect(redacted.status).toBe(200);
    expect((await redacted.json()).data).toEqual(
      expect.objectContaining({
        canReadPrivate: false,
        patients: [expect.objectContaining({ id: patientId, privateData: {} })],
      }),
    );
    expect(
      (
        await patientDetailResponse(
          new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patientId}`, {
            headers: { cookie: inventoryManager },
          }),
        )
      ).status,
    ).toBe(403);

    expect(
      (
        await post({
          ...body,
          action: "UPDATE",
          version: 1,
          internalCode: "PAC-888888",
          consentStatus: "RECORDED",
          fullName: `Paciente Editado ${marker}`,
          reason: "Edição cadastral sem alterar evidência do consentimento.",
        })
      ).status,
    ).toBe(200);
    const edited = await getPool().query(
      `SELECT internal_code,consent_recorded_at,consent_recorded_by_user_id
       FROM inventory_patients WHERE id=$1`,
      [patientId],
    );
    expect(edited.rows[0]).toEqual(recorded.rows[0]);

    const foreignId = randomUUID();
    await getPool().query(
      `INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name)
       VALUES($1,'a1100000-0000-4000-8000-000000000001',$2,$3,$4)`,
      [foreignId, juazeiro, `SCOPE-${foreignId.slice(0, 8)}`, `Paciente Escopo ${marker}`],
    );
    const partnerCookie = await scopedCookie(fortaleza, "PARTNER_ADMIN");
    const scoped = await patientsResponse(
      new Request(`${origin}/api/v1/inventory/patients?search=${marker}`, {
        headers: { cookie: partnerCookie },
      }),
    );
    expect(scoped.status).toBe(200);
    expect(
      (await scoped.json()).data.patients.map((patient: { id: string }) => patient.id),
    ).toEqual([patientId]);
  });
});

describe("PostgreSQL receiving", () => {
  async function receiptFixture() {
    const f = await fixture();
    return {
      operationId: randomUUID(),
      reference: "RECEIPT-TEST",
      supplier: "Fornecedor sintético",
      locationId: String(f.params[1]),
      items: [
        {
          productId: f.productId,
          lot: randomUUID(),
          expiry: "2099-01-01",
          quantity: "2.125",
          unitCost: "2",
        },
      ],
    };
  }
  it("serializes duplicate receipts and projects one movement, balance and audit", async () => {
    const body = await receiptFixture();
    const results = await Promise.all([
      receivingResponse(receivingRequest(body)),
      receivingResponse(receivingRequest(body)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    const ledger = await getPool().query(
      "SELECT m.delta::text AS quantity, b.quantity::text AS balance, (SELECT count(*)::int FROM inventory_audit a WHERE a.movement_id=m.id) AS audits FROM inventory_movements m JOIN inventory_balances b ON b.lot_id=m.lot_id AND b.location_id=m.location_id WHERE m.operation_key=$1",
      [`${body.operationId}:0`],
    );
    expect(ledger.rows).toEqual([{ quantity: "2.125", balance: "2.125", audits: 1 }]);
  });
  it("rolls back new lots, receipts and entries when a later product is invalid", async () => {
    const body = await receiptFixture();
    body.items.push({ ...body.items[0]!, productId: randomUUID(), lot: randomUUID() });
    expect((await receivingResponse(receivingRequest(body))).status).toBe(409);
    const receipt = await getPool().query("SELECT id FROM inventory_receipts WHERE id=$1", [
      body.operationId,
    ]);
    const lot = await getPool().query(
      "SELECT id FROM inventory_lots WHERE product_id=$1 AND number=$2",
      [body.items[0]!.productId, body.items[0]!.lot],
    );
    expect(receipt.rows).toHaveLength(0);
    expect(lot.rows).toHaveLength(0);
  });
  it("rejects changes to an already committed operation without adding stock", async () => {
    const body = await receiptFixture();
    expect((await receivingResponse(receivingRequest(body))).status).toBe(201);
    body.items[0]!.quantity = "99";
    expect((await receivingResponse(receivingRequest(body))).status).toBe(409);
    const ledger = await getPool().query(
      "SELECT delta::text AS quantity FROM inventory_movements WHERE operation_key=$1",
      [`${body.operationId}:0`],
    );
    expect(ledger.rows).toEqual([{ quantity: "2.125" }]);
  });
});

describe("PostgreSQL purchase receiving", () => {
  async function purchaseFixture() {
    const f = await fixture();
    const supplierId = randomUUID();
    const supplier = `Fornecedor ${supplierId}`;
    expect(
      (await purchasingResponse(receivingRequest({ id: supplierId, name: supplier }), "suppliers"))
        .status,
    ).toBe(201);
    const purchaseId = randomUUID();
    const reference = `PO-${purchaseId}`;
    const order = {
      id: purchaseId,
      reference,
      supplierId,
      items: [{ productId: f.productId, quantity: "10", unitCost: "2" }],
    };
    expect((await purchasingResponse(receivingRequest(order), "purchases")).status).toBe(201);
    const line = (
      await getPool().query("SELECT id FROM inventory_purchase_items WHERE purchase_id=$1", [
        purchaseId,
      ])
    ).rows[0].id as string;
    const body = {
      operationId: randomUUID(),
      purchaseId,
      reference,
      supplier,
      locationId: String(f.params[1]),
      items: [
        {
          productId: f.productId,
          purchaseItemId: line,
          lot: randomUUID(),
          expiry: "2099-01-01",
          quantity: "4",
          unitCost: "2",
        },
      ],
    };
    return { body, order };
  }
  async function readOrder(id: string) {
    const response = await purchasingResponse(
      new Request(`${origin}/api/v1/inventory/purchases`, { headers: { cookie } }),
      "purchases",
    );
    const result = await response.json();
    return result.data.find((order: { id: string }) => order.id === id);
  }
  it("tracks open, partial and fully received orders without duplicate replay", async () => {
    const { body } = await purchaseFixture();
    expect((await readOrder(body.purchaseId)).status).toBe("OPEN");
    expect((await receivingResponse(receivingRequest(body))).status).toBe(201);
    expect((await receivingResponse(receivingRequest(body))).status).toBe(200);
    const partial = await readOrder(body.purchaseId);
    expect(partial.status).toBe("PARTIAL");
    expect(partial.items[0].remaining).toBe("6.000");
    body.operationId = randomUUID();
    body.items[0]!.quantity = "6";
    expect((await receivingResponse(receivingRequest(body))).status).toBe(201);
    expect((await readOrder(body.purchaseId)).status).toBe("RECEIVED");
  });
  it("serializes competing deliveries and rejects excess quantities", async () => {
    const { body } = await purchaseFixture();
    body.items[0]!.quantity = "6";
    const second = {
      ...body,
      operationId: randomUUID(),
      items: [{ ...body.items[0]!, lot: randomUUID() }],
    };
    const results = await Promise.all([
      receivingResponse(receivingRequest(body)),
      receivingResponse(receivingRequest(second)),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await readOrder(body.purchaseId)).items[0].received).toBe("6.000");
  });
  it("rolls back the purchase counter when a lot is invalid", async () => {
    const { body } = await purchaseFixture();
    body.items[0]!.expiry = "2020-01-01";
    expect((await receivingResponse(receivingRequest(body))).status).toBe(409);
    expect((await readOrder(body.purchaseId)).items[0].received).toBe("0.000");
  });
  it("replays order creation without duplicating its lines and rejects a changed request", async () => {
    const { body, order } = await purchaseFixture();
    expect((await purchasingResponse(receivingRequest(order), "purchases")).status).toBe(200);
    expect((await readOrder(body.purchaseId)).items).toHaveLength(1);
    order.items[0]!.quantity = "11";
    expect((await purchasingResponse(receivingRequest(order), "purchases")).status).toBe(409);
  });
});
describe("PostgreSQL transfers and physical counts", () => {
  async function transferFixture(quantity = "10", days = 90) {
    const f = await fixture(quantity, days);
    const destination = await getPool().query(
      "INSERT INTO inventory_locations(unit_id,name) VALUES('a1100000-0000-4000-8000-000000000102',$1) RETURNING id",
      [`Destino ${randomUUID()}`],
    );
    const body = {
      operationId: randomUUID(),
      lotId: String(f.params[0]),
      sourceId: String(f.params[1]),
      destinationId: String(destination.rows[0].id),
      quantity: "3.125",
      reference: `TR-${randomUUID()}`,
      reason: `Reposição entre locais ${randomUUID()}`,
    };
    return { f, body };
  }
  const transfer = (body: unknown) => stockOperationResponse(receivingRequest(body), "TRANSFER");
  const count = (body: unknown) => stockOperationResponse(receivingRequest(body), "ADJUSTMENT");
  const counting = (
    body: Awaited<ReturnType<typeof transferFixture>>["body"],
    expectedQuantity = "10",
    countedQuantity = "7.125",
  ) => ({
    operationId: randomUUID(),
    lotId: body.lotId,
    locationId: body.sourceId,
    expectedQuantity,
    countedQuantity,
    reference: `CT-${randomUUID()}`,
    reason: "Conferência física no fechamento",
  });
  async function balances(lotId: string) {
    return (
      await getPool().query(
        "SELECT location_id,quantity::text FROM inventory_balances WHERE lot_id=$1",
        [lotId],
      )
    ).rows as { location_id: string; quantity: string }[];
  }
  it("moves the same lot atomically, preserves total and exposes both locations and reason", async () => {
    const { body } = await transferFixture();
    expect((await transfer(body)).status).toBe(201);
    const stock = await balances(body.lotId);
    expect(stock.find((row) => row.location_id === body.sourceId)?.quantity).toBe("6.875");
    expect(stock.find((row) => row.location_id === body.destinationId)?.quantity).toBe("3.125");
    const ledger = await getPool().query(
      "SELECT m.delta::text, (SELECT count(*)::int FROM inventory_audit a WHERE a.movement_id=m.id) AS audits FROM inventory_operation_movements om JOIN inventory_movements m ON m.id=om.movement_id WHERE om.operation_id=$1 ORDER BY m.delta",
      [body.operationId],
    );
    expect(ledger.rows).toEqual([
      { delta: "-3.125", audits: 1 },
      { delta: "3.125", audits: 1 },
    ]);
    const response = await inventoryResponse(request(`movements?search=${body.reference}`));
    const history = (await response.json()).data;
    expect(history).toHaveLength(2);
    expect(
      history.every(
        (row: { operationId: string; origin: string; destination: string; reason: string }) =>
          row.operationId === body.operationId &&
          row.origin.startsWith("Local ") &&
          row.destination.startsWith("Destino ") &&
          row.reason === body.reason,
      ),
    ).toBe(true);
    const reasonSearch = await inventoryResponse(
      request(`movements?search=${encodeURIComponent(body.reason)}`),
    );
    expect((await reasonSearch.json()).data).toHaveLength(2);
  });
  it("replays simultaneous submissions exactly once and rejects changed payloads", async () => {
    const { body } = await transferFixture();
    const responses = await Promise.all([transfer(body), transfer(body)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect((await transfer({ ...body, quantity: "4" })).status).toBe(409);
    expect(
      (await balances(body.lotId)).find((row) => row.location_id === body.sourceId)?.quantity,
    ).toBe("6.875");
  });
  it("rolls back both movements when the destination would exceed numeric capacity", async () => {
    const { body } = await transferFixture();
    await movement([body.lotId, body.destinationId], "99999999999.000", "IN");
    expect((await transfer(body)).status).toBe(409);
    const stock = await balances(body.lotId);
    expect(stock.find((row) => row.location_id === body.sourceId)?.quantity).toBe("10.000");
    expect(stock.find((row) => row.location_id === body.destinationId)?.quantity).toBe(
      "99999999999.000",
    );
    const operation = await getPool().query("SELECT id FROM inventory_operations WHERE id=$1", [
      body.operationId,
    ]);
    expect(operation.rowCount).toBe(0);
    const ledger = await getPool().query("SELECT id FROM inventory_movements WHERE reference=$1", [
      body.reference,
    ]);
    expect(ledger.rowCount).toBe(0);
  });
  it("serializes competing transfers without allowing negative stock", async () => {
    const { body } = await transferFixture();
    body.quantity = "6";
    const responses = await Promise.all([
      transfer(body),
      transfer({ ...body, operationId: randomUUID() }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await balances(body.lotId)).find((row) => row.location_id === body.sourceId)?.quantity,
    ).toBe("4.000");
  });
  it("locks opposite transfers in the same order", async () => {
    const { body } = await transferFixture();
    await movement([body.lotId, body.destinationId], "10", "IN");
    const reverse = {
      ...body,
      operationId: randomUUID(),
      sourceId: body.destinationId,
      destinationId: body.sourceId,
      quantity: "2.125",
    };
    const responses = await Promise.all([transfer(body), transfer(reverse)]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(
      (await balances(body.lotId)).find((row) => row.location_id === body.sourceId)?.quantity,
    ).toBe("9.000");
  });
  it("refuses expired, blocked and inactive destinations without changing stock", async () => {
    const expired = await transferFixture("10", -1);
    expect((await transfer(expired.body)).status).toBe(409);
    const { body } = await transferFixture();
    await getPool().query("UPDATE inventory_lots SET status='BLOCKED' WHERE id=$1", [body.lotId]);
    expect((await transfer(body)).status).toBe(409);
    await getPool().query("UPDATE inventory_lots SET status='AVAILABLE' WHERE id=$1", [body.lotId]);
    await getPool().query("UPDATE inventory_locations SET active=false WHERE id=$1", [
      body.destinationId,
    ]);
    expect((await transfer(body)).status).toBe(409);
    expect(await balances(body.lotId)).toEqual([
      { location_id: body.sourceId, quantity: "10.000" },
    ]);
  });
  it("records exact count differences, including zero, and replays without duplication", async () => {
    const { body } = await transferFixture();
    const adjustment = counting(body);
    expect((await count(adjustment)).status).toBe(201);
    expect((await count(adjustment)).status).toBe(200);
    expect((await balances(body.lotId))[0]?.quantity).toBe("7.125");
    expect((await count(counting(body, "7.125", "0"))).status).toBe(201);
    expect((await balances(body.lotId))[0]?.quantity).toBe("0.000");
    const ledger = await getPool().query(
      "SELECT delta::text FROM inventory_movements WHERE lot_id=$1 AND type='ADJUSTMENT' ORDER BY inventory_movements.delta",
      [body.lotId],
    );
    expect(ledger.rows).toEqual([{ delta: "-7.125" }, { delta: "-2.875" }]);
  });
  it("rejects stale and concurrent counts instead of overwriting new movements", async () => {
    const { body } = await transferFixture();
    const responses = await Promise.all([
      count(counting(body, "10", "8")),
      count(counting(body, "10", "9")),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const consulted = (await balances(body.lotId))[0]!.quantity;
    await movement([body.lotId, body.sourceId], "2", "IN");
    const stale = await count(counting(body, consulted));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toContain("saldo mudou");
  });
  it("allows counting unavailable stock without making it usable", async () => {
    const { body } = await transferFixture("10", -1);
    await getPool().query("UPDATE inventory_lots SET status='BLOCKED' WHERE id=$1", [body.lotId]);
    expect((await count(counting(body, "10", "12.125"))).status).toBe(201);
    expect((await balances(body.lotId))[0]?.quantity).toBe("12.125");
    expect((await transfer({ ...body, operationId: randomUUID() })).status).toBe(409);
    const lot = await getPool().query("SELECT status FROM inventory_lots WHERE id=$1", [
      body.lotId,
    ]);
    expect(lot.rows[0].status).toBe("BLOCKED");
  });
  it("rejects unchanged counts and prevents history alterations", async () => {
    const { body } = await transferFixture();
    expect((await count(counting(body, "10", "10"))).status).toBe(409);
    expect((await transfer(body)).status).toBe(201);
    await expect(
      getPool().query("UPDATE inventory_operations SET request_hash='modified' WHERE id=$1", [
        body.operationId,
      ]),
    ).rejects.toThrow("append-only");
    await expect(
      getPool().query("DELETE FROM inventory_operation_movements WHERE operation_id=$1", [
        body.operationId,
      ]),
    ).rejects.toThrow("append-only");
  });
  it("denies unauthenticated and cross-origin writes", async () => {
    expect((await stockOperationResponse(new Request(origin), "TRANSFER")).status).toBe(401);
    expect(
      (
        await stockOperationResponse(
          new Request(origin, {
            method: "POST",
            headers: { cookie, origin: "https://other.invalid" },
          }),
          "ADJUSTMENT",
        )
      ).status,
    ).toBe(403);
  });
});
describe("Controlled inventory write-offs", () => {
  it("records damage from a blocked lot without making the lot usable", async () => {
    const f = await fixture("5");
    await getPool().query("UPDATE inventory_lots SET status='BLOCKED' WHERE id=$1", [f.params[0]]);
    const response = await writeOffResponse(
      new Request(`${origin}/api/v1/inventory/write-offs`, {
        method: "POST",
        headers: { cookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: randomUUID(),
          type: "DAMAGE",
          lotId: f.params[0],
          locationId: f.params[1],
          quantity: "2",
          reference: "AVARIA-TESTE",
          reason: "Avaria física confirmada durante a conferência.",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(
      (
        await getPool().query("SELECT quantity::text FROM inventory_balances WHERE lot_id=$1", [
          f.params[0],
        ])
      ).rows[0].quantity,
    ).toBe("3.000");
    expect(
      (await getPool().query("SELECT status FROM inventory_lots WHERE id=$1", [f.params[0]]))
        .rows[0].status,
    ).toBe("BLOCKED");
  });
});

describe("care appointments", () => {
  it("rejects a manually forged appointment for another unit", async () => {
    const fortaleza = "a1100000-0000-4000-8000-000000000101";
    const juazeiro = "a1100000-0000-4000-8000-000000000102";
    const managerCookie = await scopedCookie(fortaleza, "UNIT_MANAGER");
    const response = await careAppointmentsResponse(
      new Request(`${origin}/api/v1/inventory/care-appointments`, {
        method: "POST",
        headers: { cookie: managerCookie, origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE",
          id: randomUUID(),
          unitId: juazeiro,
          patientId: randomUUID(),
          professionalUserId: randomUUID(),
          careType: "CONSULTATION",
          startsAt: "2026-10-20T12:00:00.000Z",
          endsAt: "2026-10-20T13:00:00.000Z",
          room: "Consultório 1",
          chair: null,
          resourceName: null,
          notes: "",
          status: "SCHEDULED",
          version: 0,
          reason: "Tentativa sintética fora da unidade autorizada.",
        }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("creates configurable rooms, resources and appointment types", async () => {
    const unitId = "a1100000-0000-4000-8000-000000000101";
    const suffix = randomUUID().slice(0, 8);
    const post = (body: unknown) =>
      careSettingsResponse(
        new Request(`${origin}/api/v1/inventory/care-settings`, {
          method: "POST",
          headers: { cookie, origin, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const roomResponse = await post({
      action: "CREATE_ROOM",
      unitId,
      name: `Sala ${suffix}`,
    });
    expect(roomResponse.status).toBe(201);
    const roomId = (await roomResponse.json()).data.id;
    expect(
      (
        await post({
          action: "CREATE_RESOURCE",
          unitId,
          roomId,
          name: "Poltrona 1",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post({
          action: "CREATE_TYPE",
          name: `Procedimento ${suffix}`,
        })
      ).status,
    ).toBe(201);

    const listed = await careSettingsResponse(
      new Request(`${origin}/api/v1/inventory/care-settings`, { headers: { cookie } }),
    );
    expect(listed.status).toBe(200);
    const data = (await listed.json()).data;
    expect(data.rooms).toEqual(expect.arrayContaining([expect.objectContaining({ id: roomId })]));
    expect(data.resources).toEqual(
      expect.arrayContaining([expect.objectContaining({ roomId, name: "Poltrona 1" })]),
    );
    expect(data.types).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: `Procedimento ${suffix}` })]),
    );
  });

  it("creates a unit-scoped appointment, rejects schedule conflicts and lists the audit-safe result", async () => {
    const unitId = "a1100000-0000-4000-8000-000000000101";
    const patientId = randomUUID();
    const professional = await getPool().query<{ id: string }>(
      `INSERT INTO inventory_users(name,email,profession,professional_council,council_number,council_region)
       VALUES('Profissional Agenda Sintético',$1,'Médico','CRM','12345','CE') RETURNING id`,
      [`${randomUUID()}@example.test`],
    );
    await getPool().query(
      `INSERT INTO inventory_memberships(user_id,organization_id,role)
       VALUES($1,'a1100000-0000-4000-8000-000000000001','SUPER_ADMIN')`,
      [professional.rows[0]!.id],
    );
    const professionalToken = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [professional.rows[0]!.id, hashToken(professionalToken)],
    );
    const professionalCookie = `allik_inventory_session=${professionalToken}`;
    const documentNumber = `DOC${patientId.replaceAll("-", "").slice(0, 11)}`;
    await getPool().query(
      `INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name,phone,email,document_number)
       VALUES($1,'a1100000-0000-4000-8000-000000000001',$2,$3,'Paciente Agenda Sintético','+5585999999999','agenda@example.test',$4)`,
      [patientId, unitId, `AGENDA-${patientId.slice(0, 8)}`, documentNumber],
    );
    const room = await getPool().query<{ id: string }>(
      `INSERT INTO inventory_care_rooms(organization_id,unit_id,name)
       VALUES('a1100000-0000-4000-8000-000000000001',$1,$2) RETURNING id`,
      [unitId, `Sala de Procedimentos ${patientId.slice(0, 8)}`],
    );
    await getPool().query(
      `INSERT INTO inventory_care_resources(organization_id,unit_id,room_id,name)
       VALUES('a1100000-0000-4000-8000-000000000001',$1,$2,'Poltrona 1')`,
      [unitId, room.rows[0]!.id],
    );
    const startsAt = "2026-10-20T12:00:00.000Z";
    const endsAt = "2026-10-20T13:00:00.000Z";
    const body = {
      action: "CREATE",
      id: randomUUID(),
      unitId,
      patientId,
      professionalUserId: professional.rows[0]!.id,
      careType: "INJECTABLE",
      otherCareType: null,
      startsAt,
      endsAt,
      room: `Sala de Procedimentos ${patientId.slice(0, 8)}`,
      chair: null,
      resourceName: "Poltrona 1",
      notes: "Agendamento sintético.",
      status: "SCHEDULED",
      version: 0,
      reason: "Agendamento criado para teste integrado.",
    };
    const send = (value: unknown) =>
      careAppointmentsResponse(
        new Request(`${origin}/api/v1/inventory/care-appointments`, {
          method: "POST",
          headers: { cookie, origin, "Content-Type": "application/json" },
          body: JSON.stringify(value),
        }),
      );
    expect((await send(body)).status).toBe(201);
    expect(
      (
        await send({
          ...body,
          id: randomUUID(),
          startsAt: "2020-01-01T12:00:00.000Z",
          endsAt: "2020-01-01T13:00:00.000Z",
          reason: "Tentativa de criar atendimento em uma data passada.",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send({
          ...body,
          action: "UPDATE_STATUS",
          status: "NO_SHOW",
          reason: "Tentativa de registrar falta antes do fim do atendimento.",
        })
      ).status,
    ).toBe(409);
    const financeProfessional = await getPool().query<{ id: string }>(
      `INSERT INTO inventory_users(name,email,profession)
       VALUES('Financeiro não clínico',$1,'Médico') RETURNING id`,
      [`${randomUUID()}@example.test`],
    );
    await getPool().query(
      `INSERT INTO inventory_memberships(user_id,organization_id,role)
       VALUES($1,'a1100000-0000-4000-8000-000000000001','FINANCE')`,
      [financeProfessional.rows[0]!.id],
    );
    expect(
      (
        await send({
          ...body,
          id: randomUUID(),
          professionalUserId: financeProfessional.rows[0]!.id,
          reason: "Tentativa de selecionar perfil financeiro como profissional.",
        })
      ).status,
    ).toBe(400);
    const juazeiro = "a1100000-0000-4000-8000-000000000102";
    const otherPatientId = randomUUID();
    await getPool().query(
      `INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name)
       VALUES($1,'a1100000-0000-4000-8000-000000000001',$2,$3,'Paciente Agenda Juazeiro')`,
      [otherPatientId, juazeiro, `AGENDA-${otherPatientId.slice(0, 8)}`],
    );
    const otherRoomName = `Sala Juazeiro ${otherPatientId.slice(0, 8)}`;
    await getPool().query(
      `INSERT INTO inventory_care_rooms(organization_id,unit_id,name)
       VALUES('a1100000-0000-4000-8000-000000000001',$1,$2)`,
      [juazeiro, otherRoomName],
    );
    expect(
      (
        await send({
          ...body,
          id: randomUUID(),
          unitId: juazeiro,
          patientId: otherPatientId,
          room: otherRoomName,
          resourceName: null,
          reason: "Conflito simultâneo do profissional entre duas unidades.",
        })
      ).status,
    ).toBe(409);
    expect((await send({ ...body, id: randomUUID() })).status).toBe(409);
    const rescheduled = {
      ...body,
      action: "UPDATE",
      startsAt: "2026-10-20T14:00:00.000Z",
      endsAt: "2026-10-20T15:00:00.000Z",
      reason: "Atendimento remarcado durante o teste integrado.",
    };
    expect((await send(rescheduled)).status).toBe(200);
    expect(
      (
        await send({
          ...rescheduled,
          action: "UPDATE_STATUS",
          status: "CONFIRMED",
          version: 1,
          reason: "Atendimento confirmado durante o teste integrado.",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send({
          ...rescheduled,
          action: "UPDATE_STATUS",
          status: "COMPLETED",
          version: 2,
          reason: "Transição inválida exercitada durante o teste integrado.",
        })
      ).status,
    ).toBe(409);
    const listed = await careAppointmentsResponse(
      new Request(
        `${origin}/api/v1/inventory/care-appointments?unitId=${unitId}&from=2026-10-20T00:00:00.000Z&to=2026-10-21T00:00:00.000Z`,
        { headers: { cookie } },
      ),
    );
    expect(listed.status).toBe(200);
    const listedData = (await listed.json()).data;
    expect(listedData.appointments).toEqual([
      expect.objectContaining({
        id: body.id,
        patientName: "Paciente Agenda Sintético",
        careType: "INJECTABLE",
        resourceName: "Poltrona 1",
        status: "CONFIRMED",
        version: 2,
      }),
    ]);
    expect(listedData.patients).toEqual([]);
    const searched = await careAppointmentsResponse(
      new Request(
        `${origin}/api/v1/inventory/care-appointments?unitId=${unitId}&from=2026-10-20T00:00:00.000Z&to=2026-10-21T00:00:00.000Z&patientSearch=${encodeURIComponent(documentNumber)}`,
        { headers: { cookie } },
      ),
    );
    expect(searched.status).toBe(200);
    expect((await searched.json()).data.patients).toEqual([
      {
        id: patientId,
        unitId,
        fullName: "Paciente Agenda Sintético",
        phone: "+5585999999999",
        internalCode: `AGENDA-${patientId.slice(0, 8)}`,
      },
    ]);
    const encounter = await careEncounterResponse(
      new Request(`${origin}/api/v1/inventory/care-encounter?appointmentId=${body.id}`, {
        headers: { cookie },
      }),
    );
    expect(encounter.status).toBe(200);
    expect((await encounter.json()).data).toEqual(
      expect.objectContaining({
        appointment: expect.objectContaining({
          id: body.id,
          patientId,
          patientName: "Paciente Agenda Sintético",
          unitId,
        }),
        canManage: true,
      }),
    );
    const takeover = await getPool().query<{ id: string }>(
      `INSERT INTO inventory_users(name,email,profession,professional_council,council_number,council_region)
       VALUES('Profissional Substituto Sintético',$1,'Médico','CRM','54321','CE') RETURNING id`,
      [`${randomUUID()}@example.test`],
    );
    await getPool().query(
      `INSERT INTO inventory_memberships(user_id,organization_id,role)
       VALUES($1,'a1100000-0000-4000-8000-000000000001','SUPER_ADMIN')`,
      [takeover.rows[0]!.id],
    );
    const takeoverToken = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [takeover.rows[0]!.id, hashToken(takeoverToken)],
    );
    const claim = (sessionCookie: string, version: number) =>
      careEncounterResponse(
        new Request(`${origin}/api/v1/inventory/care-encounter`, {
          method: "POST",
          headers: { cookie: sessionCookie, origin, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "CLAIM", appointmentId: body.id, version }),
        }),
      );
    expect((await claim(`allik_inventory_session=${takeoverToken}`, 2)).status).toBe(200);
    expect((await claim(professionalCookie, 3)).status).toBe(200);
    expect(
      (
        await getPool().query(
          "SELECT action,reason FROM inventory_care_appointment_changes WHERE appointment_id=$1 AND action='REASSIGN' ORDER BY created_at",
          [body.id],
        )
      ).rows,
    ).toEqual([
      expect.objectContaining({
        action: "REASSIGN",
        reason: expect.stringContaining("Profissional Substituto Sintético"),
      }),
      expect.objectContaining({
        action: "REASSIGN",
        reason: expect.stringContaining("Profissional Agenda Sintético"),
      }),
    ]);
    const clinicalPost = (value: unknown, sessionCookie = professionalCookie) =>
      careEncounterResponse(
        new Request(`${origin}/api/v1/inventory/care-encounter`, {
          method: "POST",
          headers: { cookie: sessionCookie, origin, "Content-Type": "application/json" },
          body: JSON.stringify(value),
        }),
      );
    const draft = {
      action: "SAVE_DRAFT",
      appointmentId: body.id,
      evolution: "Paciente avaliado durante atendimento sintético.",
      conduct: "Manter acompanhamento operacional.",
      diagnosticHypotheses: "Hipótese clínica sintética em avaliação.",
      clinicalPlan: "Solicitar exames sintéticos e acompanhar evolução.",
      returnRecommendation: "Retorno após os exames sintéticos.",
      returnOn: "2026-11-12",
      chiefComplaint: "Avaliação clínica sintética.",
      currentHistory: "História atual registrada apenas para o teste integrado.",
      personalHistory: "Antecedente pessoal sintético.",
      familyHistory: "Antecedente familiar sintético.",
      habits: "Hábitos sintéticos sem dados reais.",
      systemsReview: "Revisão sintética sem alterações.",
      generalExam: "Estado geral sintético preservado.",
      cardiovascularExam: "Exame cardiovascular sintético sem alterações.",
      respiratoryExam: "Exame respiratório sintético sem alterações.",
      abdominalExam: "Exame abdominal sintético sem alterações.",
      neurologicalExam: "Exame neurológico sintético sem alterações.",
      musculoskeletalExam: "Exame musculoesquelético sintético sem alterações.",
      skinExam: "Exame sintético de pele sem alterações.",
      otherExam: "Sem outros achados sintéticos.",
      systolicPressure: 120,
      diastolicPressure: 80,
      heartRate: 72,
      oxygenSaturation: 98,
      temperatureC: 36.5,
      weightKg: 70.5,
      heightCm: 175,
      version: null,
    };
    expect((await clinicalPost(draft)).status).toBe(201);
    expect((await claim(`allik_inventory_session=${takeoverToken}`, 4)).status).toBe(200);
    expect((await claim(professionalCookie, 5)).status).toBe(200);
    expect((await clinicalPost({ ...draft, version: null })).status).toBe(409);
    expect((await clinicalPost({ ...draft, action: "FINALIZE", version: 2 })).status).toBe(200);
    expect((await clinicalPost({ ...draft, version: 3 })).status).toBe(409);
    const prescribedProduct = await getPool().query<{ id: string; name: string }>(
      `SELECT id,name FROM inventory_products
       WHERE organization_id='a1100000-0000-4000-8000-000000000001' AND active
       ORDER BY name LIMIT 1`,
    );
    const prescriptionPost = (value: unknown, sessionCookie = professionalCookie) =>
      encounterPrescriptionsResponse(
        new Request(`${origin}/api/v1/inventory/encounter-prescriptions`, {
          method: "POST",
          headers: { cookie: sessionCookie, origin, "Content-Type": "application/json" },
          body: JSON.stringify(value),
        }),
      );
    const prescriptionDraft = {
      action: "SAVE_DRAFT",
      appointmentId: body.id,
      items: [
        {
          id: randomUUID(),
          productId: prescribedProduct.rows[0]!.id,
          medicationName: "Nome enviado pelo cliente não deve prevalecer",
          doseQuantity: 2.5,
          doseUnit: "MG",
          doseUnitOther: "",
          route: "Subcutânea",
          frequencyEvery: 1,
          frequencyUnit: "WEEK",
          durationAmount: 4,
          durationUnit: "WEEK",
          continuousUse: false,
          plannedAdministrations: 4,
          instructions: "Aplicar conforme avaliação clínica.",
        },
      ],
      generalInstructions: "Retornar em quatro semanas para reavaliação.",
      version: null,
    };
    expect((await prescriptionPost(prescriptionDraft)).status).toBe(201);
    expect(
      (
        await prescriptionPost({
          ...prescriptionDraft,
          action: "FINALIZE",
          version: 0,
        })
      ).status,
    ).toBe(200);
    expect((await prescriptionPost({ ...prescriptionDraft, version: 1 })).status).toBe(409);
    const prescriptionGet = await encounterPrescriptionsResponse(
      new Request(`${origin}/api/v1/inventory/encounter-prescriptions?appointmentId=${body.id}`, {
        headers: { cookie: professionalCookie },
      }),
    );
    expect(prescriptionGet.status).toBe(200);
    expect((await prescriptionGet.json()).data.prescription).toEqual(
      expect.objectContaining({
        status: "FINAL",
        version: 1,
        generalInstructions: "Retornar em quatro semanas para reavaliação.",
        items: [
          expect.objectContaining({
            medicationName: prescribedProduct.rows[0]!.name,
            doseQuantity: 2.5,
            frequencyEvery: 1,
            frequencyUnit: "WEEK",
            durationAmount: 4,
            durationUnit: "WEEK",
            plannedAdministrations: 4,
          }),
        ],
      }),
    );
    await expect(
      getPool().query(
        `UPDATE inventory_encounter_prescriptions SET general_instructions='alteração indevida'
         WHERE appointment_id=$1`,
        [body.id],
      ),
    ).rejects.toThrow(/immutable/);
    expect(
      (
        await getPool().query(
          `SELECT action FROM inventory_encounter_prescription_changes
           WHERE prescription_id=(SELECT id FROM inventory_encounter_prescriptions WHERE appointment_id=$1)
           ORDER BY created_at`,
          [body.id],
        )
      ).rows,
    ).toEqual([{ action: "CREATE" }, { action: "FINALIZE" }]);
    const pricing = await getPool().query<{ id: string }>(
      `INSERT INTO inventory_pricing_presentations(
         organization_id,product_id,name,base_unit,total_base_quantity,acquisition_cost,
         technical_loss_percent,additional_presentation_cost,minimum_measurable_volume_ml,
         beyond_use_hours,pricing_status,cost_source,cost_valid_on,assumptions_confirmed,
         validated_at,validated_by_actor,validated_by_user_id,created_by_user_id)
       VALUES('a1100000-0000-4000-8000-000000000001',$1,$2,'MG',20,100,10,0,0.01,24,
         'VALIDATED','Documento sintético','2026-10-12',true,now(),'Profissional Agenda Sintético',$3,$3)
       RETURNING id`,
      [
        prescribedProduct.rows[0]!.id,
        `Apresentação sintética ${randomUUID()}`,
        professional.rows[0]!.id,
      ],
    );
    const pricedDose = await getPool().query<{ id: string }>(
      `INSERT INTO inventory_pricing_doses(presentation_id,name,dose_quantity,sale_price,material_cost)
       VALUES($1,'Dose sintética 2,5 mg',2.5,200,2) RETURNING id`,
      [pricing.rows[0]!.id],
    );
    const quotePost = (value: unknown, sessionCookie = professionalCookie) =>
      encounterQuotesResponse(
        new Request(`${origin}/api/v1/inventory/encounter-quotes`, {
          method: "POST",
          headers: { cookie: sessionCookie, origin, "Content-Type": "application/json" },
          body: JSON.stringify(value),
        }),
      );
    const quoteDraft = {
      action: "SAVE_DRAFT",
      appointmentId: body.id,
      selections: [
        {
          prescriptionItemId: prescriptionDraft.items[0]!.id,
          pricingDoseId: pricedDose.rows[0]!.id,
          quantity: 4,
        },
      ],
      commercialNotes: "Condição comercial sintética.",
      version: null,
    };
    expect((await quotePost(quoteDraft)).status).toBe(201);
    expect((await quotePost({ ...quoteDraft, action: "ISSUE", version: 0 })).status).toBe(200);
    expect((await quotePost({ ...quoteDraft, version: 1 })).status).toBe(409);
    const quoteGet = await encounterQuotesResponse(
      new Request(`${origin}/api/v1/inventory/encounter-quotes?appointmentId=${body.id}`, {
        headers: { cookie: professionalCookie },
      }),
    );
    expect(quoteGet.status).toBe(200);
    expect((await quoteGet.json()).data.quote).toEqual(
      expect.objectContaining({
        status: "ISSUED",
        totalSale: "800.00",
        estimatedCost: "63.5556",
        grossResult: "736.4444",
      }),
    );
    await expect(
      getPool().query(
        `UPDATE inventory_encounter_quotes SET commercial_notes='alteração indevida'
         WHERE appointment_id=$1`,
        [body.id],
      ),
    ).rejects.toThrow(/immutable/);
    expect(
      (
        await getPool().query(
          `SELECT action FROM inventory_encounter_quote_changes
           WHERE quote_id=(SELECT id FROM inventory_encounter_quotes WHERE appointment_id=$1)
           ORDER BY created_at`,
          [body.id],
        )
      ).rows,
    ).toEqual([{ action: "CREATE" }, { action: "ISSUE" }]);
    const storedNote = await getPool().query(
      `SELECT status,author_name AS "authorName",professional_council AS council,
        council_number AS "councilNumber",version,
        diagnostic_hypotheses AS "diagnosticHypotheses",clinical_plan AS "clinicalPlan",
        return_on::text AS "returnOn"
       FROM inventory_clinical_notes WHERE appointment_id=$1`,
      [body.id],
    );
    expect(storedNote.rows).toEqual([
      {
        status: "FINAL",
        authorName: "Profissional Agenda Sintético",
        council: "CRM",
        councilNumber: "12345",
        version: 3,
        diagnosticHypotheses: "Hipótese clínica sintética em avaliação.",
        clinicalPlan: "Solicitar exames sintéticos e acompanhar evolução.",
        returnOn: "2026-11-12",
      },
    ]);
    const longitudinal = await patientDetailResponse(
      new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        headers: { cookie: professionalCookie },
      }),
    );
    expect(longitudinal.status).toBe(200);
    expect((await longitudinal.json()).data.clinicalHistory).toEqual([
      expect.objectContaining({
        appointmentId: body.id,
        evolution: "Paciente avaliado durante atendimento sintético.",
        diagnosticHypotheses: "Hipótese clínica sintética em avaliação.",
        clinicalPlan: "Solicitar exames sintéticos e acompanhar evolução.",
        returnRecommendation: "Retorno após os exames sintéticos.",
        returnOn: "2026-11-12",
        chiefComplaint: "Avaliação clínica sintética.",
        currentHistory: "História atual registrada apenas para o teste integrado.",
        generalExam: "Estado geral sintético preservado.",
        cardiovascularExam: "Exame cardiovascular sintético sem alterações.",
        systolicPressure: 120,
        diastolicPressure: 80,
        authorName: "Profissional Agenda Sintético",
      }),
    ]);
    const problemId = randomUUID();
    const clinicalProblem = {
      action: "CREATE",
      id: problemId,
      patientId,
      description: "Antecedente clínico sintético",
      icd10Code: "Z00.0",
      onsetOn: "2026-01-10",
      resolvedOn: null,
      status: "ACTIVE",
      notes: "Registro criado exclusivamente para o teste integrado.",
      reason: "Inclusão após avaliação profissional sintética.",
      version: 0,
    };
    const problemPost = (value: unknown, sessionCookie = professionalCookie) =>
      clinicalProblemsResponse(
        new Request(`${origin}/api/v1/inventory/clinical-problems`, {
          method: "POST",
          headers: { cookie: sessionCookie, origin, "Content-Type": "application/json" },
          body: JSON.stringify(value),
        }),
      );
    expect((await problemPost(clinicalProblem)).status).toBe(201);
    expect(
      (
        await problemPost({
          ...clinicalProblem,
          action: "UPDATE",
          status: "RESOLVED",
          resolvedOn: "2026-02-10",
          reason: "Resolução registrada após reavaliação profissional.",
        })
      ).status,
    ).toBe(200);
    expect((await problemPost({ ...clinicalProblem, action: "UPDATE" })).status).toBe(409);
    const record = await patientDetailResponse(
      new Request(`${origin}/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        headers: { cookie: professionalCookie },
      }),
    );
    expect((await record.json()).data.clinicalProblems).toEqual([
      expect.objectContaining({
        id: problemId,
        status: "RESOLVED",
        icd10Code: "Z00.0",
        version: 1,
      }),
    ]);
    await expect(
      getPool().query("DELETE FROM inventory_patient_clinical_problems WHERE id=$1", [problemId]),
    ).rejects.toThrow(/cannot be deleted/);
    const alertId = randomUUID();
    const clinicalAlert = {
      action: "CREATE",
      id: alertId,
      patientId,
      type: "ALLERGY",
      title: "Substância sintética de teste",
      reaction: "Reação sintética moderada",
      severity: "MODERATE",
      status: "ACTIVE",
      notes: "Alerta criado exclusivamente para validação integrada.",
      reason: "Inclusão após avaliação profissional sintética.",
      version: 0,
    };
    const alertPost = (value: unknown) =>
      clinicalAlertsResponse(
        new Request(`${origin}/api/v1/inventory/clinical-alerts`, {
          method: "POST",
          headers: { cookie: professionalCookie, origin, "Content-Type": "application/json" },
          body: JSON.stringify(value),
        }),
      );
    expect((await alertPost(clinicalAlert)).status).toBe(201);
    const encounterWithAlert = await careEncounterResponse(
      new Request(`${origin}/api/v1/inventory/care-encounter?appointmentId=${body.id}`, {
        headers: { cookie: professionalCookie },
      }),
    );
    expect((await encounterWithAlert.json()).data.clinicalAlerts).toEqual([
      expect.objectContaining({ id: alertId, severity: "MODERATE" }),
    ]);
    expect(
      (
        await alertPost({
          ...clinicalAlert,
          action: "UPDATE",
          status: "INACTIVE",
          reason: "Alerta inativado após reavaliação profissional.",
        })
      ).status,
    ).toBe(200);
    expect((await alertPost({ ...clinicalAlert, action: "UPDATE" })).status).toBe(409);
    await expect(
      getPool().query("DELETE FROM inventory_patient_clinical_alerts WHERE id=$1", [alertId]),
    ).rejects.toThrow(/cannot be deleted/);
    await expect(
      getPool().query(
        "UPDATE inventory_clinical_notes SET evolution='alterada' WHERE appointment_id=$1",
        [body.id],
      ),
    ).rejects.toThrow(/immutable|append-only/);
    await expect(
      getPool().query(
        "DELETE FROM inventory_clinical_note_changes WHERE clinical_note_id=(SELECT id FROM inventory_clinical_notes WHERE appointment_id=$1)",
        [body.id],
      ),
    ).rejects.toThrow(/immutable|append-only/);
    const juazeiroManager = await scopedCookie(juazeiro, "UNIT_MANAGER");
    expect(
      (
        await careEncounterResponse(
          new Request(`${origin}/api/v1/inventory/care-encounter?appointmentId=${body.id}`, {
            headers: { cookie: juazeiroManager },
          }),
        )
      ).status,
    ).toBe(404);
    const audit = await getPool().query(
      "SELECT action,actor FROM inventory_care_appointment_changes WHERE appointment_id=$1",
      [body.id],
    );
    expect(audit.rows).toEqual([
      expect.objectContaining({ action: "CREATE" }),
      expect.objectContaining({ action: "RESCHEDULE" }),
      expect.objectContaining({ action: "STATUS" }),
      expect.objectContaining({ action: "REASSIGN", actor: "Profissional Substituto Sintético" }),
      expect.objectContaining({ action: "REASSIGN", actor: "Profissional Agenda Sintético" }),
      expect.objectContaining({ action: "REASSIGN", actor: "Profissional Substituto Sintético" }),
      expect.objectContaining({ action: "REASSIGN", actor: "Profissional Agenda Sintético" }),
    ]);
    expect(
      (
        await send({
          ...rescheduled,
          action: "UPDATE_STATUS",
          status: "IN_PROGRESS",
          version: 6,
          reason: "Atendimento iniciado durante o teste integrado.",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send({
          ...rescheduled,
          action: "UPDATE_STATUS",
          status: "COMPLETED",
          version: 7,
          reason: "Atendimento concluído durante o teste integrado.",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send({
          ...rescheduled,
          action: "UPDATE",
          status: "COMPLETED",
          version: 8,
          reason: "Tentativa de remarcar atendimento já concluído.",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send({
          ...rescheduled,
          action: "CREATE",
          id: randomUUID(),
          version: 0,
          status: "SCHEDULED",
          reason: "Novo atendimento após liberação antecipada do horário.",
        })
      ).status,
    ).toBe(201);
  });
});

describe("PostgreSQL direct applications", () => {
  async function applicationFixture(days = 90) {
    const f = await fixture("10", days);
    return {
      operationId: randomUUID(),
      patientRef: "demo-patient-a",
      reference: `AP-${randomUUID()}`,
      service: "Procedimento sintético",
      professional: "Executor sintético",
      locationId: String(f.params[1]),
      items: [{ productId: f.productId, lotId: String(f.params[0]), quantity: "2.125" }],
    };
  }
  const apply = (body: unknown) => applicationResponse(receivingRequest(body));
  async function quantity(lotId: string, locationId: string) {
    return (
      await getPool().query(
        "SELECT quantity::text FROM inventory_balances WHERE lot_id=$1 AND location_id=$2",
        [lotId, locationId],
      )
    ).rows[0].quantity;
  }
  it("confirms exactly once under concurrent replay and links stock, audit and application history", async () => {
    const body = await applicationFixture();
    const responses = await Promise.all([apply(body), apply(body)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("7.875");
    const ledger = await getPool().query(
      "SELECT m.delta::text,m.actor,(SELECT count(*)::int FROM inventory_audit au WHERE au.movement_id=m.id) AS audits FROM inventory_application_movements am JOIN inventory_movements m ON m.id=am.movement_id WHERE am.application_id=$1",
      [body.operationId],
    );
    expect(ledger.rows).toEqual([{ delta: "-2.125", actor: "preview-operator", audits: 1 }]);
    const history = await applicationResponse(request("applications"));
    expect(history.headers.get("cache-control")).toContain("no-store");
    const saved = (await history.json()).data.find(
      (application: { id: string }) => application.id === body.operationId,
    );
    expect(saved).toMatchObject({
      patientRef: "demo-patient-a",
      reference: body.reference,
      professional: body.professional,
    });
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0]).toMatchObject({ lotId: body.items[0]!.lotId, quantity: "2.125" });
    const movementHistory = await inventoryResponse(request(`movements?search=${body.reference}`));
    expect((await movementHistory.json()).data[0].applicationId).toBe(body.operationId);
  });
  it("rejects changed replays and duplicate references without a second withdrawal", async () => {
    const body = await applicationFixture();
    expect((await apply(body)).status).toBe(201);
    expect((await apply({ ...body, service: "Outro procedimento" })).status).toBe(409);
    expect((await apply({ ...body, operationId: randomUUID() })).status).toBe(409);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("7.875");
  });
  it("serializes competing applications without overspending", async () => {
    const body = await applicationFixture();
    body.items[0]!.quantity = "6";
    const second = { ...body, operationId: randomUUID(), reference: `AP-${randomUUID()}` };
    const responses = await Promise.all([apply(body), apply(second)]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("4.000");
  });
  it("refuses the entire application when a later item has insufficient stock", async () => {
    const body = await applicationFixture();
    const second = await fixture("3");
    await movement([second.params[0], body.locationId], "3", "IN");
    body.items.push({
      productId: second.productId,
      lotId: String(second.params[0]),
      quantity: "4",
    });
    expect((await apply(body)).status).toBe(409);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("10.000");
    expect(await quantity(body.items[1]!.lotId, body.locationId)).toBe("3.000");
    expect(
      (
        await getPool().query("SELECT id FROM inventory_applications WHERE id=$1", [
          body.operationId,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await getPool().query("SELECT id FROM inventory_movements WHERE reference=$1", [
          body.reference,
        ])
      ).rowCount,
    ).toBe(0);
    body.items[1]!.quantity = "1.125";
    expect((await apply(body)).status).toBe(201);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("7.875");
    expect(await quantity(body.items[1]!.lotId, body.locationId)).toBe("1.875");
  });
  it("accepts today's validity but rejects expired and quarantined lots", async () => {
    const expired = await applicationFixture(-1);
    expect((await apply(expired)).status).toBe(409);
    const today = await applicationFixture(0);
    expect((await apply(today)).status).toBe(201);
    const blocked = await applicationFixture();
    await getPool().query("UPDATE inventory_lots SET status='QUARANTINED' WHERE id=$1", [
      blocked.items[0]!.lotId,
    ]);
    expect((await apply(blocked)).status).toBe(409);
  });
  it("rolls back an earlier withdrawal when a later movement fails in the database", async () => {
    const body = await applicationFixture();
    const second = await fixture();
    await movement([second.params[0], body.locationId], "10", "IN");
    body.items.push({
      productId: second.productId,
      lotId: String(second.params[0]),
      quantity: "1",
    });
    const name = `test_application_failure_${randomUUID().replaceAll("-", "")}`;
    // Fault injection in the disposable test database, after the first item is written.
    await getPool().query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.reference='${body.reference}' AND NEW.lot_id='${second.params[0]}'::uuid THEN RAISE EXCEPTION 'Synthetic later movement failure'; END IF; RETURN NEW; END; $$`);
    await getPool().query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      expect((await apply(body)).status).toBe(503);
      expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("10.000");
      expect(await quantity(body.items[1]!.lotId, body.locationId)).toBe("10.000");
      expect(
        (
          await getPool().query("SELECT id FROM inventory_applications WHERE id=$1", [
            body.operationId,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await getPool().query("SELECT id FROM inventory_movements WHERE reference=$1", [
            body.reference,
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      await getPool().query(`DROP TRIGGER ${name} ON inventory_movements`);
      await getPool().query(`DROP FUNCTION ${name}()`);
    }
    expect((await apply(body)).status).toBe(201);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("7.875");
  });
  it("locks multi-item applications consistently even when item order is reversed", async () => {
    const body = await applicationFixture();
    const second = await fixture();
    await movement([second.params[0], body.locationId], "10", "IN");
    body.items[0]!.quantity = "6";
    body.items.push({
      productId: second.productId,
      lotId: String(second.params[0]),
      quantity: "6",
    });
    const reversed = {
      ...body,
      operationId: randomUUID(),
      reference: `AP-${randomUUID()}`,
      items: [...body.items].reverse(),
    };
    const responses = await Promise.all([apply(body), apply(reversed)]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("4.000");
    expect(await quantity(body.items[1]!.lotId, body.locationId)).toBe("4.000");
  });
  it("rejects inactive products and locations and products without stock control", async () => {
    const body = await applicationFixture();
    await getPool().query("UPDATE inventory_products SET active=false WHERE id=$1", [
      body.items[0]!.productId,
    ]);
    expect((await apply(body)).status).toBe(409);
    await getPool().query(
      "UPDATE inventory_products SET active=true,stock_controlled=false WHERE id=$1",
      [body.items[0]!.productId],
    );
    expect((await apply(body)).status).toBe(409);
    await getPool().query("UPDATE inventory_products SET stock_controlled=true WHERE id=$1", [
      body.items[0]!.productId,
    ]);
    await getPool().query("UPDATE inventory_locations SET active=false WHERE id=$1", [
      body.locationId,
    ]);
    expect((await apply(body)).status).toBe(409);
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("10.000");
  });
  it("rejects mismatched products and stock from a different local", async () => {
    const body = await applicationFixture();
    const unrelated = await fixture();
    expect(
      (await apply({ ...body, items: [{ ...body.items[0], productId: unrelated.productId }] }))
        .status,
    ).toBe(409);
    expect((await apply({ ...body, locationId: String(unrelated.params[1]) })).status).toBe(409);
  });
  it("rejects repeated lots and real patient references before accessing stock", async () => {
    const body = await applicationFixture();
    expect((await apply({ ...body, items: [body.items[0], body.items[0]] })).status).toBe(400);
    expect((await apply({ ...body, patientRef: "external-patient" })).status).toBe(400);
    expect((await apply({ ...body, items: [{ ...body.items[0], quantity: "0" }] })).status).toBe(
      400,
    );
    expect(await quantity(body.items[0]!.lotId, body.locationId)).toBe("10.000");
  });
  it("protects application history and requires same-origin Preview authentication", async () => {
    const body = await applicationFixture();
    expect((await applicationResponse(new Request(origin))).status).toBe(401);
    expect(
      (
        await applicationResponse(
          new Request(origin, {
            method: "POST",
            headers: { cookie, origin: "https://other.invalid" },
          }),
        )
      ).status,
    ).toBe(403);
    expect((await apply(body)).status).toBe(201);
    await expect(
      getPool().query("UPDATE inventory_applications SET reference='EDITED' WHERE id=$1", [
        body.operationId,
      ]),
    ).rejects.toThrow("append-only");
    await expect(
      getPool().query("DELETE FROM inventory_application_movements WHERE application_id=$1", [
        body.operationId,
      ]),
    ).rejects.toThrow("append-only");
  });
});
describe("Lot traceability", () => {
  it("limits lot balances and events to authorized units and rejects a forged unit", async () => {
    const f = await fixture("7");
    const fortaleza = "a1100000-0000-4000-8000-000000000101";
    const juazeiro = "a1100000-0000-4000-8000-000000000102";
    const fortalezaLocation = await getPool().query<{ id: string }>(
      "INSERT INTO inventory_locations(unit_id,name) VALUES($1,$2) RETURNING id",
      [fortaleza, `Fortaleza ${randomUUID()}`],
    );
    await movement([f.params[0], fortalezaLocation.rows[0]!.id], "3", "IN");
    const unitCookie = await scopedCookie(fortaleza);
    const visible = await lotTraceResponse(
      new Request(`${origin}/api/v1/inventory/trace/lots/${f.params[0]}`, {
        headers: { cookie: unitCookie },
      }),
    );
    expect(visible.status).toBe(200);
    const body = (await visible.json()).data;
    expect(body.balances).toHaveLength(1);
    expect(body.balances[0].locationId).toBe(fortalezaLocation.rows[0]!.id);
    expect(body.events).toHaveLength(1);
    const forged = await lotTraceResponse(
      new Request(`${origin}/api/v1/inventory/trace/lots/${f.params[0]}?unitId=${juazeiro}`, {
        headers: { cookie: unitCookie },
      }),
    );
    expect(forged.status).toBe(403);
  });
  it("links two deliveries, a transfer, an application and a count to the same lot and reconciles every local", async () => {
    const f = await fixture();
    const supplierId = randomUUID();
    const supplier = `Fornecedor de rastreio ${supplierId}`;
    expect(
      (await purchasingResponse(receivingRequest({ id: supplierId, name: supplier }), "suppliers"))
        .status,
    ).toBe(201);
    const purchaseId = randomUUID();
    const reference = `PO-${purchaseId}`;
    expect(
      (
        await purchasingResponse(
          receivingRequest({
            id: purchaseId,
            reference,
            supplierId,
            items: [{ productId: f.productId, quantity: "10", unitCost: "2" }],
          }),
          "purchases",
        )
      ).status,
    ).toBe(201);
    const purchaseItemId = (
      await getPool().query("SELECT id FROM inventory_purchase_items WHERE purchase_id=$1", [
        purchaseId,
      ])
    ).rows[0].id;
    const firstReceipt = randomUUID();
    const secondReceipt = randomUUID();
    const number = `TRACE-${randomUUID()}`;
    const receipt = {
      operationId: firstReceipt,
      purchaseId,
      reference,
      supplier,
      locationId: String(f.params[1]),
      items: [
        {
          purchaseItemId,
          productId: f.productId,
          lot: number,
          expiry: "2099-01-01",
          quantity: "6",
          unitCost: "2",
        },
      ],
    };
    expect((await receivingResponse(receivingRequest(receipt))).status).toBe(201);
    expect(
      (
        await receivingResponse(
          receivingRequest({
            ...receipt,
            operationId: secondReceipt,
            items: [{ ...receipt.items[0], quantity: "4" }],
          }),
        )
      ).status,
    ).toBe(201);
    const lotId = (
      await getPool().query("SELECT id FROM inventory_lots WHERE product_id=$1 AND number=$2", [
        f.productId,
        number,
      ])
    ).rows[0].id as string;
    const destination = (
      await getPool().query(
        "INSERT INTO inventory_locations(unit_id,name) VALUES('a1100000-0000-4000-8000-000000000102',$1) RETURNING id",
        [`Destino trace ${randomUUID()}`],
      )
    ).rows[0].id as string;
    const operationId = randomUUID();
    expect(
      (
        await stockOperationResponse(
          receivingRequest({
            operationId,
            lotId,
            sourceId: f.params[1],
            destinationId: destination,
            quantity: "4",
            reference: `TR-${operationId}`,
            reason: "Reposição sintética de unidade",
          }),
          "TRANSFER",
        )
      ).status,
    ).toBe(201);
    const applicationId = randomUUID();
    const applicationReference = `AP-${applicationId}`;
    expect(
      (
        await applicationResponse(
          receivingRequest({
            operationId: applicationId,
            patientRef: "demo-patient-b",
            reference: applicationReference,
            service: "Procedimento sintético",
            professional: "Executor sintético",
            locationId: destination,
            items: [{ productId: f.productId, lotId, quantity: "1" }],
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await stockOperationResponse(
          receivingRequest({
            operationId: randomUUID(),
            lotId,
            locationId: destination,
            expectedQuantity: "3",
            countedQuantity: "2.875",
            reference: `CT-${randomUUID()}`,
            reason: "Diferença na contagem física",
          }),
          "ADJUSTMENT",
        )
      ).status,
    ).toBe(201);
    const response = await lotTraceResponse(request(`trace/lots/${lotId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const trace = (await response.json()).data;
    expect(trace.lot).toMatchObject({ id: lotId, number, supplier, productId: f.productId });
    expect(trace.summary).toMatchObject({
      received: "10.000",
      consumed: "1.000",
      adjusted: "-0.125",
      ledgerQuantity: "8.875",
      balanceQuantity: "8.875",
      totalEvents: 6,
      auditEntries: 6,
      auditedEvents: 6,
      reconciled: true,
    });
    expect(trace.balances.every((balance: { matches: boolean }) => balance.matches)).toBe(true);
    expect(
      trace.balances.find((balance: { locationId: string }) => balance.locationId === destination)
        .quantity,
    ).toBe("2.875");
    const receipts = trace.events.filter((event: { receiptId: string | null }) => event.receiptId);
    expect(new Set(receipts.map((event: { receiptId: string }) => event.receiptId))).toEqual(
      new Set([firstReceipt, secondReceipt]),
    );
    expect(
      receipts.every(
        (event: { purchaseId: string; supplierId: string }) =>
          event.purchaseId === purchaseId && event.supplierId === supplierId,
      ),
    ).toBe(true);
    expect(
      trace.events.filter((event: { operationId: string }) => event.operationId === operationId),
    ).toHaveLength(2);
    expect(
      trace.events.find(
        (event: { applicationId: string }) => event.applicationId === applicationId,
      ),
    ).toMatchObject({ applicationReference, patientRef: "demo-patient-b", quantity: "-1.000" });
    expect(trace.events.every((event: { audit: unknown[] }) => event.audit.length === 1)).toBe(
      true,
    );
    expect(trace.nextCursor).toBeNull();
    expect(JSON.stringify(trace)).not.toContain("request_hash");
  });
  it("links direct receipts explicitly even when two operations share the same reference", async () => {
    const f = await fixture();
    const reference = `DIRECT-${randomUUID()}`;
    const body = {
      operationId: randomUUID(),
      reference,
      supplier: "Fornecedor direto sintético",
      locationId: String(f.params[1]),
      items: [
        {
          productId: f.productId,
          lot: `DIRECT-${randomUUID()}`,
          expiry: "2099-01-01",
          quantity: "2",
          unitCost: "2",
        },
      ],
    };
    expect((await receivingResponse(receivingRequest(body))).status).toBe(201);
    const second = {
      ...body,
      operationId: randomUUID(),
      items: [{ ...body.items[0], quantity: "3" }],
    };
    expect((await receivingResponse(receivingRequest(second))).status).toBe(201);
    const lot = (
      await getPool().query("SELECT id FROM inventory_lots WHERE product_id=$1 AND number=$2", [
        f.productId,
        body.items[0]!.lot,
      ])
    ).rows[0].id;
    const trace = (await (await lotTraceResponse(request(`trace/lots/${lot}`))).json()).data;
    expect(trace.events).toHaveLength(2);
    expect(new Set(trace.events.map((event: { receiptId: string }) => event.receiptId))).toEqual(
      new Set([body.operationId, second.operationId]),
    );
    expect(
      trace.events.every((event: { purchaseId: string | null }) => event.purchaseId === null),
    ).toBe(true);
    await expect(
      getPool().query("DELETE FROM inventory_receipt_movements WHERE receipt_id=$1", [
        body.operationId,
      ]),
    ).rejects.toThrow("append-only");
  });
  it("backfills old receipt links from operation UUIDs and ignores seed and withdrawal keys", async () => {
    const migration = await readFile("drizzle/0005_colorful_susan_delgado.sql", "utf8");
    const backfill = migration
      .split("--> statement-breakpoint")
      .find((statement) => statement.includes("INSERT INTO inventory_receipt_movements"))!;
    const client = await getPool().connect();
    const schema = `test_legacy_trace_${randomUUID().replaceAll("-", "")}`;
    const receiptIds = [randomUUID(), randomUUID()];
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema},public`);
      await client.query(
        "CREATE TABLE inventory_receipts(id uuid PRIMARY KEY,reference text); CREATE TABLE inventory_movements(id uuid PRIMARY KEY,operation_key text,type text,reference text); CREATE TABLE inventory_receipt_movements(movement_id uuid PRIMARY KEY,receipt_id uuid)",
      );
      await client.query(
        "INSERT INTO inventory_receipts VALUES($1,'SAME-REF'),($2,'SAME-REF')",
        receiptIds,
      );
      await client.query(
        "INSERT INTO inventory_movements VALUES($1,$2,'IN','SAME-REF'),($3,$4,'IN','SAME-REF'),($5,'seed-m1:TEST','IN','SAME-REF'),($6,$7,'OUT','SAME-REF')",
        [
          ids[0],
          `${receiptIds[0]!.toUpperCase()}:0`,
          ids[1],
          `${receiptIds[1]}:1`,
          ids[2],
          ids[3],
          `${receiptIds[0]}:2`,
        ],
      );
      await client.query(backfill);
      await client.query(backfill);
      const links = (
        await client.query("SELECT movement_id,receipt_id FROM inventory_receipt_movements")
      ).rows;
      expect(links).toHaveLength(2);
      expect(links).toEqual(
        expect.arrayContaining([
          { movement_id: ids[0], receipt_id: receiptIds[0] },
          { movement_id: ids[1], receipt_id: receiptIds[1] },
        ]),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("paginates identical timestamps without dropping or duplicating movements", async () => {
    const f = await fixture();
    await getPool().query(
      "INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,reference,reason,operation_key) SELECT $1,$2,'IN',1,'test','PAGE-TEST','Histórico sintético de paginação',gen_random_uuid()::text FROM generate_series(1,60)",
      f.params,
    );
    const first = (await (await lotTraceResponse(request(`trace/lots/${f.params[0]}`))).json())
      .data;
    expect(first.events).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const next = (
      await (
        await lotTraceResponse(
          request(`trace/lots/${f.params[0]}?cursor=${encodeURIComponent(first.nextCursor)}`),
        )
      ).json()
    ).data;
    expect(next.events).toHaveLength(11);
    expect(next.nextCursor).toBeNull();
    expect(
      new Set([...first.events, ...next.events].map((event: { id: string }) => event.id)).size,
    ).toBe(61);
    expect(first.summary.totalEvents).toBe(61);
    expect(next.summary.reconciled).toBe(true);
  });
  it("retains zero balances, expired lots and inactive locations for historical inspection", async () => {
    const f = await fixture("10", -1);
    await movement(f.params, "-10", "ADJUSTMENT");
    await getPool().query("UPDATE inventory_locations SET active=false WHERE id=$1", [f.params[1]]);
    const trace = (await (await lotTraceResponse(request(`trace/lots/${f.params[0]}`))).json())
      .data;
    expect(trace.lot.status).toBe("EXPIRED");
    expect(trace.summary.balanceQuantity).toBe("0.000");
    expect(trace.balances).toHaveLength(1);
    expect(trace.balances[0]).toMatchObject({ active: false, quantity: "0.000", matches: true });
    expect(trace.events).toHaveLength(2);
  });
  it("requires authentication and validates lot and pagination before queries", async () => {
    expect(
      (await lotTraceResponse(new Request(`${origin}/api/v1/inventory/trace/lots/${randomUUID()}`)))
        .status,
    ).toBe(401);
    expect((await lotTraceResponse(request("trace/lots/invalid"))).status).toBe(400);
    expect(
      (await lotTraceResponse(request(`trace/lots/${randomUUID()}?cursor=invalid`))).status,
    ).toBe(400);
    expect((await lotTraceResponse(request(`trace/lots/${randomUUID()}`))).status).toBe(404);
  });
});
describe("Pilot invitation lifecycle", () => {
  it("requires and stores a complete professional council registration", async () => {
    const fortaleza = "a1100000-0000-4000-8000-000000000101";
    const adminCookie = await scopedCookie(fortaleza, "SUPER_ADMIN");
    const create = (body: unknown) =>
      userAdminResponse(
        new Request(`${origin}/api/v1/inventory/users`, {
          method: "POST",
          headers: { cookie: adminCookie, origin, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const base = {
      action: "CREATE",
      name: "Profissional Conselho",
      email: `${randomUUID()}@example.test`,
      profession: "Médico",
      role: "UNIT_MANAGER",
      unitIds: [fortaleza],
    };
    expect((await create(base)).status).toBe(400);
    const created = await create({
      ...base,
      professionalCouncil: "CRM",
      councilNumber: "12345",
      councilRegion: "CE",
    });
    expect(created.status).toBe(201);
    const userId = (await created.json()).data.id;
    const stored = await getPool().query(
      `SELECT professional_council AS council,council_number AS number,council_region AS region
       FROM inventory_users WHERE id=$1`,
      [userId],
    );
    expect(stored.rows).toEqual([{ council: "CRM", number: "12345", region: "CE" }]);
    const updated = await create({
      action: "UPDATE",
      userId,
      name: "Profissional Conselho Corrigido",
      email: base.email,
      profession: "Médico",
      title: "Profissional da saúde",
      professionalCouncil: "CRM",
      councilNumber: "54321",
      councilRegion: "CE",
      role: "UNIT_MANAGER",
      unitIds: [fortaleza, "a1100000-0000-4000-8000-000000000102"],
    });
    expect(updated.status).toBe(200);
    expect(
      (
        await getPool().query(
          `SELECT u.name,u.council_number AS number,m.role,count(ua.unit_id)::integer AS units
           FROM inventory_users u JOIN inventory_memberships m ON m.user_id=u.id
           LEFT JOIN inventory_unit_access ua ON ua.membership_id=m.id
           WHERE u.id=$1 GROUP BY u.id,m.id`,
          [userId],
        )
      ).rows,
    ).toEqual([
      {
        name: "Profissional Conselho Corrigido",
        number: "54321",
        role: "UNIT_MANAGER",
        units: 2,
      },
    ]);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::integer AS count FROM inventory_user_changes WHERE user_id=$1",
          [userId],
        )
      ).rows[0].count,
    ).toBe(1);
    await expect(
      getPool().query("DELETE FROM inventory_user_changes WHERE user_id=$1", [userId]),
    ).rejects.toThrow();
  });

  it("revokes pending invitations when a user is deactivated", async () => {
    const fortaleza = "a1100000-0000-4000-8000-000000000101";
    const adminCookie = await scopedCookie(fortaleza, "SUPER_ADMIN");
    const adminRequest = (body: unknown) =>
      userAdminResponse(
        new Request(`${origin}/api/v1/inventory/users`, {
          method: "POST",
          headers: { cookie: adminCookie, origin, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const created = await adminRequest({
      action: "CREATE",
      name: "Usuário convite",
      email: `${randomUUID()}@example.test`,
      role: "VIEWER",
      unitIds: [fortaleza],
    });
    expect(created.status).toBe(201);
    const createdData = (await created.json()).data;
    const token = new URL(createdData.activationPath, origin).searchParams.get("token")!;
    expect((await adminRequest({ action: "DEACTIVATE", userId: createdData.id })).status).toBe(200);
    const activation = await activationResponse(
      new Request(`${origin}/api/inventory-activation`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: "a-secure-test-password" }),
      }),
    );
    expect(activation.status).toBe(410);
  });
});

describe("Preview access", () => {
  it("denies unauthenticated inventory reads", async () => {
    expect((await inventoryResponse(new Request(`${origin}/api/v1/inventory/stock`))).status).toBe(
      401,
    );
  });
  it("rejects cross-origin login", async () => {
    expect(
      (
        await previewLogin(
          new Request(`${origin}/api/inventory-session`, {
            method: "POST",
            headers: { origin: "https://attacker.invalid" },
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("rejects invalid password", async () => {
    expect(
      (
        await previewLogin(
          new Request(`${origin}/api/inventory-session`, {
            method: "POST",
            headers: { origin },
            body: JSON.stringify({ password: "wrong" }),
          }),
        )
      ).status,
    ).toBe(401);
  });
  it("uses individual authentication when Preview receives an email", async () => {
    const email = `preview-${randomUUID()}@example.test`;
    const password = "individual-preview-password";
    await getPool().query(
      `INSERT INTO inventory_users(name,email,password_hash)
       VALUES('Usuário Preview',$1,$2)`,
      [email, await hashPassword(password)],
    );

    const response = await sessionResponse(
      new Request(`${origin}/api/inventory-session`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("inventory_session=");
  });
  it("validates session signature and expiry", () => {
    expect(hasPreviewSession(request("stock"))).toBe(true);
    expect(
      hasPreviewSession(new Request(origin, { headers: { cookie: cookie + "tampered" } })),
    ).toBe(false);
    expect(hasPreviewSession(request("stock"), Date.now() + 9 * 60 * 60 * 1000)).toBe(false);
  });
  it("fails closed in production", () => {
    process.env["INVENTORY_ENVIRONMENT"] = "production";
    expect(hasPreviewSession(request("stock"))).toBe(false);
    process.env["INVENTORY_ENVIRONMENT"] = "test";
  });
});
describe("PostgreSQL ledger integrity", () => {
  it("projects balance and audit from a movement", async () => {
    const f = await fixture("12.125");
    const b = await getPool().query("SELECT quantity FROM inventory_balances WHERE lot_id=$1", [
      f.params[0],
    ]);
    expect(b.rows[0].quantity).toBe("12.125");
    const a = await getPool().query(
      "SELECT count(*)::int AS count FROM inventory_audit a JOIN inventory_movements m ON m.id=a.movement_id WHERE m.lot_id=$1",
      [f.params[0]],
    );
    expect(a.rows[0].count).toBe(1);
  });
  it("rejects insufficient stock without partial movement or audit", async () => {
    const f = await fixture();
    await expect(movement(f.params, "-11")).rejects.toThrow();
    const r = await getPool().query("SELECT quantity FROM inventory_balances WHERE lot_id=$1", [
      f.params[0],
    ]);
    expect(r.rows[0].quantity).toBe("10.000");
    const m = await getPool().query(
      "SELECT count(*)::int AS count FROM inventory_movements WHERE lot_id=$1",
      [f.params[0]],
    );
    expect(m.rows[0].count).toBe(1);
  });
  it("serializes concurrent withdrawals", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([movement(f.params, "-6"), movement(f.params, "-6")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const b = await getPool().query("SELECT quantity FROM inventory_balances WHERE lot_id=$1", [
      f.params[0],
    ]);
    expect(b.rows[0].quantity).toBe("4.000");
  });
  it("prevents edits and deletion of movements and audit", async () => {
    const f = await fixture();
    await expect(
      getPool().query("UPDATE inventory_movements SET delta=20 WHERE lot_id=$1", [f.params[0]]),
    ).rejects.toThrow("append-only");
    await expect(
      getPool().query("DELETE FROM inventory_movements WHERE lot_id=$1", [f.params[0]]),
    ).rejects.toThrow("append-only");
    await expect(
      getPool().query(
        "UPDATE inventory_audit SET action='OTHER' WHERE movement_id IN (SELECT id FROM inventory_movements WHERE lot_id=$1)",
        [f.params[0]],
      ),
    ).rejects.toThrow("append-only");
  });
  it("prevents arbitrary projection edits", async () => {
    const f = await fixture();
    await expect(
      getPool().query("UPDATE inventory_balances SET quantity=100 WHERE lot_id=$1", [f.params[0]]),
    ).rejects.toThrow("ledger projection");
  });
  it("rejects expired lot consumption", async () => {
    const f = await fixture("10", -1);
    await expect(movement(f.params, "-1")).rejects.toThrow("not available");
    const body = await (await inventoryResponse(request(`lots?productId=${f.productId}`))).json();
    expect(body.data[0].status).toBe("EXPIRED");
  });
  it("rejects repeated operation keys", async () => {
    const f = await fixture();
    const key = randomUUID();
    const sql = `INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,reference,reason,operation_key) VALUES($1,$2,'IN',2,'test','TEST','Teste',$3)`;
    await getPool().query(sql, [...f.params, key]);
    await expect(getPool().query(sql, [...f.params, key])).rejects.toThrow();
    const b = await getPool().query("SELECT quantity FROM inventory_balances WHERE lot_id=$1", [
      f.params[0],
    ]);
    expect(b.rows[0].quantity).toBe("12.000");
  });
  it("rolls back ledger, audit and balance together", async () => {
    const f = await fixture();
    const c = await getPool().connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `INSERT INTO inventory_movements(lot_id,location_id,type,delta,actor,reference,reason,operation_key) VALUES($1,$2,'IN',5,'test','TEST','Teste',$3)`,
        [...f.params, randomUUID()],
      );
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
    const b = await getPool().query("SELECT quantity FROM inventory_balances WHERE lot_id=$1", [
      f.params[0],
    ]);
    expect(b.rows[0].quantity).toBe("10.000");
  });
});
describe("Inventory API", () => {
  it("returns real filtered stock without caching private responses", async () => {
    const f = await fixture("3");
    const response = await inventoryResponse(request(`stock?productId=${f.productId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].quantity).toBe(3);
  });
  it("returns not found instead of another product", async () => {
    expect((await inventoryResponse(request(`products/${randomUUID()}`))).status).toBe(404);
  });
  it("rejects malformed filters", async () => {
    expect((await inventoryResponse(request("stock?productId=invalid"))).status).toBe(400);
  });
  it("returns empty data for a valid unmatched filter", async () => {
    const body = await (await inventoryResponse(request(`stock?productId=${randomUUID()}`))).json();
    expect(body.data).toEqual([]);
  });
});
