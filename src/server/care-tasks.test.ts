import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken } from "./auth";
import { careTasksResponse } from "./care-tasks";
const origin = "https://tasks.example.test";
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
  const p = getPool(),
    org = randomUUID(),
    unit = randomUUID(),
    otherUnit = randomUUID(),
    user = randomUUID(),
    membership = randomUUID(),
    patient = randomUUID(),
    appointment = randomUUID(),
    token = randomUUID();
  await p.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    "Tasks " + org,
  ]);
  await p.query(
    "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$3,'Unit one'),($2,$3,'Unit two')",
    [unit, otherUnit, org],
  );
  await p.query("INSERT INTO inventory_users(id,name,email) VALUES($1,'Synthetic operator',$2)", [
    user,
    user + "@example.test",
  ]);
  await p.query(
    "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'UNIT_MANAGER')",
    [membership, user, org],
  );
  await p.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
    membership,
    unit,
  ]);
  await p.query(
    "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
    [user, hashToken(token)],
  );
  await p.query(
    "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'TASKS','Synthetic patient')",
    [patient, org, unit],
  );
  await p.query(
    "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour','Room')",
    [appointment, org, unit, patient, user],
  );
  const post = (data: unknown, requestOrigin = origin) =>
    careTasksResponse(
      new Request(origin + "/api/v1/inventory/care-tasks", {
        method: "POST",
        headers: {
          cookie: `allik_inventory_session=${token}`,
          origin: requestOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      }),
    );
  const read = (params = "") =>
    careTasksResponse(
      new Request(origin + "/api/v1/inventory/care-tasks" + params, {
        headers: { cookie: `allik_inventory_session=${token}` },
      }),
    );
  const draft = () => ({
    action: "CREATE",
    id: randomUUID(),
    patientId: patient,
    appointmentId: appointment,
    kind: "RETURN",
    title: "Agendar retorno",
    instructions: "Contatar para combinar horário",
    dueOn: "2020-01-01",
    assigneeUserId: user,
  });
  return { org, unit, otherUnit, user, membership, patient, appointment, post, read, draft };
}
describe("Care team tasks", () => {
  it("preserves transferred-patient tasks without disclosing them to a holder missing either unit", async () => {
    const f = await fixture(),
      d = f.draft();
    await f.post(d);
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.patient,
      f.otherUnit,
    ]);
    expect((await (await f.read()).json()).data.tasks).toHaveLength(0);
    expect((await f.read(`?historyFor=${d.id}`)).status).toBe(404);
    expect(
      (
        await f.post({
          action: "STATUS",
          id: d.id,
          version: 0,
          status: "DONE",
          reason: "Retorno realizado",
        })
      ).status,
    ).toBe(404);
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [f.membership, f.otherUnit],
    );
    expect((await (await f.read()).json()).data.tasks[0].unitId).toBe(f.unit);
    expect(
      (
        await f.post({
          action: "STATUS",
          id: d.id,
          version: 0,
          status: "DONE",
          reason: "Retorno realizado",
        })
      ).status,
    ).toBe(200);
    expect((await f.read(`?historyFor=${d.id}`)).status).toBe(200);
  });

  it("exposes bounded history only within the holder's patient/unit scope", async () => {
    const f = await fixture(),
      other = await fixture(),
      d = f.draft();
    await f.post(d);
    const history = await f.read(`?historyFor=${d.id}`);
    expect(history.status).toBe(200);
    const { data } = await history.json();
    expect(data.events).toHaveLength(1);
    expect(data.events[0]).toMatchObject({
      reason: "Criação de tarefa",
      status: "OPEN",
      version: "0",
    });
    expect(data.events[0].afterData).toBeUndefined();
    expect((await other.read(`?historyFor=${d.id}`)).status).toBe(404);
    await getPool().query("UPDATE inventory_unit_access SET unit_id=$2 WHERE membership_id=$1", [
      f.membership,
      f.otherUnit,
    ]);
    expect((await f.read(`?historyFor=${d.id}`)).status).toBe(404);
  });
  it("allows closing a task after its assignee is deactivated, preserving the original holder", async () => {
    const f = await fixture(),
      admin = await fixture(),
      d = f.draft();
    await f.post(d);
    await getPool().query(
      "UPDATE inventory_memberships SET role='SUPER_ADMIN',organization_id=$2 WHERE id=$1",
      [admin.membership, f.org],
    );
    await getPool().query("UPDATE inventory_users SET active=false WHERE id=$1", [f.user]);
    expect(
      (
        await admin.post({
          action: "STATUS",
          id: d.id,
          version: 0,
          status: "CANCELED",
          reason: "Responsável saiu da equipe",
        })
      ).status,
    ).toBe(200);
    const t = await getPool().query(
      "SELECT assignee_user_id FROM inventory_care_tasks WHERE id=$1",
      [d.id],
    );
    expect(t.rows[0].assignee_user_id).toBe(f.user);
  });

  it("creates a scoped task, audits the change and list disclosure, and computes overdue", async () => {
    const f = await fixture(),
      d = f.draft();
    expect((await f.post(d)).status).toBe(201);
    const response = await f.read();
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]).toMatchObject({
      id: d.id,
      status: "OPEN",
      version: 0,
      overdue: true,
      patientId: f.patient,
    });
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int n FROM inventory_care_task_events WHERE task_id=$1",
          [d.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int n FROM inventory_clinical_access_events WHERE patient_id=$1",
          [f.patient],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("does not duplicate a create retried with the same operation ID", async () => {
    const f = await fixture(),
      d = f.draft();
    const responses = await Promise.all([f.post(d), f.post(d)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (
        await getPool().query("SELECT count(*)::int n FROM inventory_care_tasks WHERE id=$1", [
          d.id,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
  it("serializes concurrent updates and rejects a stale version", async () => {
    const f = await fixture(),
      d = f.draft();
    await f.post(d);
    const change = {
      action: "STATUS",
      id: d.id,
      version: 0,
      status: "IN_PROGRESS",
      reason: "Equipe iniciou contato",
    };
    expect(
      (await Promise.all([f.post(change), f.post(change)])).map((r) => r.status).sort(),
    ).toEqual([200, 409]);
  });
  it("keeps pending until explicit completion; requires a result and preserves terminal history on reopen", async () => {
    const f = await fixture(),
      d = f.draft();
    await f.post(d);
    expect(
      (await f.post({ action: "STATUS", id: d.id, version: 0, status: "DONE", reason: "" })).status,
    ).toBe(400);
    expect(
      (
        await f.post({
          action: "STATUS",
          id: d.id,
          version: 0,
          status: "DONE",
          reason: "Retorno agendado com o titular",
        })
      ).status,
    ).toBe(200);
    expect((await (await f.read()).json()).data.tasks).toHaveLength(0);
    expect((await (await f.read("?state=DONE")).json()).data.tasks[0].resolution).toBe(
      "Retorno agendado com o titular",
    );
    expect(
      (
        await f.post({
          action: "STATUS",
          id: d.id,
          version: 1,
          status: "IN_PROGRESS",
          reason: "Tentar novamente",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.post({
          action: "STATUS",
          id: d.id,
          version: 1,
          status: "OPEN",
          reason: "Paciente solicitou reagendamento",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int n FROM inventory_care_task_events WHERE task_id=$1",
          [d.id],
        )
      ).rows[0].n,
    ).toBe(3);
  });
  it("isolates another unit on read, write and assignment", async () => {
    const f = await fixture(),
      d = f.draft();
    await f.post(d);
    await getPool().query("UPDATE inventory_unit_access SET unit_id=$2 WHERE membership_id=$1", [
      f.membership,
      f.otherUnit,
    ]);
    expect((await (await f.read()).json()).data.tasks).toHaveLength(0);
    expect((await f.post({ ...f.draft() })).status).toBe(404);
    expect(
      (
        await f.post({
          action: "STATUS",
          id: d.id,
          version: 0,
          status: "DONE",
          reason: "Feito pela equipe",
        })
      ).status,
    ).toBe(404);
    expect((await f.read(`?unitId=${f.unit}`)).status).toBe(403);
  });
  it("rejects cross-organization patient, appointment and assignee identifiers", async () => {
    const f = await fixture(),
      foreign = await fixture();
    expect((await f.post({ ...f.draft(), patientId: foreign.patient })).status).toBe(404);
    expect((await f.post({ ...f.draft(), appointmentId: foreign.appointment })).status).toBe(404);
    expect((await f.post({ ...f.draft(), assigneeUserId: foreign.user })).status).toBe(409);
  });
  it("rejects an inactive or out-of-unit assignee", async () => {
    const f = await fixture();
    await getPool().query("DELETE FROM inventory_unit_access WHERE membership_id=$1", [
      f.membership,
    ]);
    // A scoped admin can create in the unit, but cannot assign to a removed holder.
    const admin = await fixture();
    await getPool().query(
      "UPDATE inventory_memberships SET role='SUPER_ADMIN',organization_id=$2 WHERE id=$1",
      [admin.membership, f.org],
    );
    expect((await admin.post({ ...f.draft(), id: randomUUID() })).status).toBe(409);
  });
  it("requires authenticated, same-origin, individually authorized writes", async () => {
    const f = await fixture();
    expect(
      (await careTasksResponse(new Request(origin + "/api/v1/inventory/care-tasks"))).status,
    ).toBe(401);
    expect((await f.post(f.draft(), "https://foreign.test")).status).toBe(403);
    await getPool().query("UPDATE inventory_memberships SET role='VIEWER' WHERE id=$1", [
      f.membership,
    ]);
    expect((await f.read()).status).toBe(403);
    expect((await f.post(f.draft())).status).toBe(403);
  });
  it("protects audit history and original patient/appointment links at the database boundary", async () => {
    const f = await fixture(),
      d = f.draft();
    await f.post(d);
    await expect(
      getPool().query("DELETE FROM inventory_care_tasks WHERE id=$1", [d.id]),
    ).rejects.toThrow();
    await expect(
      getPool().query("UPDATE inventory_care_task_events SET after_data='{}' WHERE task_id=$1", [
        d.id,
      ]),
    ).rejects.toThrow();
    await expect(
      getPool().query(
        "UPDATE inventory_care_tasks SET appointment_id=NULL,version=version+1 WHERE id=$1",
        [d.id],
      ),
    ).rejects.toThrow();
  });
  it("paginates and bounds task disclosure", async () => {
    const f = await fixture();
    for (let i = 0; i < 52; i++)
      expect((await f.post({ ...f.draft(), title: `Tarefa ${i}` })).status).toBe(201);
    const a = (await (await f.read()).json()).data,
      b = (await (await f.read("?offset=50")).json()).data;
    expect(a.tasks).toHaveLength(50);
    expect(a.hasMore).toBe(true);
    expect(b.tasks).toHaveLength(2);
    expect(b.hasMore).toBe(false);
    expect(new Set([...a.tasks, ...b.tasks].map((t) => t.id)).size).toBe(52);
  });
});
