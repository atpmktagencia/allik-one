import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { hashToken } from "./auth";
import { getDb, getPool } from "./db";
import { patientDocumentsResponse, patientDocumentFileResponse } from "./patient-document-center";

const storage = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => storage);
const fault = vi.hoisted(() => ({ commitOnce: false }));
vi.mock("./db", async (original) => {
  const actual = await original<typeof import("./db")>();
  return {
    ...actual,
    getPool: () => {
      const pool = actual.getPool();
      return new Proxy(pool, {
        get(target, key) {
          if (key === "connect")
            return async () => {
              const client = await target.connect();
              return new Proxy(client, {
                get(c, k) {
                  if (k === "query")
                    return async (...args: unknown[]) => {
                      const result = await (
                        c.query as (...values: unknown[]) => Promise<unknown>
                      ).apply(c, args);
                      if (args[0] === "COMMIT" && fault.commitOnce) {
                        fault.commitOnce = false;
                        throw new Error("Synthetic lost COMMIT acknowledgement");
                      }
                      return result;
                    };
                  const value = Reflect.get(c, k);
                  return typeof value === "function" ? value.bind(c) : value;
                },
              });
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});
const origin = "http://localhost:4317";
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw Error("Disposable test database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await getPool().end();
});
async function fixture(role = "CLINICIAN") {
  const org = randomUUID(),
    unit = randomUUID(),
    otherUnit = randomUUID(),
    user = randomUUID(),
    membership = randomUUID(),
    token = randomUUID(),
    patient = randomUUID(),
    otherPatient = randomUUID();
  const pool = getPool();
  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Document security ${org}`,
  ]);
  await pool.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Original'),($2,$3,'Transferred')",
    [unit, otherUnit, org],
  );
  await pool.query(
    "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Document clinician',$2,'CRM','123','CE')",
    [user, `${user}@example.test`],
  );
  await pool.query(
    "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)",
    [membership, user, org, role],
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
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$3,$4,'DOC-A','Synthetic document patient'),($2,$3,$4,'DOC-B','Other synthetic patient')",
    [patient, otherPatient, org, unit],
  );
  const headers = { cookie: `allik_inventory_session=${token}`, Origin: origin };
  const read = (query = "") =>
    patientDocumentsResponse(
      new Request(`${origin}/api/v1/inventory/patient-documents?patientId=${patient}${query}`, {
        headers,
      }),
    );
  const file = (id: string, patientId = patient) =>
    patientDocumentFileResponse(
      new Request(
        `${origin}/api/v1/inventory/patient-document-file?patientId=${patientId}&sourceKind=GENERAL_DOCUMENT&sourceId=${id}`,
        { headers },
      ),
    );
  const insert = async (patientId = patient, at = new Date().toISOString()) => {
    const id = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO inventory_patient_documents(id,organization_id,unit_id,patient_id,title,categories,blob_pathname,original_filename,content_type,size_bytes,sha256,uploaded_by_user_id,created_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'Private imported document',ARRAY['OTHER'],'patient-documents/'||$2::uuid::text||'/'||$4::uuid::text||'/'||$1::uuid::text||'.pdf','synthetic.pdf','application/pdf',20,$5,$6::uuid,$7::timestamptz)",
        [id, org, unit, patientId, "a".repeat(64), user, at],
      );
      await client.query(
        "INSERT INTO inventory_patient_document_events(organization_id,unit_id,document_id,actor_user_id,action) VALUES($1,$2,$3,$4,'UPLOADED')",
        [org, unit, id, user],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return id;
  };
  return {
    org,
    unit,
    otherUnit,
    user,
    membership,
    patient,
    otherPatient,
    headers,
    read,
    file,
    insert,
  };
}
describe("Patient document ambiguous commit retention", () => {
  it("retains a committed original after a lost COMMIT acknowledgement and replays without another upload", async () => {
    const f = await fixture(),
      id = randomUUID();
    storage.put.mockImplementation(async (pathname: string) => ({ pathname }));
    storage.put.mockClear();
    storage.del.mockClear();
    const request = () => {
      const form = new FormData();
      form.set("id", id);
      form.set("patientId", f.patient);
      form.set("title", "Synthetic clinical original");
      form.set("categories", JSON.stringify(["OTHER"]));
      form.set(
        "file",
        new File(["%PDF-1.7 synthetic original"], "original.pdf", { type: "application/pdf" }),
      );
      return new Request(`${origin}/api/v1/inventory/patient-documents`, {
        method: "POST",
        headers: f.headers,
        body: form,
      });
    };
    fault.commitOnce = true;
    expect((await patientDocumentsResponse(request())).status).toBe(503);
    expect(
      (await getPool().query("SELECT id FROM inventory_patient_documents WHERE id=$1", [id])).rows,
    ).toEqual([{ id }]);
    expect(storage.del).not.toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect((await patientDocumentsResponse(request())).status).toBe(200);
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.del).not.toHaveBeenCalled();
  });
});
