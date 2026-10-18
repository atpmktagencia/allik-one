import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import {
  sessionResponse,
  hashToken,
  can,
  type AuthContext,
  type Role,
  type Permission,
} from "./auth";
import { encounterQuotesResponse } from "./encounter-quotes";
import { pricingResponse } from "./pricing";
const origin = "https://quote-access.example.test";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw Error("Disposable database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await getPool().end();
});
async function fixture(issued = true) {
  const pool = getPool(),
    org = randomUUID(),
    unit = randomUUID(),
    otherUnit = randomUUID(),
    patient = randomUUID(),
    appointment = randomUUID(),
    prescription = randomUUID(),
    quote = randomUUID(),
    product = randomUUID(),
    presentation = randomUUID(),
    dose = randomUUID(),
    item = randomUUID();
  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Synthetic quote access ${org}`,
  ]);
  await pool.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Unit one'),($2,$3,'Unit two')",
    [unit, otherUnit, org],
  );
  await pool.query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,$4,'Synthetic quote patient')",
    [patient, org, unit, randomUUID()],
  );
  const users: Record<string, { id: string; membership: string; cookie: string }> = {};
  for (const [key, role, scope] of [
    ["doctor", "CLINICIAN", unit],
    ["colleague", "CLINICIAN", unit],
    ["manager", "UNIT_MANAGER", unit],
    ["finance", "FINANCE", unit],
    ["inventory", "INVENTORY_MANAGER", unit],
    ["partner", "PARTNER_ADMIN", unit],
    ["super", "SUPER_ADMIN", unit],
    ["outside", "FINANCE", otherUnit],
  ]) {
    const id = randomUUID(),
      membership = randomUUID(),
      token = randomUUID();
    users[key!] = { id, membership, cookie: `allik_inventory_session=${token}` };
    await pool.query(
      "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Synthetic quote operator',$2,'CRM',$3,'CE')",
      [id, `${id}@example.test`, String(BigInt("0x" + id.replaceAll("-", "").slice(0, 12)))],
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
    "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour','Synthetic quote room')",
    [appointment, org, unit, patient, users["doctor"]!.id],
  );
  await pool.query(
    "INSERT INTO inventory_products(id,organization_id,name,sku,category,unit,minimum) VALUES($1,$2,'Synthetic quote product',$3,'Test','UN',0)",
    [product, org, randomUUID()],
  );
  await pool.query(
    `INSERT INTO inventory_pricing_presentations(id,organization_id,product_id,name,base_unit,total_base_quantity,acquisition_cost,technical_loss_percent,additional_presentation_cost,minimum_measurable_volume_ml,beyond_use_hours,pricing_status,cost_source,cost_valid_on,assumptions_confirmed,validated_at,validated_by_actor,validated_by_user_id,created_by_user_id)
    VALUES($1,$2,$3,'Synthetic sale presentation','MG',20,100,10,0,0.01,24,'VALIDATED','Synthetic source',current_date,true,now(),'Synthetic operator',$4,$4)`,
    [presentation, org, product, users["super"]!.id],
  );
  await pool.query(
    "INSERT INTO inventory_pricing_doses(id,presentation_id,name,dose_quantity,sale_price,material_cost) VALUES($1,$2,'Synthetic sale dose',2.5,200,2)",
    [dose, presentation],
  );
  const prescriptionItems = [
    {
      id: item,
      productId: product,
      medicationName: "CLINICAL_SECRET_MEDICATION",
      doseQuantity: 2.5,
      doseUnit: "MG",
      plannedAdministrations: 4,
      unknownClinical: "UNEXPECTED_CLINICAL_SECRET",
      nested: { estimatedCost: "UNEXPECTED_NESTED_COST" },
    },
  ];
  await pool.query(
    `INSERT INTO inventory_encounter_prescriptions(id,organization_id,unit_id,appointment_id,patient_id,author_user_id,author_name,professional_council,council_number,council_region,items,status,finalized_at)
    VALUES($1,$2,$3,$4,$5,$6,'Synthetic clinician','CRM','12345','CE',$7,'FINAL',now())`,
    [
      prescription,
      org,
      unit,
      appointment,
      patient,
      users["doctor"]!.id,
      JSON.stringify(prescriptionItems),
    ],
  );
  if (issued)
    await pool.query(
      `INSERT INTO inventory_encounter_quotes(id,organization_id,unit_id,appointment_id,patient_id,prescription_id,created_by_user_id,items,total_sale,estimated_cost,gross_result,status,issued_at,version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,800,100,700,'ISSUED',now(),1)`,
      [
        quote,
        org,
        unit,
        appointment,
        patient,
        prescription,
        users["doctor"]!.id,
        JSON.stringify([
          {
            id: randomUUID(),
            prescriptionItemId: item,
            pricingDoseId: dose,
            medicationName: "CLINICAL_SECRET_MEDICATION",
            doseQuantity: 2.5,
            doseUnit: "MG",
            quantity: 4,
            salePrice: 200,
            totalSale: 800,
            estimatedCost: 100,
            grossResult: 700,
            unitCost: 25,
            materialCost: 2,
            unknownCost: "UNEXPECTED_COST_SECRET",
            unknownClinical: "UNEXPECTED_CLINICAL_SECRET",
            nested: {
              acquisitionCost: "UNEXPECTED_NESTED_COST",
              medicationName: "UNEXPECTED_NESTED_CLINICAL",
            },
          },
        ]),
      ],
    );
  const req = (
    role: string,
    resource: string,
    body?: Record<string, unknown>,
    targetAppointment = appointment,
  ) =>
    new Request(`${origin}/api/v1/inventory/${resource}?appointmentId=${targetAppointment}`, {
      method: body ? "POST" : "GET",
      headers: {
        cookie: users[role]!.cookie,
        ...(body ? { origin, "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify({ appointmentId: targetAppointment, ...body }) } : {}),
    });
  const read = (role: string, targetAppointment = appointment) =>
    encounterQuotesResponse(req(role, "encounter-quotes", undefined, targetAppointment));
  const post = (role: string, body: Record<string, unknown>) =>
    encounterQuotesResponse(req(role, "encounter-quotes", body));
  const pricing = (role: string, body?: Record<string, unknown>) =>
    pricingResponse(req(role, "pricing", body));
  return {
    org,
    unit,
    otherUnit,
    patient,
    appointment,
    prescription,
    quote,
    product,
    presentation,
    dose,
    item,
    users,
    read,
    post,
    pricing,
  };
}
function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, v]) => [key, ...keys(v)]);
  return [];
}
describe("Quote and cost segregation", () => {
  it("returns clinical and sale information to the clinician without disclosing cost fields anywhere in the JSON", async () => {
    const f = await fixture();
    const response = await f.read("doctor");
    expect(response.status).toBe(200);
    const raw = await response.text(),
      body = JSON.parse(raw);
    expect(body.data.prescription).not.toBeNull();
    expect(body.data.quote.totalSale).toBe("800.00");
    expect(body.data.canApprove).toBe(false);
    expect(body.data.canDecline).toBe(false);
    expect(body.data.canRegisterPayment).toBe(false);
    for (const forbidden of [
      "estimatedCost",
      "grossResult",
      "acquisitionCost",
      "additionalPresentationCost",
      "materialCost",
      "unitCost",
      "costSource",
      "technicalLossPercent",
    ])
      expect(keys(body)).not.toContain(forbidden);
    expect(raw).not.toContain("UNEXPECTED_");
    expect(raw).not.toContain("unknownCost");
    expect(raw).not.toContain("unknownClinical");
    expect(raw).not.toContain('"nested"');
    expect((await f.pricing("doctor")).status).toBe(403);
  });
  it("returns only commercial fields to finance without prescription, clinical item fields or activation data", async () => {
    const f = await fixture();
    const response = await f.read("finance");
    expect(response.status).toBe(200);
    const raw = await response.text(),
      body = JSON.parse(raw);
    expect(body.data.prescription).toBeNull();
    expect(body.data.activation).toBeNull();
    expect(body.data.pricingOptions).toEqual([]);
    expect(body.data.quote.totalSale).toBe("800.00");
    expect(body.data.canApprove).toBe(true);
    for (const forbidden of [
      "medicationName",
      "doseQuantity",
      "doseUnit",
      "plannedAdministrations",
    ])
      expect(keys(body)).not.toContain(forbidden);
    expect(raw).not.toContain("CLINICAL_SECRET_MEDICATION");
    expect(raw).not.toContain("UNEXPECTED_");
    expect(raw).not.toContain('"nested"');
    expect((await f.pricing("finance")).status).toBe(200);
  });
  it("denies pricing reads and writes to clinicians and unit managers while allowing only designated pricing writers", async () => {
    const f = await fixture();
    const create = {
      action: "CREATE_PRESENTATION",
      id: randomUUID(),
      productId: f.product,
      name: `Synthetic access presentation ${randomUUID()}`,
      baseUnit: "MG",
      totalBaseQuantity: "20",
      acquisitionCost: "100",
      technicalLossPercent: "0",
      additionalPresentationCost: "0",
      pricingStatus: "DRAFT",
      active: true,
      version: 0,
      reason: "Synthetic access authorization test",
    };
    for (const role of ["doctor", "manager"]) {
      expect((await f.pricing(role)).status).toBe(403);
      expect(
        (
          await f.pricing(role, {
            ...create,
            id: randomUUID(),
            name: `Synthetic role presentation ${role}`,
          })
        ).status,
      ).toBe(403);
    }
    expect((await f.pricing("finance", { ...create, id: randomUUID() })).status).toBe(403);
    for (const role of ["inventory", "partner", "super"]) {
      expect((await f.pricing(role)).status).toBe(200);
      const response = await f.pricing(role, {
        ...create,
        id: randomUUID(),
        name: `Synthetic role presentation ${role}`,
      });
      expect([200, 201]).toContain(response.status);
    }
    const manager = await (await f.read("manager")).json();
    for (const forbidden of ["estimatedCost", "grossResult", "unitCost", "materialCost"])
      expect(keys(manager)).not.toContain(forbidden);
  });
  it("denies shared Preview pricing mutations even though its demo role can read synthetic costs", async () => {
    vi.stubEnv("INVENTORY_ENVIRONMENT", "preview");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("INVENTORY_DISABLE_PREVIEW_LOGIN", "true");
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    try {
      const session = await sessionResponse(new Request(`${origin}/api/inventory-session`));
      expect(session.status).toBe(200);
      const body = await session.json();
      expect(body.data.capabilities.canReadPricingCosts).toBe(true);
      expect(body.data.capabilities.canManagePricing).toBe(false);
      const response = await pricingResponse(
        new Request(`${origin}/api/v1/inventory/pricing`, {
          method: "POST",
          headers: { origin, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "CREATE_PRESENTATION" }),
        }),
      );
      expect(response.status).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("preserves clinician quote creation while rejecting commercial approval and payment even on their own quote", async () => {
    const f = await fixture(false);
    const save = await f.post("doctor", {
      action: "SAVE_DRAFT",
      selections: [{ prescriptionItemId: f.item, pricingDoseId: f.dose, quantity: 4 }],
      commercialNotes: "Synthetic commercial note",
      version: null,
    });
    expect([200, 201]).toContain(save.status);
    const result = await (await f.read("doctor")).json();
    expect(result.data.quote.status).toBe("DRAFT");
    const version = result.data.quote.version;
    const issue = await f.post("doctor", {
      action: "ISSUE",
      selections: [{ prescriptionItemId: f.item, pricingDoseId: f.dose, quantity: 4 }],
      commercialNotes: "Synthetic commercial note",
      version,
    });
    expect(issue.status).toBe(200);
    for (const action of ["APPROVE", "DECLINE", "REGISTER_PAYMENT"]) {
      expect(
        (
          await f.post("doctor", {
            action,
            version: version + 1,
            payment: {
              method: "PIX",
              paidAt: "2026-10-18T12:00:00Z",
              reason: "Synthetic full payment",
            },
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await f.post("colleague", {
          action: "SAVE_DRAFT",
          selections: [],
          commercialNotes: "",
          version: version + 1,
        })
      ).status,
    ).toBe(403);
  });
  it("separates approval permission from payment registration", async () => {
    const f = await fixture();
    expect((await f.post("inventory", { action: "APPROVE", version: 1 })).status).toBe(403);
    expect((await f.post("manager", { action: "APPROVE", version: 1 })).status).toBe(200);
    const payment = {
      method: "PIX",
      paidAt: "2026-10-18T12:00:00Z",
      reason: "Synthetic payment confirmation",
    };
    expect(
      (await f.post("manager", { action: "REGISTER_PAYMENT", version: 2, payment })).status,
    ).toBe(403);
    expect(
      (await f.post("doctor", { action: "REGISTER_PAYMENT", version: 2, payment })).status,
    ).toBe(403);
    expect(
      (await f.post("finance", { action: "REGISTER_PAYMENT", version: 2, payment })).status,
    ).toBe(200);
    const row = await getPool().query(
      "SELECT status,version FROM inventory_encounter_quotes WHERE id=$1",
      [f.quote],
    );
    expect(row.rows).toEqual([{ status: "PAID", version: 3 }]);
  });
  it("enforces organization, original appointment unit and current patient unit on reads and commercial transitions", async () => {
    const f = await fixture(),
      foreign = await fixture();
    expect((await foreign.read("finance", f.appointment)).status).toBe(404);
    expect((await f.read("outside")).status).toBe(404);
    expect((await f.post("outside", { action: "APPROVE", version: 1 })).status).toBe(403);
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.patient,
      f.otherUnit,
    ]);
    expect((await f.read("finance")).status).toBe(404);
    expect((await f.read("doctor")).status).toBe(404);
    expect((await f.post("finance", { action: "APPROVE", version: 1 })).status).toBe(403);
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [f.users["finance"]!.membership, f.otherUnit],
    );
    expect((await f.read("finance")).status).toBe(200);
    expect((await f.post("finance", { action: "APPROVE", version: 1 })).status).toBe(200);
  });
});

describe("Commercial capability matrix", () => {
  const capabilities: Permission[] = [
    "pricing.costs.read",
    "pricing.manage",
    "quotes.approve",
    "quotes.payment.record",
  ];
  const matrix: [Role, boolean[]][] = [
    ["SUPER_ADMIN", [true, true, true, true]],
    ["PARTNER_ADMIN", [true, true, true, true]],
    ["INVENTORY_MANAGER", [true, true, false, false]],
    ["UNIT_MANAGER", [false, false, true, false]],
    ["CLINICIAN", [false, false, false, false]],
    ["FINANCE", [true, false, true, true]],
    ["VIEWER", [false, false, false, false]],
  ];
  const context = (role: Role): AuthContext => ({
    user: { id: randomUUID(), name: "Synthetic capabilities", email: null },
    membershipId: randomUUID(),
    organizationId: randomUUID(),
    role,
    unitIds: ["scope-unit"],
    preview: false,
    integration: null,
  });
  it.each(matrix)("enforces %s explicit commercial capabilities", (role, expected) => {
    const auth = context(role);
    expect(capabilities.map((permission) => can(auth, permission, "scope-unit"))).toEqual(expected);
    if (role !== "SUPER_ADMIN")
      expect(capabilities.map((permission) => can(auth, permission, "other-unit"))).toEqual([
        false,
        false,
        false,
        false,
      ]);
  });
  it("never grants an integration permissions merely because its role includes them", () => {
    const auth = context("PARTNER_ADMIN");
    auth.integration = { id: randomUUID(), name: "Synthetic integration", permissions: [] };
    expect(capabilities.map((permission) => can(auth, permission, "scope-unit"))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    auth.integration.permissions = ["pricing.costs.read"];
    expect(capabilities.map((permission) => can(auth, permission, "scope-unit"))).toEqual([
      true,
      false,
      false,
      false,
    ]);
    auth.role = "CLINICIAN";
    expect(can(auth, "pricing.costs.read", "scope-unit")).toBe(false);
  });
});
