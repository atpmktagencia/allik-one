import "@tanstack/react-start/server-only";
import { z } from "zod";
import { authenticate, can, canAccessAllUnits } from "./auth";
import { getPool } from "./db";
import { recordClinicalListAccess } from "./clinical-access-audit";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const fields = z.object({
  kind: z.enum(["RETURN", "EXAMS", "CONTACT", "DOCUMENT", "OTHER"]),
  title: z.string().trim().min(3).max(160),
  instructions: z.string().trim().max(1000).default(""),
  dueOn: z.string().date(),
  assigneeUserId: z.string().uuid().nullable(),
});
const input = z.discriminatedUnion("action", [
  fields.extend({
    action: z.literal("CREATE"),
    id: z.string().uuid(),
    patientId: z.string().uuid(),
    appointmentId: z.string().uuid().nullable(),
  }),
  fields.extend({
    action: z.literal("UPDATE"),
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("STATUS"),
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
    status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELED"]),
    reason: z.string().trim().min(3).max(500),
  }),
]);
const filters = z.object({
  historyFor: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  appointmentId: z.string().uuid().optional(),
  state: z.enum(["PENDING", "ALL", "OPEN", "IN_PROGRESS", "DONE", "CANCELED"]).default("PENDING"),
  mine: z.enum(["true", "false"]).default("false"),
  overdue: z.enum(["true", "false"]).default("false"),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export async function careTasksResponse(request: Request) {
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para acessar as tarefas.", 401);
  if (!can(auth, "patients.read") || auth.integration) return fail("Acesso negado.", 403);
  if (!["GET", "POST"].includes(request.method)) return fail("Método não permitido.", 405);
  const all = canAccessAllUnits(auth),
    pool = getPool();
  if (request.method === "GET") {
    const parsed = filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return fail("Confira os filtros das tarefas.", 400);
    const f = parsed.data;
    if (f.unitId && !can(auth, "patients.read", f.unitId))
      return fail("Unidade não autorizada.", 403);
    try {
      let context: { patientId: string; unitId: string; patientName: string } | null = null;
      if (f.patientId) {
        const p = await pool.query(
          `SELECT id AS "patientId",primary_unit_id AS "unitId",full_name AS "patientName" FROM inventory_patients WHERE id=$1 AND organization_id=$2 AND ($3::boolean OR primary_unit_id=ANY($4::uuid[]))`,
          [f.patientId, auth.organizationId, all, auth.unitIds],
        );
        context = p.rows[0] ?? null;
        if (!context || (f.unitId && f.unitId !== context.unitId))
          return fail("Paciente não encontrado nesta unidade.", 404);
      }
      if (f.historyFor) {
        const task = await pool.query(
          `SELECT t.unit_id,t.patient_id,t.appointment_id FROM inventory_care_tasks t JOIN inventory_patients p ON p.id=t.patient_id AND p.organization_id=t.organization_id WHERE t.id=$1 AND t.organization_id=$2 AND ($3::boolean OR (t.unit_id=ANY($4::uuid[]) AND p.primary_unit_id=ANY($4::uuid[])))`,
          [f.historyFor, auth.organizationId, all, auth.unitIds],
        );
        const t = task.rows[0];
        if (!t || (f.unitId && f.unitId !== t.unit_id)) return fail("Tarefa não encontrada.", 404);
        const history = await pool.query(
          `SELECT e.id,e.created_at AS "createdAt",u.name AS "actorName",e.after_data->>'change_reason' AS reason,e.after_data->>'status' AS status,e.after_data->>'version' AS version FROM inventory_care_task_events e JOIN inventory_users u ON u.id=e.actor_user_id WHERE e.task_id=$1 AND e.organization_id=$2 ORDER BY e.created_at DESC,e.id DESC LIMIT 51 OFFSET $3`,
          [f.historyFor, auth.organizationId, f.offset],
        );
        await recordClinicalListAccess(auth, [
          {
            unitId: t.unit_id,
            patientId: t.patient_id,
            ...(t.appointment_id ? { appointmentId: t.appointment_id } : {}),
          },
        ]);
        return Response.json(
          { data: { events: history.rows.slice(0, 50), hasMore: history.rows.length > 50 } },
          { headers },
        );
      }
      const result = await pool.query(
        `SELECT t.id,t.unit_id AS "unitId",t.patient_id AS "patientId",p.full_name AS "patientName",t.appointment_id AS "appointmentId",t.kind,t.title,t.instructions,t.due_on::text AS "dueOn",t.assignee_user_id AS "assigneeUserId",u.name AS "assigneeName",t.status,t.resolution,t.version,
       t.status IN ('OPEN','IN_PROGRESS') AND t.due_on < (now() AT TIME ZONE 'America/Sao_Paulo')::date AS overdue
       FROM inventory_care_tasks t JOIN inventory_patients p ON p.id=t.patient_id AND p.organization_id=t.organization_id LEFT JOIN inventory_users u ON u.id=t.assignee_user_id
       WHERE t.organization_id=$1 AND ($2::boolean OR (t.unit_id=ANY($3::uuid[]) AND p.primary_unit_id=ANY($3::uuid[]))) AND ($4::uuid IS NULL OR t.unit_id=$4) AND ($5::uuid IS NULL OR t.patient_id=$5) AND ($6::uuid IS NULL OR t.appointment_id=$6)
       AND ($7='ALL' OR ($7='PENDING' AND t.status IN ('OPEN','IN_PROGRESS')) OR t.status=$7)
       AND (NOT $8::boolean OR t.assignee_user_id=$9) AND (NOT $10::boolean OR (t.status IN ('OPEN','IN_PROGRESS') AND t.due_on < (now() AT TIME ZONE 'America/Sao_Paulo')::date))
       ORDER BY t.due_on,t.created_at,t.id LIMIT 51 OFFSET $11`,
        [
          auth.organizationId,
          all,
          auth.unitIds,
          f.unitId ?? null,
          f.patientId ?? null,
          f.appointmentId ?? null,
          f.state,
          f.mine,
          auth.user.id,
          f.overdue,
          f.offset,
        ],
      );
      const tasks = result.rows.slice(0, 50);
      const units = await pool.query(
        "SELECT id,name FROM inventory_units WHERE organization_id=$1 AND active AND ($2::boolean OR id=ANY($3::uuid[])) ORDER BY name",
        [auth.organizationId, all, auth.unitIds],
      );
      const people = await pool.query(
        `SELECT u.id,u.name,m.role,ua.unit_id AS "unitId" FROM inventory_users u JOIN inventory_memberships m ON m.user_id=u.id LEFT JOIN inventory_unit_access ua ON ua.membership_id=m.id WHERE u.active AND m.active AND m.organization_id=$1 AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','UNIT_MANAGER','CLINICIAN') AND (m.role='SUPER_ADMIN' OR ($2::boolean OR ua.unit_id=ANY($3::uuid[]))) ORDER BY u.name LIMIT 500`,
        [auth.organizationId, all, auth.unitIds],
      );
      await recordClinicalListAccess(
        auth,
        tasks.map((t) => ({
          unitId: t.unitId,
          patientId: t.patientId,
          ...(t.appointmentId ? { appointmentId: t.appointmentId } : {}),
        })),
      );
      if (context && !tasks.length)
        await recordClinicalListAccess(auth, [
          { unitId: context.unitId, patientId: context.patientId },
        ]);
      return Response.json(
        {
          data: {
            tasks,
            context,
            units: units.rows,
            assignees: people.rows,
            canManage: !!auth.user.id && !auth.preview && can(auth, "patients.manage"),
            hasMore: result.rows.length > 50,
            userId: auth.user.id,
          },
        },
        { headers },
      );
    } catch {
      return fail("Não foi possível consultar as tarefas.", 503);
    }
  }
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return fail("Origem não autorizada.", 403);
  if (!auth.user.id || auth.preview || !can(auth, "patients.manage"))
    return fail("Use uma conta individual autorizada para alterar tarefas.", 403);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Confira os dados da tarefa.", 400);
  const d = parsed.data,
    client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rollback = async (message: string, status: number) => {
      await client.query("ROLLBACK");
      return fail(message, status);
    };
    let current;
    let patientId, unitId;
    if (d.action === "CREATE") {
      const p = await client.query(
        "SELECT id,primary_unit_id FROM inventory_patients WHERE id=$1 AND organization_id=$2 AND active FOR SHARE",
        [d.patientId, auth.organizationId],
      );
      if (!p.rows[0] || !can(auth, "patients.manage", p.rows[0].primary_unit_id))
        return await rollback("Paciente não encontrado.", 404);
      patientId = d.patientId;
      unitId = p.rows[0].primary_unit_id;
      if (d.appointmentId) {
        const a = await client.query(
          "SELECT id FROM inventory_care_appointments WHERE id=$1 AND organization_id=$2 AND patient_id=$3 AND unit_id=$4 FOR SHARE",
          [d.appointmentId, auth.organizationId, patientId, unitId],
        );
        if (!a.rowCount) return await rollback("Atendimento não encontrado nesta unidade.", 404);
      }
      // Same operation ID is safe to retry; never change an existing task on CREATE.
      const existing = await client.query("SELECT id FROM inventory_care_tasks WHERE id=$1", [
        d.id,
      ]);
      if (existing.rowCount)
        return await rollback("Esta tarefa já foi registrada. Atualize a lista.", 409);
    } else {
      const t = await client.query(
        "SELECT t.*,p.primary_unit_id AS patient_current_unit FROM inventory_care_tasks t JOIN inventory_patients p ON p.id=t.patient_id AND p.organization_id=t.organization_id WHERE t.id=$1 AND t.organization_id=$2 FOR UPDATE OF t FOR SHARE OF p",
        [d.id, auth.organizationId],
      );
      current = t.rows[0];
      if (
        !current ||
        !can(auth, "patients.manage", current.unit_id) ||
        !can(auth, "patients.manage", current.patient_current_unit)
      )
        return await rollback("Tarefa não encontrada.", 404);
      if (current.version !== d.version)
        return await rollback("A tarefa mudou. Atualize antes de continuar.", 409);
      if (d.action === "UPDATE" && ["DONE", "CANCELED"].includes(current.status))
        return await rollback("Reabra a tarefa antes de editá-la.", 409);
      if (
        d.action === "STATUS" &&
        (d.status === current.status ||
          (["DONE", "CANCELED"].includes(current.status) && d.status !== "OPEN"))
      )
        return await rollback("Transição inválida. Reabra a tarefa para continuar.", 409);
      patientId = current.patient_id;
      unitId = current.unit_id;
    }
    if (d.action !== "STATUS" && d.assigneeUserId) {
      const person = await client.query(
        `SELECT u.id FROM inventory_users u JOIN inventory_memberships m ON m.user_id=u.id WHERE u.id=$1 AND u.active AND m.active AND m.organization_id=$2 AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','UNIT_MANAGER','CLINICIAN') AND (m.role='SUPER_ADMIN' OR EXISTS(SELECT 1 FROM inventory_unit_access ua WHERE ua.membership_id=m.id AND ua.unit_id=$3)) FOR SHARE OF u,m`,
        [d.assigneeUserId, auth.organizationId, unitId],
      );
      if (!person.rowCount)
        return await rollback("Escolha um responsável ativo com acesso à unidade.", 409);
    }
    if (d.action === "CREATE")
      await client.query(
        `INSERT INTO inventory_care_tasks(id,organization_id,unit_id,patient_id,appointment_id,kind,title,instructions,due_on,assignee_user_id,created_by_user_id,updated_by_user_id,change_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,'Criação de tarefa')`,
        [
          d.id,
          auth.organizationId,
          unitId,
          patientId,
          d.appointmentId,
          d.kind,
          d.title,
          d.instructions,
          d.dueOn,
          d.assigneeUserId,
          auth.user.id,
        ],
      );
    else if (d.action === "UPDATE")
      await client.query(
        `UPDATE inventory_care_tasks SET kind=$2,title=$3,instructions=$4,due_on=$5,assignee_user_id=$6,change_reason=$7,updated_by_user_id=$8,updated_at=now(),version=version+1 WHERE id=$1`,
        [d.id, d.kind, d.title, d.instructions, d.dueOn, d.assigneeUserId, d.reason, auth.user.id],
      );
    else
      await client.query(
        `UPDATE inventory_care_tasks SET status=$2,resolution=$3,change_reason=$4,updated_by_user_id=$5,updated_at=now(),version=version+1 WHERE id=$1`,
        [
          d.id,
          d.status,
          ["DONE", "CANCELED"].includes(d.status) ? d.reason : "",
          d.reason,
          auth.user.id,
        ],
      );
    await client.query("COMMIT");
    return Response.json(
      { data: { id: d.id } },
      { status: d.action === "CREATE" ? 201 : 200, headers },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if ((error as { code?: string }).code === "23505")
      return fail("Esta tarefa já foi registrada. Atualize a lista.", 409);
    return fail("Não foi possível salvar a tarefa.", 503);
  } finally {
    client.release();
  }
}
