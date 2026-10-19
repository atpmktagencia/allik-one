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
describe("Saved proposal export", () => {
  it("exports only an authorized saved immutable revision with private security headers", async () => {
    const f = await fixture(),
      d = f.quoteDraft();
    expect((await f.quotePost(d)).status).toBe(201);
    const proposal = (role = "finance", quoteId = d.id) =>
      planQuotesResponse(
        new Request(
          `${origin}/api/v1/inventory/plan-quotes?planId=${f.clinical.id}&quoteId=${quoteId}&revision=1&format=proposal`,
          { headers: { cookie: f.users[role]!.cookie } },
        ),
      );
    const response = await proposal();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toContain("R$ 700,00");
    expect(html).toContain("Preço v1");
    expect(html).not.toContain("CLINICAL_SECRET");
    expect(
      (
        await f.enginePost({
          ...f.priceInput,
          version: 1,
          operationId: randomUUID(),
          amount: "200.00",
        })
      ).status,
    ).toBe(200);
    expect(await (await proposal()).text()).toContain("R$ 700,00");
    expect((await proposal("outside")).status).toBe(404);
    expect((await proposal("finance", randomUUID())).status).toBe(404);
    const missing = await planQuotesResponse(
      new Request(
        `${origin}/api/v1/inventory/plan-quotes?planId=${f.clinical.id}&format=proposal`,
        { headers: { cookie: f.users["finance"]!.cookie } },
      ),
    );
    expect(missing.status).toBe(400);
  });
});
describe("Plan probable quote boundary", () => {
  it("saves a commercial-only estimate without creating stock, appointments, payment or clinical mutations", async () => {
    const f = await fixture(),
      d = f.quoteDraft();
    const count = async () =>
      (
        await getPool().query(
          "SELECT (SELECT count(*) FROM inventory_movements)::text stock,(SELECT count(*) FROM inventory_care_appointments)::text appointments,(SELECT count(*) FROM inventory_encounter_quotes)::text legacyquotes,(SELECT count(*) FROM inventory_patient_treatment_schedule)::text schedules",
        )
      ).rows;
    const before = await count();
    expect((await f.quotePost(d)).status).toBe(201);
    expect((await f.quotePost(d)).status).toBe(200);
    expect(
      (
        await f.quotePost({
          ...d,
          operationId: randomUUID(),
          version: 1,
          expectedPreviewHash: undefined,
        })
      ).status,
    ).toBe(200);
    const emitted = (
      await getPool().query(
        "SELECT event_type,aggregate_type,aggregate_version,payload FROM inventory_integration_outbox WHERE aggregate_id=$1",
        [d.id],
      )
    ).rows;
    expect(emitted).toEqual([
      {
        event_type: "QUOTE_CREATED",
        aggregate_type: "QUOTE",
        aggregate_version: 1,
        payload: { resourceId: d.id, resourceVersion: 1 },
      },
    ]);
    const response = await f.quoteRead("finance", d.id);
    expect(response.status).toBe(200);
    const raw = await response.text(),
      data = JSON.parse(raw).data;
    expect(data.snapshot).toMatchObject({
      complete: true,
      total: "700.00",
      sourcePlanVersion: 1,
      unitId: f.unit,
      discountBps: 0,
    });
    expect(data.snapshot.lines[0]).toMatchObject({
      label: "Commercial synthetic service",
      unitPrice: "100.00",
      priceSource: "Approved synthetic source",
      priceVersion: 1,
    });
    expect(raw).not.toContain("CLINICAL_SECRET");
    for (const key of [
      "patientInstructions",
      "doseUnits",
      "formula",
      "estimatedCost",
      "grossResult",
      "acquisitionCost",
    ])
      expect(raw).not.toContain(`"${key}"`);
    const desk = await (await f.desk()).json();
    expect(desk.data.estimates[0]).toMatchObject({ id: d.id, patientId: f.clinical.patientId });
    expect(data.canReadClinical).toBe(false);
    expect(await count()).toEqual(before);
  });
  it("freezes historical price and source-plan revisions until explicit recalculation", async () => {
    const f = await fixture(),
      d = f.quoteDraft();
    expect((await f.quotePost(d)).status).toBe(201);
    expect(
      (
        await f.enginePost({
          ...f.priceInput,
          operationId: randomUUID(),
          version: 1,
          amount: "200.00",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.post({
          ...f.clinical,
          operationId: randomUUID(),
          version: 1,
          title: "Changed clinical source",
        })
      ).status,
    ).toBe(200);
    const historical = (await (await f.quoteRead("finance", d.id)).json()).data;
    expect(historical.snapshot.total).toBe("700.00");
    expect(historical.snapshot.sourcePlanVersion).toBe(1);
    expect(historical.planVersion).toBe(2);
    expect((await f.quotePost({ ...d, operationId: randomUUID(), version: 1 })).status).toBe(409);
    expect(
      (
        await f.quotePost({
          ...d,
          operationId: randomUUID(),
          version: 1,
          expectedPlanVersion: 2,
          expectedPreviewHash: undefined,
        })
      ).status,
    ).toBe(200);
    const current = (await (await f.quoteRead("finance", d.id)).json()).data.snapshot;
    expect(current.total).toBe("1400.00");
    expect(current.lines[0].priceVersion).toBe(2);
    expect((await (await f.quoteRead("finance", d.id, 1)).json()).data.snapshot.total).toBe(
      "700.00",
    );
  });
  it("rejects a save when prices changed after the displayed preview", async () => {
    const f = await fixture(),
      d = f.quoteDraft();
    const preview = await f.quotePost({
      action: "PREVIEW",
      planId: f.clinical.id,
      expectedPlanVersion: 1,
    });
    expect(preview.status).toBe(200);
    const approved = { ...d, expectedPreviewHash: (await preview.json()).data.previewHash };
    expect(
      (
        await f.enginePost({
          ...f.priceInput,
          operationId: randomUUID(),
          version: 1,
          amount: "110.00",
        })
      ).status,
    ).toBe(200);
    const rejected = await f.quotePost(approved);
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).error).toContain("Preços ou vínculos alterados");
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int n FROM inventory_plan_quotes WHERE plan_id=$1",
          [f.clinical.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await f.quotePost({ ...approved, expectedPreviewHash: undefined })).status).toBe(201);
  });
  it("keeps unusable prices unresolved without fabricating zero totals", async () => {
    const f = await fixture();
    expect(
      (
        await f.enginePost({
          ...f.priceInput,
          operationId: randomUUID(),
          version: 1,
          availability: "UNKNOWN",
        })
      ).status,
    ).toBe(200);
    const response = await f.quotePost({
      action: "PREVIEW",
      planId: f.clinical.id,
      expectedPlanVersion: 1,
    });
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.complete).toBe(false);
    expect(data.total).toBeNull();
    expect(data.subtotal).toBeNull();
    expect(data.lines[0]).toMatchObject({
      status: "UNRESOLVED",
      unitPrice: null,
      subtotal: null,
      priceVersion: 2,
    });
  });
  it("restricts discounts to SUPER_ADMIN and clinical authors to their own source plan", async () => {
    const f = await fixture(),
      d = { ...f.quoteDraft(), discountBps: 1000 };
    expect((await f.quotePost(d)).status).toBe(403);
    expect((await f.quotePost(d, "partner")).status).toBe(403);
    expect((await f.quotePost(d, "reviewer")).status).toBe(201);
    expect((await (await f.quoteRead("finance", d.id)).json()).data.snapshot).toMatchObject({
      discountAmount: "70.00",
      total: "630.00",
    });
    expect((await f.quotePost({ ...d, operationId: randomUUID(), version: 1 })).status).toBe(403);
    expect(
      (
        await f.quotePost(
          { action: "PREVIEW", planId: f.clinical.id, expectedPlanVersion: 1 },
          "colleague",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.quotePost(
          { action: "PREVIEW", planId: f.clinical.id, expectedPlanVersion: 1 },
          "owner",
        )
      ).status,
    ).toBe(200);
  });
  it("replays concurrent identical operations once and rejects changed retries and stale concurrent revisions", async () => {
    const f = await fixture(),
      d = f.quoteDraft();
    const responses = await Promise.all([f.quotePost(d), f.quotePost(d)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
    expect((await f.quotePost({ ...d, discountBps: 100 }, "reviewer")).status).toBe(409);
    const snapshot = (await (await f.quoteRead("finance", d.id)).json()).data.snapshot,
      key = snapshot.lines[0].candidateKey;
    const change = {
      ...d,
      version: 1,
      expectedPreviewHash: undefined,
      overrides: [{ candidateKey: key, selected: true, quantity: "8", unit: "SESSION" }],
    };
    const updates = await Promise.all([
      f.quotePost({ ...change, operationId: randomUUID() }),
      f.quotePost({
        ...change,
        operationId: randomUUID(),
        overrides: [{ ...change.overrides[0], quantity: "9" }],
      }),
    ]);
    expect(updates.map((r) => r.status).sort()).toEqual([200, 409]);
    const count = await getPool().query(
      "SELECT (SELECT count(*)::int FROM inventory_plan_quote_versions WHERE quote_id=$1) versions,(SELECT count(*)::int FROM inventory_plan_quote_events WHERE quote_id=$1) events",
      [d.id],
    );
    expect(count.rows).toEqual([{ versions: 2, events: 2 }]);
  });
  it("enforces organization, original plan unit and current patient unit on desk and detail", async () => {
    const f = await fixture(),
      foreign = await fixture(),
      d = f.quoteDraft();
    expect((await f.quotePost(d)).status).toBe(201);
    expect((await foreign.quoteRead("finance", d.id)).status).toBe(404);
    expect((await f.quoteRead("outside", d.id)).status).toBe(404);
    expect((await (await f.desk("outside")).json()).data.estimates).toEqual([]);
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.clinical.patientId,
      f.otherUnit,
    ]);
    expect((await f.quoteRead("finance", d.id)).status).toBe(404);
    expect((await (await f.desk()).json()).data.estimates).toEqual([]);
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [f.users["finance"]!.membership, f.otherUnit],
    );
    expect((await f.quoteRead("finance", d.id)).status).toBe(200);
    expect((await f.quoteRead("outside", d.id)).status).toBe(404);
  });
  it("fails closed on commercial disclosure audit outage", async () => {
    const f = await fixture(),
      d = f.quoteDraft();
    expect((await f.quotePost(d)).status).toBe(201);
    const failure = vi
      .spyOn(accessAudit, "recordClinicalAccess")
      .mockRejectedValueOnce(new Error("Synthetic audit outage"));
    try {
      expect((await f.quoteRead("finance", d.id)).status).toBe(503);
    } finally {
      failure.mockRestore();
    }
    const listFailure = vi
      .spyOn(accessAudit, "recordClinicalListAccess")
      .mockRejectedValueOnce(new Error("Synthetic audit outage"));
    try {
      expect((await f.desk()).status).toBe(503);
    } finally {
      listFailure.mockRestore();
    }
  });
  it("protects snapshots, audit and price provenance at the database boundary", async () => {
    const f = await fixture(),
      d = f.quoteDraft();
    expect((await f.quotePost(d)).status).toBe(201);
    for (const table of ["inventory_plan_quote_versions", "inventory_plan_quote_events"]) {
      await expect(
        getPool().query(`DELETE FROM ${table} WHERE quote_id=$1`, [d.id]),
      ).rejects.toThrow();
      await expect(
        getPool().query(
          `UPDATE ${table} SET ${table.endsWith("versions") ? "snapshot" : "after_data"}='{}' WHERE quote_id=$1`,
          [d.id],
        ),
      ).rejects.toThrow();
      await expect(getPool().query(`TRUNCATE ${table} CASCADE`)).rejects.toThrow();
    }
    for (const field of ["unit", "targetType"]) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE inventory_plan_quotes SET version=version+1 WHERE id=$1", [
          d.id,
        ]);
        const snapshot = (
          await client.query(
            "SELECT jsonb_set(v.snapshot,'{head}',to_jsonb(q)) snapshot FROM inventory_plan_quotes q JOIN inventory_plan_quote_versions v ON v.quote_id=q.id AND v.version=1 WHERE q.id=$1",
            [d.id],
          )
        ).rows[0].snapshot;
        snapshot.estimate.lines[0][field] = "FORGED";
        await expect(
          client.query(
            "INSERT INTO inventory_plan_quote_versions(quote_id,organization_id,unit_id,version,snapshot) VALUES($1,$2,$3,2,$4)",
            [d.id, f.org, f.unit, JSON.stringify(snapshot)],
          ),
        ).rejects.toThrow("Invalid frozen sale price provenance");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    }
  });
  it("allowlists snapshots containing unknown nested clinical or cost fields", async () => {
    const f = await fixture(),
      d = f.quoteDraft();
    expect((await f.quotePost(d)).status).toBe(201);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE inventory_plan_quotes SET version=version+1 WHERE id=$1", [d.id]);
      const snapshot = (
        await client.query(
          "SELECT jsonb_set(v.snapshot,'{head}',to_jsonb(q)) snapshot FROM inventory_plan_quotes q JOIN inventory_plan_quote_versions v ON v.quote_id=q.id AND v.version=1 WHERE q.id=$1",
          [d.id],
        )
      ).rows[0].snapshot;
      snapshot.estimate.internalClinical = { diagnosis: "CLINICAL_SECRET" };
      snapshot.estimate.lines[0].internalCosts = { cost: "CLINICAL_SECRET" };
      snapshot.estimate.lines[0].injectedUnknown = "CLINICAL_SECRET";
      await client.query(
        "INSERT INTO inventory_plan_quote_versions(quote_id,organization_id,unit_id,version,snapshot) VALUES($1,$2,$3,2,$4)",
        [d.id, f.org, f.unit, JSON.stringify(snapshot)],
      );
      await client.query(
        "INSERT INTO inventory_plan_quote_events(quote_id,organization_id,unit_id,actor_user_id,operation_id,request_hash,after_data,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          d.id,
          f.org,
          f.unit,
          f.users["finance"]!.id,
          randomUUID(),
          "a".repeat(64),
          JSON.stringify(snapshot),
          JSON.stringify({ id: d.id, version: 2 }),
        ],
      );
      await client.query("COMMIT");
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    const response = await f.quoteRead("finance", d.id);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("CLINICAL_SECRET");
    expect(
      JSON.stringify(
        planQuoteSnapshotDto({
          estimate: {
            lines: [
              { label: { nested: "CLINICAL_SECRET" }, mappingIds: [{ secret: "CLINICAL_SECRET" }] },
            ],
          },
        }),
      ),
    ).not.toContain("CLINICAL_SECRET");
  });
});
