import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { hashToken } from "./auth";
import { getDb, getPool } from "./db";
import { encounterDocumentsResponse } from "./encounter-documents";

const origin = "http://localhost:4317";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw new Error("Integration tests require a dedicated *_test database.");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await getPool().end();
});

async function fixture() {
  const organizationId = randomUUID(),
    unitId = randomUUID(),
    patientId = randomUUID();
  const userId = randomUUID(),
    appointmentId = randomUUID(),
    membershipId = randomUUID();
  const token = randomUUID();
  await getPool().query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    organizationId,
    `Snapshot test organization ${organizationId}`,
  ]);
  await getPool().query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Snapshot unit original')",
    [unitId, organizationId],
  );
  await getPool().query(
    "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Draft author',$2,'CRM','12345','CE')",
    [userId, `${userId}@example.test`],
  );
  await getPool().query(
    "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'PARTNER_ADMIN')",
    [membershipId, userId, organizationId],
  );
  await getPool().query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
    membershipId,
    unitId,
  ]);
  await getPool().query(
    "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
    [userId, hashToken(token)],
  );
  await getPool().query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'SNAP-ORIGINAL','Snapshot patient original')",
    [patientId, organizationId, unitId],
  );
  await getPool().query(
    "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION','2031-02-12T10:00:00Z','2031-02-12T11:00:00Z','Snapshot room')",
    [appointmentId, organizationId, unitId, patientId, userId],
  );
  const post = (extra: Record<string, unknown> = {}) =>
    encounterDocumentsResponse(
      new Request(`${origin}/api/v1/inventory/encounter-documents`, {
        method: "POST",
        headers: {
          cookie: `allik_inventory_session=${token}`,
          origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "SAVE_DRAFT",
          appointmentId,
          documentId: null,
          type: "PRESCRIPTION",
          title: "Snapshot document",
          content: "Frozen clinical instructions",
          version: null,
          ...extra,
        }),
      }),
    );
  const get = (query = `appointmentId=${appointmentId}`) =>
    encounterDocumentsResponse(
      new Request(`${origin}/api/v1/inventory/encounter-documents?${query}`, {
        headers: { cookie: `allik_inventory_session=${token}` },
      }),
    );
  return { organizationId, unitId, patientId, userId, appointmentId, post, get };
}

describe("final document snapshots", () => {
  it("freezes final patient/unit/current clinician identity and preserves stale version protection", async () => {
    const f = await fixture();
    const draft = (await (await f.post()).json()).data;
    await getPool().query(
      "UPDATE inventory_users SET name='Final author',council_number='54321' WHERE id=$1",
      [f.userId],
    );
    expect(
      (await f.post({ action: "FINALIZE", documentId: draft.id, version: draft.version + 1 }))
        .status,
    ).toBe(409);
    expect(
      (await f.post({ action: "FINALIZE", documentId: draft.id, version: draft.version })).status,
    ).toBe(200);
    const before = await (await f.get(`documentId=${draft.id}&print=true`)).text();
    expect(before).toContain("Final author");
    expect(before).toContain("54321");
    expect(before).toContain("Snapshot patient original");
    await getPool().query(
      "UPDATE inventory_patients SET full_name='Changed patient',internal_code='SNAP-CHANGED' WHERE id=$1",
      [f.patientId],
    );
    await getPool().query("UPDATE inventory_units SET name='Changed unit' WHERE id=$1", [f.unitId]);
    await getPool().query(
      "UPDATE inventory_users SET name='Changed author',council_number='11111' WHERE id=$1",
      [f.userId],
    );
    const after = await (await f.get(`documentId=${draft.id}&print=true`)).text();
    expect(after).toBe(before);
    const listed = (await (await f.get()).json()).data.documents[0];
    expect(listed.authorName).toBe("Final author");
    expect(listed.councilNumber).toBe("54321");
    await expect(
      getPool().query("UPDATE inventory_encounter_documents SET final_snapshot='{}' WHERE id=$1", [
        draft.id,
      ]),
    ).rejects.toThrow();
  });

  it("does not backfill legacy finals and labels their live header honestly", async () => {
    const f = await fixture();
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO inventory_encounter_documents(id,organization_id,unit_id,appointment_id,patient_id,author_user_id,author_name,professional_council,council_number,council_region,type,title,content,status,finalized_at)
      VALUES($1,$2,$3,$4,$5,$6,'Historical author','CRM','98765','CE','PRESCRIPTION','Legacy document','Legacy instructions','FINAL',now())`,
      [id, f.organizationId, f.unitId, f.appointmentId, f.patientId, f.userId],
    );
    const printed = await (await f.get(`documentId=${id}&print=true`)).text();
    expect(printed).toContain("Documento legado");
    expect(printed).toContain("Historical author");
    expect(
      (
        await getPool().query(
          "SELECT final_snapshot FROM inventory_encounter_documents WHERE id=$1",
          [id],
        )
      ).rows[0].final_snapshot,
    ).toBeNull();
    await expect(
      getPool().query("UPDATE inventory_encounter_documents SET final_snapshot='{}' WHERE id=$1", [
        id,
      ]),
    ).rejects.toThrow();
    await expect(
      getPool().query("DELETE FROM inventory_encounter_documents WHERE id=$1", [id]),
    ).rejects.toThrow();
  });

  it("snapshots documents created directly final", async () => {
    const f = await fixture();
    const final = await f.post({ action: "FINALIZE" });
    expect(final.status).toBe(201);
    const id = (await final.json()).data.id;
    const saved = (
      await getPool().query(
        "SELECT final_snapshot,finalized_at FROM inventory_encounter_documents WHERE id=$1",
        [id],
      )
    ).rows[0];
    expect(saved.final_snapshot.patientName).toBe("Snapshot patient original");
    expect(saved.final_snapshot.finalizedAt).toBe(saved.finalized_at.toISOString());
  });
});
