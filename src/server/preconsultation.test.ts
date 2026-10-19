import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { hashToken, previewLogin } from "./auth";
import { preconsultationResponse, preconsultationPublicResponse } from "./preconsultation";
import * as accessAudit from "./clinical-access-audit";
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
    preconsultationResponse(
      new Request(origin + "/api/v1/inventory/preconsultation", {
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
    preconsultationResponse(
      new Request(origin + "/api/v1/inventory/preconsultation" + params, {
        headers: { cookie: `allik_inventory_session=${token}` },
      }),
    );
  const publicPost = (
    token: string,
    answers?: Record<string, string>,
    action = answers ? "SUBMIT" : "READ",
  ) =>
    preconsultationPublicResponse(
      new Request(origin + "/api/v1/preconsultation", {
        method: "POST",
        headers: { origin, "Content-Type": "application/json" },
        body: JSON.stringify({ action, token, answers }),
      }),
    );
  const formId = randomUUID();
  const questions = [
    { id: "concern", label: "O que deseja relatar?", type: "TEXT" },
    { id: "medicine", label: "Usa medicamento?", type: "CHOICE", options: ["Sim", "Não"] },
  ];
  const save = (version?: number, title = "Pré-consulta") =>
    post({
      action: "SAVE_FORM",
      id: formId,
      unitId: unit,
      title,
      description: "Respostas opcionais",
      questions,
      version,
    });
  const publish = (version = 0) => post({ action: "PUBLISH_FORM", id: formId, version });
  const invite = (overrides = {}) =>
    post({
      action: "INVITE",
      id: randomUUID(),
      patientId: patient,
      appointmentId: appointment,
      formId,
      expiresInDays: 7,
      ...overrides,
    });
  const ready = async () => {
    expect((await save()).status).toBe(200);
    expect((await publish()).status).toBe(200);
  };
  const issued = async () => {
    const response = await invite();
    expect(response.status).toBe(201);
    const { data } = await response.json();
    const url = new URL(data.link);
    expect(url.search).toBe("");
    const secret = new URLSearchParams(url.hash.slice(1)).get("token")!;
    expect(secret).toBeTruthy();
    return { id: data.id, token: secret };
  };
  return {
    org,
    unit,
    otherUnit,
    user,
    membership,
    patient,
    appointment,
    post,
    read,
    publicPost,
    formId,
    questions,
    save,
    publish,
    invite,
    ready,
    issued,
  };
}
describe("Preconsultation security and clinical integrity", () => {
  it("fails closed before issuing a reconciliable invitation when the server secret is unavailable", async () => {
    vi.stubEnv("INVENTORY_SESSION_SECRET", "");
    try {
      const f = await fixture();
      await f.ready();
      expect((await f.invite({ requestNonce: "a".repeat(43) })).status).toBe(503);
      expect(
        (
          await getPool().query(
            "SELECT count(*)::int n FROM inventory_preconsultation_invitations WHERE patient_id=$1",
            [f.patient],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("reconciles an issued invitation by stable operation and nonce without plaintext persistence or duplicate invitations", async () => {
    vi.stubEnv("INVENTORY_SESSION_SECRET", "synthetic-request-reconciliation-secret-32+");
    try {
      const f = await fixture();
      await f.ready();
      const id = randomUUID(),
        requestNonce = "n".repeat(43);
      const first = await f.invite({ id, requestNonce });
      expect(first.status).toBe(201);
      const original = (await first.json()).data;
      const retry = await f.invite({ id, requestNonce });
      expect(retry.status).toBe(200);
      expect((await retry.json()).data).toMatchObject({ id, link: original.link, replayed: true });
      expect((await f.invite({ id, requestNonce: "x".repeat(43) })).status).toBe(409);
      const records = await getPool().query(
        "SELECT * FROM inventory_preconsultation_invitations WHERE id=$1",
        [id],
      );
      expect(records.rowCount).toBe(1);
      const bearer = new URLSearchParams(new URL(original.link).hash.slice(1)).get("token")!;
      expect(bearer).not.toBe(requestNonce);
      expect(records.rows[0].token_hash).toBe(hashToken(bearer));
      expect(JSON.stringify(records.rows)).not.toContain(bearer);
      expect(JSON.stringify(records.rows)).not.toContain(requestNonce);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("replaces a lost pending link atomically and retries the replacement without reviving the previous bearer", async () => {
    vi.stubEnv("INVENTORY_SESSION_SECRET", "synthetic-request-reconciliation-secret-32+");
    try {
      const f = await fixture();
      await f.ready();
      const original = await f.issued();
      const replacementId = randomUUID(),
        requestNonce = "r".repeat(43);
      const command = { action: "REISSUE", id: original.id, replacementId, requestNonce };
      const result = await f.post(command);
      expect(result.status).toBe(201);
      const replacement = (await result.json()).data;
      const retry = await f.post(command);
      expect(retry.status).toBe(200);
      expect((await retry.json()).data.link).toBe(replacement.link);
      expect((await f.publicPost(original.token)).status).toBe(404);
      const replacementToken = new URLSearchParams(new URL(replacement.link).hash.slice(1)).get(
        "token",
      )!;
      expect((await f.publicPost(replacementToken)).status).toBe(200);
      expect(
        (
          await getPool().query(
            "SELECT count(*)::int n FROM inventory_preconsultation_invitations WHERE patient_id=$1",
            [f.patient],
          )
        ).rows[0].n,
      ).toBe(2);
      const another = await fixture();
      expect(
        (await another.post({ action: "REISSUE", id: replacementId, replacementId: randomUUID() }))
          .status,
      ).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("returns only a minimal receipt after submission, keeps replay closed and denies revocation after submission", async () => {
    const f = await fixture();
    await f.ready();
    const invitation = await f.issued();
    expect(
      (await f.publicPost(invitation.token, { concern: "Synthetic confidential answer" })).status,
    ).toBe(200);
    const status = await f.publicPost(invitation.token, undefined, "STATUS");
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ data: { submitted: true } });
    expect((await f.publicPost(invitation.token)).status).toBe(404);
    expect((await f.publicPost(invitation.token, {})).status).toBe(404);
    expect((await f.post({ action: "REVOKE", id: invitation.id })).status).toBe(409);
    expect(
      (await f.post({ action: "REISSUE", id: invitation.id, replacementId: randomUUID() })).status,
    ).toBe(409);
    const persisted = (
      await getPool().query(
        "SELECT revoked_at,submitted_at FROM inventory_preconsultation_invitations WHERE id=$1",
        [invitation.id],
      )
    ).rows[0];
    expect(persisted.revoked_at).toBeNull();
    expect(persisted.submitted_at).not.toBeNull();
  });
  it("does not expose a public receipt for expired, revoked or unknown bearers", async () => {
    const f = await fixture();
    await f.ready();
    const original = await f.issued();
    expect((await f.post({ action: "REVOKE", id: original.id })).status).toBe(200);
    expect((await f.publicPost(original.token, undefined, "STATUS")).status).toBe(404);
    expect((await f.publicPost("z".repeat(43), undefined, "STATUS")).status).toBe(404);
    const version = (
      await getPool().query("SELECT id FROM inventory_preconsultation_versions WHERE form_id=$1", [
        f.formId,
      ])
    ).rows[0].id;
    const expiredToken = "e".repeat(43);
    await getPool().query(
      "INSERT INTO inventory_preconsultation_invitations(id,organization_id,unit_id,patient_id,version_id,token_hash,created_by_user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()-interval '1 second')",
      [randomUUID(), f.org, f.unit, f.patient, version, hashToken(expiredToken), f.user],
    );
    const response = await f.publicPost(expiredToken, undefined, "STATUS");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Link inválido ou indisponível." });
  });
  it("keeps a minimal immutable audit trail for public use, invalid attempts and authenticated revocation", async () => {
    const f = await fixture();
    await f.ready();
    const invitation = await f.issued();
    await f.publicPost(invitation.token);
    await f.publicPost(invitation.token, { medicine: "Invalid choice" });
    await f.post({ action: "REVOKE", id: invitation.id });
    await f.publicPost(invitation.token);
    await f.publicPost("u".repeat(43));
    const events = (
      await getPool().query(
        "SELECT * FROM inventory_preconsultation_events WHERE invitation_id=$1 ORDER BY created_at",
        [invitation.id],
      )
    ).rows;
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "INVITE", outcome: "SUCCESS", actor_user_id: f.user }),
        expect.objectContaining({ action: "READ", outcome: "SUCCESS", actor_user_id: null }),
        expect.objectContaining({ action: "SUBMIT", outcome: "INVALID", actor_user_id: null }),
        expect.objectContaining({ action: "REVOKE", outcome: "SUCCESS", actor_user_id: f.user }),
        expect.objectContaining({ action: "READ", outcome: "UNAVAILABLE", actor_user_id: null }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain(invitation.token);
    expect(JSON.stringify(events)).not.toContain("Invalid choice");
    expect(events[0]).not.toHaveProperty("token_hash");
    expect(events[0]).not.toHaveProperty("answers");
    await expect(
      getPool().query(
        "UPDATE inventory_preconsultation_events SET outcome='INVALID' WHERE invitation_id=$1",
        [invitation.id],
      ),
    ).rejects.toThrow();
    await expect(
      getPool().query("DELETE FROM inventory_preconsultation_events WHERE invitation_id=$1", [
        invitation.id,
      ]),
    ).rejects.toThrow();
  });
  it("rolls back a public submission when its audit event cannot be persisted", async () => {
    const f = await fixture();
    await f.ready();
    const invitation = await f.issued();
    // Both the table and this synthetic UUID belong exclusively to the disposable database.
    await getPool().query(
      `ALTER TABLE inventory_preconsultation_events ADD CONSTRAINT test_preconsultation_audit_outage CHECK (invitation_id<>'${invitation.id}'::uuid OR action<>'SUBMIT') NOT VALID`,
    );
    try {
      expect((await f.publicPost(invitation.token, { concern: "Must roll back" })).status).toBe(
        503,
      );
      expect(
        (
          await getPool().query(
            "SELECT count(*)::int n FROM inventory_preconsultation_responses WHERE invitation_id=$1",
            [invitation.id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await getPool().query(
            "SELECT submitted_at FROM inventory_preconsultation_invitations WHERE id=$1",
            [invitation.id],
          )
        ).rows[0].submitted_at,
      ).toBeNull();
    } finally {
      await getPool().query(
        "ALTER TABLE inventory_preconsultation_events DROP CONSTRAINT test_preconsultation_audit_outage",
      );
    }
    expect((await f.publicPost(invitation.token, { concern: "Audited response" })).status).toBe(
      200,
    );
  });
  it("serializes replacing a link against a concurrent response without losing or reopening submitted answers", async () => {
    const f = await fixture();
    await f.ready();
    const invitation = await f.issued();
    const replacementId = randomUUID();
    const [submission, replacement] = await Promise.all([
      f.publicPost(invitation.token, { concern: "Concurrent response" }),
      f.post({ action: "REISSUE", id: invitation.id, replacementId }),
    ]);
    expect([
      [200, 409],
      [404, 201],
    ]).toContainEqual([submission.status, replacement.status]);
    const original = (
      await getPool().query(
        "SELECT submitted_at,revoked_at FROM inventory_preconsultation_invitations WHERE id=$1",
        [invitation.id],
      )
    ).rows[0];
    if (submission.status === 200) {
      expect(original.submitted_at).not.toBeNull();
      expect(original.revoked_at).toBeNull();
      expect(
        (
          await getPool().query(
            "SELECT count(*)::int n FROM inventory_preconsultation_responses WHERE invitation_id=$1",
            [invitation.id],
          )
        ).rows[0].n,
      ).toBe(1);
    } else {
      expect(original.submitted_at).toBeNull();
      expect(original.revoked_at).not.toBeNull();
      expect(
        (
          await getPool().query(
            "SELECT count(*)::int n FROM inventory_preconsultation_responses WHERE invitation_id=$1",
            [invitation.id],
          )
        ).rows[0].n,
      ).toBe(0);
    }
  });
  it("stores only visible conditional answers and leaves rejected submissions reusable", async () => {
    const f = await fixture();
    const questions = [
      { id: "medicine", label: "Usa medicamento?", type: "CHOICE", options: ["Sim", "Não"] },
      {
        id: "daily",
        label: "Uso diário?",
        type: "CHOICE",
        options: ["Sim", "Não"],
        visibleWhen: { questionId: "medicine", equals: "Sim" },
      },
      {
        id: "details",
        label: "Quais medicamentos?",
        type: "TEXT",
        visibleWhen: { questionId: "daily", equals: "Sim" },
      },
    ];
    expect(
      (
        await f.post({
          action: "SAVE_FORM",
          id: f.formId,
          unitId: f.unit,
          title: "Anamnese condicional",
          questions,
        })
      ).status,
    ).toBe(200);
    expect((await f.publish()).status).toBe(200);
    const invitation = await f.issued();
    const original = (await (await f.publicPost(invitation.token)).json()).data;
    expect(original.questions[1].visibleWhen).toEqual({ questionId: "medicine", equals: "Sim" });
    expect(
      (
        await f.publicPost(invitation.token, {
          medicine: "Não",
          daily: "Sim",
          details: "Sensitive stale answer",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int n FROM inventory_preconsultation_responses WHERE invitation_id=$1",
          [invitation.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await getPool().query(
          "SELECT submitted_at FROM inventory_preconsultation_invitations WHERE id=$1",
          [invitation.id],
        )
      ).rows[0].submitted_at,
    ).toBeNull();
    expect(
      (await f.publicPost(invitation.token, { medicine: "Não", daily: "", details: "   " })).status,
    ).toBe(200);
    expect(
      (
        await getPool().query(
          "SELECT answers FROM inventory_preconsultation_responses WHERE invitation_id=$1",
          [invitation.id],
        )
      ).rows[0].answers,
    ).toEqual({ medicine: "Não" });
    const expanded = await f.issued();
    expect(
      (
        await f.publicPost(expanded.token, {
          medicine: "Sim",
          daily: "Sim",
          details: "  Relato literal do paciente  ",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await getPool().query(
          "SELECT answers FROM inventory_preconsultation_responses WHERE invitation_id=$1",
          [expanded.id],
        )
      ).rows[0].answers,
    ).toEqual({ medicine: "Sim", daily: "Sim", details: "  Relato literal do paciente  " });
  });

  it("rejects invalid dependencies and evaluates invitations against their immutable conditional version", async () => {
    const f = await fixture();
    const medicine = {
      id: "medicine",
      label: "Usa medicamento?",
      type: "CHOICE",
      options: ["Sim", "Não"],
    };
    const detail = {
      id: "details",
      label: "Quais?",
      type: "TEXT",
      visibleWhen: { questionId: "medicine", equals: "Sim" },
    };
    const save = (questions: unknown[], version?: number) =>
      f.post({
        action: "SAVE_FORM",
        id: f.formId,
        unitId: f.unit,
        title: "Condições seguras",
        questions,
        version,
      });
    expect((await save([detail, medicine])).status).toBe(400);
    expect(
      (
        await save([
          medicine,
          { ...detail, visibleWhen: { questionId: "medicine", equals: "Unknown" } },
        ])
      ).status,
    ).toBe(400);
    expect(
      (await save([{ ...medicine, visibleWhen: { questionId: "medicine", equals: "Sim" } }]))
        .status,
    ).toBe(400);
    expect((await save([medicine, detail])).status).toBe(200);
    expect((await f.publish()).status).toBe(200);
    const invitation = await f.issued();
    expect(
      (
        await save(
          [medicine, { ...detail, visibleWhen: { questionId: "medicine", equals: "Não" } }],
          0,
        )
      ).status,
    ).toBe(200);
    expect((await f.publish(1)).status).toBe(200);
    const old = (await (await f.publicPost(invitation.token)).json()).data;
    expect(old.questions[1].visibleWhen.equals).toBe("Sim");
    expect(
      (
        await f.publicPost(invitation.token, {
          medicine: "Sim",
          details: "Visible in original version",
        })
      ).status,
    ).toBe(200);
    const newer = await f.issued();
    expect(
      (await f.publicPost(newer.token, { medicine: "Sim", details: "No longer visible" })).status,
    ).toBe(400);
    expect((await f.publicPost(newer.token, { medicine: "Sim" })).status).toBe(200);
  });

  it("publishes an immutable snapshot and preserves skipped answers without inventing negatives", async () => {
    const f = await fixture();
    await f.ready();
    const invite = await f.issued();
    const original = await (await f.publicPost(invite.token)).json();
    expect(JSON.stringify(original)).not.toContain(f.patient);
    expect(JSON.stringify(original)).not.toContain("Synthetic patient");
    expect(JSON.stringify(original)).not.toContain(f.appointment);
    expect((await f.save(0, "Novo título")).status).toBe(200);
    expect(await (await f.publicPost(invite.token)).json()).toEqual(original);
    expect((await f.publicPost(invite.token, { concern: "Relato espontâneo" })).status).toBe(200);
    const stored = await getPool().query(
      "SELECT answers FROM inventory_preconsultation_responses WHERE invitation_id=$1",
      [invite.id],
    );
    expect(stored.rows[0].answers).toEqual({ concern: "Relato espontâneo", medicine: "" });
    await expect(
      getPool().query(
        "UPDATE inventory_preconsultation_versions SET title='changed' WHERE form_id=$1",
        [f.formId],
      ),
    ).rejects.toThrow();
    await expect(
      getPool().query(
        "UPDATE inventory_preconsultation_responses SET answers='{}' WHERE invitation_id=$1",
        [invite.id],
      ),
    ).rejects.toThrow();
    await expect(
      getPool().query("DELETE FROM inventory_preconsultation_responses WHERE invitation_id=$1", [
        invite.id,
      ]),
    ).rejects.toThrow();
  });
  it("treats omitted prototype-named question identifiers as unanswered", async () => {
    const f = await fixture();
    expect(
      (
        await f.post({
          action: "SAVE_FORM",
          id: f.formId,
          unitId: f.unit,
          title: "Perguntas opcionais",
          questions: [
            { id: "toString", label: "Observação", type: "TEXT" },
            {
              id: "constructor",
              label: "Escolha opcional",
              type: "CHOICE",
              options: ["Sim", "Não"],
            },
          ],
        })
      ).status,
    ).toBe(200);
    expect((await f.publish()).status).toBe(200);
    const invitation = await f.issued();
    expect((await f.publicPost(invitation.token, {})).status).toBe(200);
    const result = await getPool().query(
      "SELECT answers FROM inventory_preconsultation_responses WHERE invitation_id=$1",
      [invitation.id],
    );
    expect(result.rows[0].answers).toEqual({ toString: "", constructor: "" });
  });
  it("stores only token hashes, consumes once under concurrency and discloses no old answers publicly", async () => {
    const f = await fixture();
    await f.ready();
    const invite = await f.issued();
    const stored = await getPool().query(
      "SELECT to_jsonb(i)::text data,token_hash FROM inventory_preconsultation_invitations i WHERE id=$1",
      [invite.id],
    );
    expect(stored.rows[0].token_hash).toBe(hashToken(invite.token));
    expect(stored.rows[0].data).not.toContain(invite.token);
    const results = await Promise.all([
      f.publicPost(invite.token, { concern: "Primeira" }),
      f.publicPost(invite.token, { concern: "Segunda" }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status >= 400)).toHaveLength(1);
    expect((await f.publicPost(invite.token)).status).toBeGreaterThanOrEqual(400);
    const count = await getPool().query(
      "SELECT count(*)::int n FROM inventory_preconsultation_responses WHERE invitation_id=$1",
      [invite.id],
    );
    expect(count.rows[0].n).toBe(1);
  });
  it("rejects revoked, expired and invalid tokens with no questionnaire disclosure", async () => {
    const f = await fixture();
    await f.ready();
    const invite = await f.issued();
    expect((await f.post({ action: "REVOKE", id: invite.id })).status).toBe(200);
    expect((await f.publicPost(invite.token)).status).toBeGreaterThanOrEqual(400);
    expect((await f.publicPost(invite.token, { concern: "Late" })).status).toBeGreaterThanOrEqual(
      400,
    );
    expect((await f.publicPost("invalid-secret")).status).toBeGreaterThanOrEqual(400);
    const expired = { id: randomUUID(), token: randomUUID().replaceAll("-", "") + "abcdefghijk" };
    await getPool().query(
      `INSERT INTO inventory_preconsultation_invitations(id,organization_id,unit_id,patient_id,appointment_id,version_id,token_hash,created_by_user_id,expires_at)
      SELECT $1,$2,$3,$4,$5,version_id,$6,$7,now()-interval '1 second' FROM inventory_preconsultation_invitations WHERE id=$8`,
      [
        expired.id,
        f.org,
        f.unit,
        f.patient,
        f.appointment,
        hashToken(expired.token),
        f.user,
        invite.id,
      ],
    );
    expect((await f.publicPost(expired.token)).status).toBeGreaterThanOrEqual(400);
    expect((await f.publicPost(expired.token, {})).status).toBeGreaterThanOrEqual(400);
  });
  it("rejects cross-organization identifiers and mismatched appointment/patient", async () => {
    const f = await fixture(),
      other = await fixture();
    await f.ready();
    await other.ready();
    expect((await f.invite({ patientId: other.patient })).status).toBe(404);
    expect((await f.invite({ appointmentId: other.appointment })).status).toBe(404);
    expect((await f.invite({ formId: other.formId })).status).toBe(409);
    const second = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'SECOND','Second synthetic')",
      [second, f.org, f.unit],
    );
    expect((await f.invite({ patientId: second })).status).toBe(404);
    expect((await other.post({ action: "REVOKE", id: (await f.issued()).id })).status).toBe(404);
  });
  it("includes patient-wide responses during an encounter without exposing another encounter's invitation", async () => {
    const f = await fixture();
    await f.ready();
    const general = await f.invite({ appointmentId: null });
    expect(general.status).toBe(201);
    const { data: generalData } = await general.json();
    const secret = new URLSearchParams(new URL(generalData.link).hash.slice(1)).get("token")!;
    expect((await f.publicPost(secret, { concern: "Relato prévio do paciente" })).status).toBe(200);
    const exact = await f.issued();
    const otherAppointment = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now()+interval '2 hours',now()+interval '3 hours','Room')",
      [otherAppointment, f.org, f.unit, f.patient, f.user],
    );
    const other = await f.invite({ appointmentId: otherAppointment });
    expect(other.status).toBe(201);
    const { data: otherData } = await other.json();
    await getPool().query("UPDATE inventory_memberships SET role='CLINICIAN' WHERE id=$1", [
      f.membership,
    ]);
    const filtered = await f.read(`?patientId=${f.patient}&appointmentId=${f.appointment}`);
    expect(filtered.status).toBe(200);
    const data = (await filtered.json()).data;
    expect(data.invitations.map((invitation: { id: string }) => invitation.id).sort()).toEqual(
      [generalData.id, exact.id].sort(),
    );
    expect(
      data.invitations.find((invitation: { id: string }) => invitation.id === generalData.id)
        .answers.concern,
    ).toBe("Relato prévio do paciente");
    expect(
      data.invitations.some((invitation: { id: string }) => invitation.id === otherData.id),
    ).toBe(false);
    expect((await f.read(`?appointmentId=${f.appointment}`)).status).toBe(400);
  });
  it("requires both original invitation unit and current patient unit after transfer", async () => {
    const f = await fixture();
    await f.ready();
    const invite = await f.issued();
    await getPool().query("UPDATE inventory_patients SET primary_unit_id=$2 WHERE id=$1", [
      f.patient,
      f.otherUnit,
    ]);
    expect((await (await f.read()).json()).data.invitations).toHaveLength(0);
    expect((await f.publicPost(invite.token)).status).toBe(404);
    expect((await f.post({ action: "REVOKE", id: invite.id })).status).toBe(404);
    await getPool().query(
      "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
      [f.membership, f.otherUnit],
    );
    expect((await (await f.read()).json()).data.invitations).toHaveLength(1);
    expect((await f.post({ action: "REVOKE", id: invite.id })).status).toBe(200);
  });
  it("requires individual permission and same-origin mutation; validates answer keys and choices", async () => {
    const f = await fixture();
    await f.ready();
    const invite = await f.issued();
    expect((await f.post({ action: "REVOKE", id: invite.id }, "https://foreign.test")).status).toBe(
      403,
    );
    expect(
      (await preconsultationResponse(new Request(origin + "/api/v1/inventory/preconsultation")))
        .status,
    ).toBe(401);
    expect((await f.publicPost(invite.token, { medicine: "Unknown" })).status).toBe(400);
    expect((await f.publicPost(invite.token, { undeclared: "Extra" })).status).toBe(400);
    await getPool().query("UPDATE inventory_memberships SET role='VIEWER' WHERE id=$1", [
      f.membership,
    ]);
    expect((await f.save(0)).status).toBe(403);
    expect((await f.invite()).status).toBe(403);
  });
  it("prevents the shared synthetic Preview actor from managing forms or invitations", async () => {
    const f = await fixture();
    vi.stubEnv("INVENTORY_ENVIRONMENT", "test");
    vi.stubEnv("INVENTORY_PREVIEW_PASSWORD", "synthetic-test-password");
    vi.stubEnv("INVENTORY_SESSION_SECRET", "synthetic-test-secret".repeat(3));
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    try {
      const login = await previewLogin(
        new Request(origin + "/api/inventory-session", {
          method: "POST",
          headers: { origin },
          body: JSON.stringify({ password: "synthetic-test-password" }),
        }),
      );
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      const response = await preconsultationResponse(
        new Request(origin + "/api/v1/inventory/preconsultation", {
          method: "POST",
          headers: { origin, cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "SAVE_FORM",
            id: f.formId,
            unitId: f.unit,
            title: "Unauthorized form",
            questions: f.questions,
          }),
        }),
      );
      expect(response.status).toBe(403);
      const data = (
        await (
          await preconsultationResponse(
            new Request(origin + "/api/v1/inventory/preconsultation", { headers: { cookie } }),
          )
        ).json()
      ).data;
      expect(data.canManage).toBe(false);
      expect(data.canReadAnswers).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("audits access to submitted responses before disclosing them", async () => {
    const f = await fixture();
    await f.ready();
    const invite = await f.issued();
    await f.publicPost(invite.token, { concern: "Patient text" });
    const restricted = (await (await f.read()).json()).data;
    expect(restricted.canReadAnswers).toBe(false);
    expect(restricted.invitations[0].answers).toBeUndefined();
    await getPool().query("UPDATE inventory_memberships SET role='SUPER_ADMIN' WHERE id=$1", [
      f.membership,
    ]);
    const auditFailure = vi
      .spyOn(accessAudit, "recordClinicalListAccess")
      .mockRejectedValueOnce(new Error("synthetic audit outage"));
    try {
      expect((await f.read()).status).toBe(503);
    } finally {
      auditFailure.mockRestore();
    }
    const before = await getPool().query(
      "SELECT count(*)::int n FROM inventory_clinical_access_events WHERE patient_id=$1",
      [f.patient],
    );
    const response = await f.read();
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.canReadAnswers).toBe(true);
    expect(data.invitations[0].answers.concern).toBe("Patient text");
    const after = await getPool().query(
      "SELECT count(*)::int n FROM inventory_clinical_access_events WHERE patient_id=$1",
      [f.patient],
    );
    expect(after.rows[0].n).toBeGreaterThan(before.rows[0].n);
  });
});
