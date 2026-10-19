import {
  appendIntegrationEvent,
  consumeIntegrationEvent,
  type IntegrationEventInput,
} from "./integration-events";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import { planQuotesResponse, planQuoteSnapshotDto } from "./plan-quotes";
import { engineCatalogResponse } from "./engine-catalog";
import { patientTreatmentPlansResponse } from "./patient-treatment-plans";
import * as accessAudit from "./clinical-access-audit";
const origin = "https://shared-models.example.test";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw Error("Disposable database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await getPool().end();
});
async function fixture() {
  const pool = getPool(),
    org = randomUUID(),
    unit = randomUUID(),
    otherUnit = randomUUID();
  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Shared models ${org}`,
  ]);
  await pool.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Unit one'),($2,$3,'Unit two')",
    [unit, otherUnit, org],
  );
  const users: Record<
    string,
    { id: string; membership: string; patient: string; appointment: string; cookie: string }
  > = {};
  for (const [key, role, scope] of [
    ["owner", "CLINICIAN", unit],
    ["colleague", "CLINICIAN", unit],
    ["reviewer", "SUPER_ADMIN", unit],
    ["partner", "PARTNER_ADMIN", unit],
    ["outside", "FINANCE", otherUnit],
    ["finance", "FINANCE", unit],
    ["manager", "UNIT_MANAGER", unit],
  ]) {
    const id = randomUUID(),
      membership = randomUUID(),
      patient = randomUUID(),
      appointment = randomUUID(),
      token = randomUUID();
    users[key!] = {
      id,
      membership,
      patient,
      appointment,
      cookie: `allik_inventory_session=${token}`,
    };
    await pool.query(
      "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Synthetic model clinician',$2,'CRM',$3,'CE')",
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
    await pool.query(
      "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,$4,'Synthetic model patient')",
      [patient, org, scope, randomUUID()],
    );
    await pool.query(
      "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour',$6)",
      [appointment, org, scope, patient, id, `Shared room ${appointment}`],
    );
  }
  const plan = () => ({
    startDate: "2030-01-01",
    previewDays: 30,
    items: [
      {
        id: randomUUID(),
        kind: "SERVICE",
        title: "Synthetic clinical service",
        productId: null,
        catalogItemId: null,
        administrationUnit: "SESSION",
        stages: [
          {
            doseUnits: "1",
            frequencyPerDay: 1,
            everyDays: 1,
            durationDays: 7,
            weekdays: null,
            times: null,
          },
        ],
        dispense: null,
        package: null,
      },
    ],
  });
  const draft = () => ({
    action: "SAVE_PLAN",
    id: randomUUID(),
    operationId: randomUUID(),
    version: null,
    patientId: users["owner"]!.patient,
    title: "Synthetic general plan",
    status: "DRAFT",
    plan: plan(),
  });
  const read = (role = "owner", planId?: string, patientId = users["owner"]!.patient) =>
    patientTreatmentPlansResponse(
      new Request(
        `${origin}/api/v1/inventory/patient-treatment-plans?patientId=${patientId}${planId ? `&planId=${planId}` : ""}`,
        { headers: { cookie: users[role]!.cookie } },
      ),
    );
  const post = (body: unknown, role = "owner") =>
    patientTreatmentPlansResponse(
      new Request(`${origin}/api/v1/inventory/patient-treatment-plans`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json", cookie: users[role]!.cookie },
        body: JSON.stringify(body),
      }),
    );
  const enginePost = (body: unknown) =>
    engineCatalogResponse(
      new Request(`${origin}/api/v1/inventory/engine-catalog`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json", cookie: users["reviewer"]!.cookie },
        body: JSON.stringify(body),
      }),
    );
  const service = randomUUID(),
    price = randomUUID();
  expect(
    (
      await enginePost({
        action: "SAVE_ITEM",
        id: service,
        operationId: randomUUID(),
        version: null,
        kind: "SERVICE",
        name: "Commercial synthetic service",
        description: "",
        active: true,
      })
    ).status,
  ).toBe(201);
  const priceInput = {
    action: "SET_UNIT_PRICE",
    id: price,
    operationId: randomUUID(),
    version: null,
    unitId: unit,
    productId: null,
    catalogItemId: service,
    amount: "100.00",
    sellingUnit: "SESSION",
    source: "Approved synthetic source",
    validFrom: "2020-01-01",
    validUntil: null,
    availability: "AVAILABLE",
    active: true,
  };
  expect((await enginePost(priceInput)).status).toBe(201);
  const clinical = draft();
  clinical.title = "CLINICAL_SECRET_DIAGNOSIS";
  clinical.plan.items[0]!.catalogItemId = service as never;
  clinical.plan.items[0]!.title = "CLINICAL_SECRET_ITEM_TITLE";
  expect((await post(clinical)).status).toBe(201);
  const quoteDraft = () => ({
    action: "SAVE_ESTIMATE",
    id: randomUUID(),
    operationId: randomUUID(),
    version: null,
    planId: clinical.id,
    expectedPlanVersion: 1,
    overrides: [],
    discountBps: 0,
  });
  const rawQuotePost = (body: unknown, role = "finance") =>
    planQuotesResponse(
      new Request(`${origin}/api/v1/inventory/plan-quotes`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json", cookie: users[role]!.cookie },
        body: JSON.stringify(body),
      }),
    );
  const quotePost = async (body: unknown, role = "finance"): Promise<Response> => {
    const value = body as Record<string, unknown>;
    if (value["action"] === "SAVE_ESTIMATE" && !value["expectedPreviewHash"]) {
      const preview = await rawQuotePost(
        {
          action: "PREVIEW",
          planId: value["planId"],
          expectedPlanVersion: value["expectedPlanVersion"],
          overrides: value["overrides"],
          discountBps: value["discountBps"],
        },
        role,
      );
      if (preview.status !== 200) return preview;
      value["expectedPreviewHash"] = (await preview.json()).data.previewHash;
    }
    return rawQuotePost(body, role);
  };
  const quoteRead = (role = "finance", quoteId?: string, revision?: number) =>
    planQuotesResponse(
      new Request(
        `${origin}/api/v1/inventory/plan-quotes?patientId=${clinical.patientId}&planId=${clinical.id}${quoteId ? `&quoteId=${quoteId}` : ""}${revision ? `&revision=${revision}` : ""}`,
        { headers: { cookie: users[role]!.cookie } },
      ),
    );
  const desk = (role = "finance") =>
    planQuotesResponse(
      new Request(`${origin}/api/v1/inventory/plan-quotes`, {
        headers: { cookie: users[role]!.cookie },
      }),
    );
  return {
    org,
    unit,
    otherUnit,
    users,
    plan,
    draft,
    read,
    post,
    enginePost,
    priceInput,
    clinical,
    quoteDraft,
    quotePost,
    quoteRead,
    desk,
  };
}
async function eventFixture() {
  const f = await fixture(),
    d = f.quoteDraft();
  expect((await f.quotePost(d)).status).toBe(201);
  const envelope: IntegrationEventInput = {
    organizationId: f.org,
    unitId: f.unit,
    actorUserId: f.users["finance"]!.id,
    eventType: "QUOTE_CREATED",
    aggregateType: "QUOTE",
    aggregateId: d.id,
    aggregateVersion: 1,
    payload: { resourceId: d.id, resourceVersion: 1 },
  };
  const client = await getPool().connect();
  let id: string;
  try {
    await client.query("BEGIN");
    id = (await appendIntegrationEvent(client, envelope)).id;
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  const scope = {
    organizationId: f.org,
    unitId: f.unit,
    actorUserId: f.users["finance"]!.id,
    eventId: id!,
    consumerKey: "synthetic.adapter",
  };
  return { ...f, d, envelope, scope };
}
describe("Transactional integration outbox and explicit internal inbox", () => {
  it("deduplicates actual source events and preserves minimal immutable envelopes", async () => {
    const f = await eventFixture(),
      client = await getPool().connect();
    try {
      await client.query("BEGIN");
      expect(await appendIntegrationEvent(client, f.envelope)).toEqual({
        id: f.scope.eventId,
        replayed: true,
      });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const rows = (
      await getPool().query(
        "SELECT payload,schema_version FROM inventory_integration_outbox WHERE id=$1",
        [f.scope.eventId],
      )
    ).rows;
    expect(rows).toEqual([
      { payload: { resourceId: f.d.id, resourceVersion: 1 }, schema_version: 1 },
    ]);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int n FROM inventory_integration_event_audit WHERE event_id=$1 AND action='EMITTED'",
          [f.scope.eventId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("rolls back adapter effects on failure and retries exactly once even concurrently", async () => {
    const f = await eventFixture(),
      original = (
        await getPool().query("SELECT name FROM inventory_organizations WHERE id=$1", [f.org])
      ).rows[0].name;
    await expect(
      consumeIntegrationEvent(getPool(), f.scope, async (c) => {
        await c.query("UPDATE inventory_organizations SET name='Synthetic rollback' WHERE id=$1", [
          f.org,
        ]);
        throw new Error("Synthetic adapter failed");
      }),
    ).rejects.toThrow("Synthetic adapter failed");
    expect(
      (await getPool().query("SELECT name FROM inventory_organizations WHERE id=$1", [f.org]))
        .rows[0].name,
    ).toBe(original);
    let calls = 0;
    const adapter = async (c: import("pg").PoolClient) => {
      calls++;
      await c.query("UPDATE inventory_organizations SET name=$2 WHERE id=$1", [
        f.org,
        `Consumed ${f.org}`,
      ]);
    };
    const results = await Promise.all([
      consumeIntegrationEvent(getPool(), f.scope, adapter),
      consumeIntegrationEvent(getPool(), f.scope, adapter),
    ]);
    expect(calls).toBe(1);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int n FROM inventory_integration_event_audit WHERE event_id=$1 AND action='CONSUMED'",
          [f.scope.eventId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("fails closed on receipt/audit validation failure and rolls back all callback effects", async () => {
    const f = await eventFixture();
    await expect(
      consumeIntegrationEvent(getPool(), f.scope, async (c) => {
        await c.query("DELETE FROM inventory_unit_access WHERE membership_id=$1", [
          f.users["finance"]!.membership,
        ]);
      }),
    ).rejects.toThrow();
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int n FROM inventory_unit_access WHERE membership_id=$1",
          [f.users["finance"]!.membership],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int n FROM inventory_integration_inbox_receipts WHERE event_id=$1",
          [f.scope.eventId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("denies cross-tenant/unit and disabled actors before adapter invocation, including replay", async () => {
    const f = await eventFixture();
    let calls = 0;
    const adapter = async () => {
      calls++;
    };
    await expect(
      consumeIntegrationEvent(getPool(), { ...f.scope, organizationId: randomUUID() }, adapter),
    ).rejects.toThrow();
    await expect(
      consumeIntegrationEvent(getPool(), { ...f.scope, unitId: f.otherUnit }, adapter),
    ).rejects.toThrow();
    await consumeIntegrationEvent(getPool(), f.scope, adapter);
    expect(calls).toBe(1);
    await getPool().query("UPDATE inventory_users SET active=false WHERE id=$1", [
      f.scope.actorUserId,
    ]);
    await expect(consumeIntegrationEvent(getPool(), f.scope, adapter)).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it("requires caller transactions and rejects unsupported, forged and unaudited events", async () => {
    const f = await eventFixture(),
      c = await getPool().connect();
    try {
      await expect(appendIntegrationEvent(c, f.envelope)).rejects.toThrow();
      await c.query("BEGIN");
      await expect(
        appendIntegrationEvent(c, { ...f.envelope, eventType: "QUOTE_APPROVED" }),
      ).rejects.toThrow();
      await expect(
        appendIntegrationEvent(c, {
          ...f.envelope,
          aggregateId: randomUUID(),
          payload: { resourceId: randomUUID(), resourceVersion: 1 },
        }),
      ).rejects.toThrow();
      await expect(
        c.query(
          "INSERT INTO inventory_integration_outbox(organization_id,unit_id,actor_user_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload) VALUES($1,$2,$3,'QUOTE_CREATED','QUOTE',$4,1,jsonb_build_object('resourceId',$4::text,'resourceVersion',1,'clinicalNotes','forbidden'))",
          [f.org, f.unit, f.scope.actorUserId, randomUUID()],
        ),
      ).rejects.toThrow();
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });
  it("prevents mutation or truncation of outbox, receipts and audit history", async () => {
    const f = await eventFixture();
    await consumeIntegrationEvent(getPool(), f.scope, async () => {});
    for (const table of [
      "inventory_integration_outbox",
      "inventory_integration_inbox_receipts",
      "inventory_integration_event_audit",
    ]) {
      await expect(
        getPool().query(
          `UPDATE ${table} SET created_at=now() WHERE ${table === "inventory_integration_outbox" ? "id" : "event_id"}=$1`,
          [f.scope.eventId],
        ),
      ).rejects.toThrow();
      await expect(
        getPool().query(
          `DELETE FROM ${table} WHERE ${table === "inventory_integration_outbox" ? "id" : "event_id"}=$1`,
          [f.scope.eventId],
        ),
      ).rejects.toThrow();
      await expect(getPool().query(`TRUNCATE ${table} CASCADE`)).rejects.toThrow();
    }
  });
});
