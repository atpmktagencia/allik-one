import "@tanstack/react-start/server-only";
import { z } from "zod";
import { authenticate, can } from "./auth";
import { getPool } from "./db";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const alertInput = z.object({
  action: z.enum(["CREATE", "UPDATE"]),
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  type: z.enum(["ALLERGY", "WARNING", "PRECAUTION"]),
  title: z.string().trim().min(2).max(200),
  reaction: z.string().trim().min(2).max(500).nullable(),
  severity: z.enum(["UNKNOWN", "MILD", "MODERATE", "SEVERE"]),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  notes: z.string().trim().max(2000),
  reason: z.string().trim().min(10).max(500),
  version: z.number().int().nonnegative(),
});

export async function clinicalAlertsResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar o prontuário." }, { status: 401, headers });
  if (request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  if (!auth.user.id || auth.preview || auth.integration || !can(auth, "patients.clinical.manage"))
    return Response.json(
      { error: "Use uma conta profissional individual para alterar alertas clínicos." },
      { status: 403, headers },
    );
  const parsed = alertInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Confira os dados do alerta clínico." },
      { status: 400, headers },
    );
  const input = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const professionalResult = await client.query(
      `SELECT name,professional_council,council_number,council_region
       FROM inventory_users WHERE id=$1 AND active FOR SHARE`,
      [auth.user.id],
    );
    const professional = professionalResult.rows[0];
    if (
      !professional?.professional_council ||
      !professional.council_number ||
      !professional.council_region
    ) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Complete o conselho profissional antes de alterar alertas clínicos." },
        { status: 409, headers },
      );
    }
    const patientResult = await client.query(
      `SELECT id,primary_unit_id FROM inventory_patients
       WHERE id=$1 AND organization_id=$2 AND active FOR SHARE`,
      [input.patientId, auth.organizationId],
    );
    const patient = patientResult.rows[0];
    if (!patient || !can(auth, "patients.clinical.manage", patient.primary_unit_id)) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Paciente não encontrado." }, { status: 404, headers });
    }

    let before: Record<string, unknown> | null = null;
    let result;
    if (input.action === "CREATE") {
      result = await client.query(
        `INSERT INTO inventory_patient_clinical_alerts(id,organization_id,unit_id,patient_id,type,
          title,reaction,severity,status,notes,author_user_id,author_name,professional_council,
          council_number,council_region)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
          input.id,
          auth.organizationId,
          patient.primary_unit_id,
          input.patientId,
          input.type,
          input.title,
          input.reaction,
          input.severity,
          input.status,
          input.notes,
          auth.user.id,
          professional.name,
          professional.professional_council,
          professional.council_number,
          professional.council_region,
        ],
      );
    } else {
      const current = await client.query(
        `SELECT * FROM inventory_patient_clinical_alerts
         WHERE id=$1 AND patient_id=$2 AND organization_id=$3 FOR UPDATE`,
        [input.id, input.patientId, auth.organizationId],
      );
      if (!current.rowCount) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Alerta clínico não encontrado." }, { status: 404, headers });
      }
      const currentRow = current.rows[0] as Record<string, unknown>;
      before = currentRow;
      if (Number(currentRow["version"]) !== input.version) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "O alerta mudou em outra sessão. Atualize a página." },
          { status: 409, headers },
        );
      }
      result = await client.query(
        `UPDATE inventory_patient_clinical_alerts SET type=$4,title=$5,reaction=$6,severity=$7,
          status=$8,notes=$9,version=version+1,updated_at=now()
         WHERE id=$1 AND patient_id=$2 AND organization_id=$3 RETURNING *`,
        [
          input.id,
          input.patientId,
          auth.organizationId,
          input.type,
          input.title,
          input.reaction,
          input.severity,
          input.status,
          input.notes,
        ],
      );
    }
    const current = result.rows[0];
    await client.query(
      `INSERT INTO inventory_patient_clinical_alert_changes(organization_id,alert_id,action,
        before_data,after_data,reason,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [auth.organizationId, input.id, input.action, before, current, input.reason, auth.user.id],
    );
    await client.query("COMMIT");
    return Response.json(
      { data: { id: current.id, version: current.version } },
      { status: input.action === "CREATE" ? 201 : 200, headers },
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      "clinical alert write failed",
      error instanceof Error ? error.message : "unknown",
    );
    return Response.json(
      { error: "Não foi possível salvar o alerta clínico." },
      { status: 500, headers },
    );
  } finally {
    client.release();
  }
}
