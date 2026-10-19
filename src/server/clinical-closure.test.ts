import { encounterReviewLaboratoryResource } from "../data/care-encounter-resources";
import { patientDocumentsResponse } from "./patient-document-center";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import { careAppointmentsResponse } from "./care-appointments";
import { careEncounterResponse } from "./care-encounter";
import { patientTreatmentPlansResponse } from "./patient-treatment-plans";
const origin = "https://allergy-test.example";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw new Error("Disposable test database required");
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
    otherUnit = randomUUID(),
    user = randomUUID(),
    patient = randomUUID(),
    appointment = randomUUID(),
    membership = randomUUID(),
    token = randomUUID(),
    councilNumber = String(parseInt(randomUUID().slice(0, 8), 16));
  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    "Allergy test " + org,
  ]);
  await pool.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Fortaleza'),($2,$3,'Juazeiro')",
    [unit, otherUnit, org],
  );
  await pool.query(
    "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Synthetic clinician',$2,'CRM',$3,'CE')",
    [user, user + "@example.test", councilNumber],
  );
  await pool.query(
    "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'CLINICIAN')",
    [membership, user, org],
  );
  await pool.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
    membership,
    unit,
  ]);
  await pool.query(
    "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
    [user, hashToken(token)],
  );
  await pool.query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'ALLERGY-TEST','Synthetic patient')",
    [patient, org, unit],
  );
  await pool.query(
    "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour','Test room')",
    [appointment, org, unit, patient, user],
  );
  await pool.query("UPDATE inventory_care_appointments SET status='IN_PROGRESS' WHERE id=$1", [
    appointment,
  ]);
  const request = (path: string, data?: unknown) =>
    new Request(`${origin}/api/v1/inventory/${path}`, {
      method: data ? "POST" : "GET",
      headers: {
        cookie: `allik_inventory_session=${token}`,
        origin,
        "Content-Type": "application/json",
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  const complete = () =>
    careAppointmentsResponse(
      request("care-appointments", {
        action: "UPDATE_STATUS",
        id: appointment,
        unitId: unit,
        patientId: patient,
        professionalUserId: user,
        careType: "CONSULTATION",
        otherCareType: null,
        startsAt: "2026-10-19T10:00:00.000Z",
        endsAt: "2026-10-19T11:00:00.000Z",
        room: "Test room",
        chair: null,
        resourceName: null,
        notes: "",
        status: "COMPLETED",
        version: 0,
        reason: "Synthetic clinical closure test",
      }),
    );
  return {
    org,
    unit,
    otherUnit,
    user,
    patient,
    appointment,
    membership,
    request,
    complete,
    councilNumber,
  };
}
async function note(f: Awaited<ReturnType<typeof fixture>>, status: string) {
  await getPool().query(
    `INSERT INTO inventory_clinical_notes(organization_id,unit_id,patient_id,appointment_id,author_user_id,author_name,professional_council,council_number,council_region,evolution,conduct,status,finalized_at)
    VALUES($1,$2,$3,$4,$5,'Synthetic clinician','CRM',$7,'CE','Synthetic evolution content','Synthetic conduct',$6,CASE WHEN $6='FINAL' THEN now() END)`,
    [f.org, f.unit, f.patient, f.appointment, f.user, status, f.councilNumber],
  );
}

describe("Authoritative clinical closure", () => {
  it("accepts the actual review resource contract at the document API", async () => {
    const f = await fixture();
    const response = await patientDocumentsResponse(
      f.request(encounterReviewLaboratoryResource(f.patient, f.unit)),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.documents).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("requires a final evolution but does not require a prescription or exams", async () => {
    const f = await fixture();
    const missing = await f.complete();
    expect(missing.status).toBe(409);
    expect((await missing.json()).error).toMatch(/evolução/);
    await note(f, "DRAFT");
    expect((await f.complete()).status).toBe(409);
    await getPool().query(
      "UPDATE inventory_clinical_notes SET status='FINAL',finalized_at=now() WHERE appointment_id=$1",
      [f.appointment],
    );
    expect((await f.complete()).status).toBe(200);
    const read = await careEncounterResponse(
      f.request(`care-encounter?appointmentId=${f.appointment}`),
    );
    expect((await read.json()).data).toMatchObject({
      canAuthorClinicalNote: false,
      canClaimClinicalNote: false,
    });
    const write = await careEncounterResponse(
      f.request("care-encounter", {
        action: "SAVE_DRAFT",
        appointmentId: f.appointment,
        evolution: "Late synthetic evolution",
        conduct: "",
        version: 0,
      }),
    );
    expect(write.status).toBe(409);
  });
  it("does not create or finalize a late evolution in a legacy completed encounter", async () => {
    const f = await fixture();
    await getPool().query("UPDATE inventory_care_appointments SET status='COMPLETED' WHERE id=$1", [
      f.appointment,
    ]);
    const read = await careEncounterResponse(
      f.request(`care-encounter?appointmentId=${f.appointment}`),
    );
    expect((await read.json()).data.canAuthorClinicalNote).toBe(false);
    for (const action of ["SAVE_DRAFT", "FINALIZE"]) {
      expect(
        (
          await careEncounterResponse(
            f.request("care-encounter", {
              action,
              appointmentId: f.appointment,
              evolution: "Synthetic late attempt",
              conduct: "",
              version: null,
            }),
          )
        ).status,
      ).toBe(409);
    }
    expect(
      (
        await getPool().query("SELECT id FROM inventory_clinical_notes WHERE appointment_id=$1", [
          f.appointment,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it.each(["prescription", "document"])(
    "rejects closure with a persisted %s draft",
    async (kind) => {
      const f = await fixture();
      await note(f, "FINAL");
      if (kind === "prescription")
        await getPool().query(
          `INSERT INTO inventory_encounter_prescriptions(organization_id,unit_id,patient_id,appointment_id,author_user_id,author_name,professional_council,council_number,council_region,items,general_instructions,status)
       VALUES($1,$2,$3,$4,$5,'Synthetic clinician','CRM',$6,'CE','[]','Synthetic pending instructions','DRAFT')`,
          [f.org, f.unit, f.patient, f.appointment, f.user, f.councilNumber],
        );
      else
        await getPool().query(
          `INSERT INTO inventory_encounter_documents(organization_id,unit_id,patient_id,appointment_id,author_user_id,author_name,professional_council,council_number,council_region,type,title,content,status)
       VALUES($1,$2,$3,$4,$5,'Synthetic clinician','CRM',$6,'CE','INSTRUCTIONS','Synthetic instructions','Synthetic draft text','DRAFT')`,
          [f.org, f.unit, f.patient, f.appointment, f.user, f.councilNumber],
        );
      const response = await f.complete();
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/rascunho/);
    },
  );
  it("allows genuine empty draft containers, but not rich document content", async () => {
    const f = await fixture();
    await note(f, "FINAL");
    await getPool().query(
      `INSERT INTO inventory_encounter_prescriptions(organization_id,unit_id,patient_id,appointment_id,author_user_id,author_name,professional_council,council_number,council_region,items,general_instructions,status)
       VALUES($1,$2,$3,$4,$5,'Synthetic clinician','CRM',$6,'CE','[]','','DRAFT')`,
      [f.org, f.unit, f.patient, f.appointment, f.user, f.councilNumber],
    );
    const document = await getPool().query(
      `INSERT INTO inventory_encounter_documents(organization_id,unit_id,patient_id,appointment_id,author_user_id,author_name,professional_council,council_number,council_region,type,title,content,rich_content,status)
       VALUES($1,$2,$3,$4,$5,'Synthetic clinician','CRM',$6,'CE','INSTRUCTIONS','Synthetic instructions','',$7,'DRAFT') RETURNING id`,
      [
        f.org,
        f.unit,
        f.patient,
        f.appointment,
        f.user,
        f.councilNumber,
        JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Pending rich clinical content" }],
            },
          ],
        }),
      ],
    );
    expect((await f.complete()).status).toBe(409);
    await getPool().query("UPDATE inventory_encounter_documents SET rich_content=$2 WHERE id=$1", [
      document.rows[0].id,
      JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
    ]);
    expect((await f.complete()).status).toBe(200);
  });
  it("blocks a linked draft clinical plan until it is explicitly archived", async () => {
    const f = await fixture();
    await note(f, "FINAL");
    const planId = randomUUID();
    const payload = {
      action: "SAVE_PLAN",
      id: planId,
      operationId: randomUUID(),
      version: null,
      patientId: f.patient,
      appointmentId: f.appointment,
      title: "Synthetic pending plan",
      status: "DRAFT",
      plan: {
        startDate: "2026-10-19",
        previewDays: 30,
        items: [
          {
            id: randomUUID(),
            kind: "SERVICE",
            title: "Synthetic clinical service",
            productId: null,
            catalogItemId: null,
            appointmentId: f.appointment,
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
      },
    };
    const created = await patientTreatmentPlansResponse(
      f.request("patient-treatment-plans", payload),
    );
    expect(created.status).toBe(201);
    expect((await f.complete()).status).toBe(409);
    const archived = await patientTreatmentPlansResponse(
      f.request("patient-treatment-plans", {
        ...payload,
        version: 1,
        operationId: randomUUID(),
        status: "ARCHIVED",
      }),
    );
    expect(archived.status).toBe(200);
    expect((await f.complete()).status).toBe(200);
  });
  it("checks clinical state only after acquiring the appointment lock", async () => {
    const f = await fixture();
    await note(f, "FINAL");
    const writer = await getPool().connect();
    try {
      await writer.query("BEGIN");
      await writer.query("SELECT id FROM inventory_care_appointments WHERE id=$1 FOR UPDATE", [
        f.appointment,
      ]);
      const completion = f.complete();
      await writer.query(
        `INSERT INTO inventory_encounter_prescriptions(organization_id,unit_id,patient_id,appointment_id,author_user_id,author_name,professional_council,council_number,council_region,items,general_instructions,status)
         VALUES($1,$2,$3,$4,$5,'Synthetic clinician','CRM',$6,'CE','[]','Synthetic pending instructions','DRAFT')`,
        [f.org, f.unit, f.patient, f.appointment, f.user, f.councilNumber],
      );
      await writer.query("COMMIT");
      expect((await completion).status).toBe(409);
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
  });
});
