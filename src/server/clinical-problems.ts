import "@tanstack/react-start/server-only";
import { z } from "zod";
import { authenticate, can } from "./auth";
import { getPool } from "./db";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const inputSchema = z
  .object({
    action: z.enum(["CREATE", "UPDATE"]),
    id: z.string().uuid(),
    patientId: z.string().uuid(),
    description: z.string().trim().min(3).max(300),
    icd10Code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][0-9]{2}(\.[A-Z0-9]{1,4})?$/)
      .nullable(),
    onsetOn: z.string().date().nullable(),
    resolvedOn: z.string().date().nullable(),
    status: z.enum(["ACTIVE", "RESOLVED", "INACTIVE"]),
    notes: z.string().trim().max(2000),
    reason: z.string().trim().min(10).max(500),
    version: z.number().int().nonnegative(),
  })
  .superRefine((value, context) => {
    if (value.status === "RESOLVED" && !value.resolvedOn)
      context.addIssue({ code: "custom", path: ["resolvedOn"], message: "Informe a resolução." });
    if (value.onsetOn && value.resolvedOn && value.resolvedOn < value.onsetOn)
      context.addIssue({ code: "custom", path: ["resolvedOn"], message: "Data inválida." });
  });

export async function clinicalProblemsResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar o prontuário." }, { status: 401, headers });
  if (request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  if (!auth.user.id || auth.preview || auth.integration || !can(auth, "patients.clinical.manage"))
    return Response.json(
      { error: "Use uma conta profissional individual para alterar o prontuário." },
      { status: 403, headers },
    );

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Confira os dados do problema clínico." },
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
        { error: "Complete o conselho profissional antes de alterar o prontuário." },
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
        `INSERT INTO inventory_patient_clinical_problems(id,organization_id,unit_id,patient_id,
          description,icd10_code,onset_on,resolved_on,status,notes,author_user_id,author_name,
          professional_council,council_number,council_region)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
          input.id,
          auth.organizationId,
          patient.primary_unit_id,
          input.patientId,
          input.description,
          input.icd10Code,
          input.onsetOn,
          input.resolvedOn,
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
        `SELECT * FROM inventory_patient_clinical_problems
         WHERE id=$1 AND patient_id=$2 AND organization_id=$3 FOR UPDATE`,
        [input.id, input.patientId, auth.organizationId],
      );
      if (!current.rowCount) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "Problema clínico não encontrado." },
          { status: 404, headers },
        );
      }
      const currentRow = current.rows[0] as Record<string, unknown>;
      before = currentRow;
      // Scope edits by the unit that recorded the problem, not the patient's
      // current primary unit (which may have changed since).
      if (!can(auth, "patients.clinical.manage", String(currentRow["unit_id"]))) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "Problema clínico não encontrado." },
          { status: 404, headers },
        );
      }
      if (Number(currentRow["version"]) !== input.version) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "O registro mudou em outra sessão. Atualize a página." },
          { status: 409, headers },
        );
      }
      result = await client.query(
        `UPDATE inventory_patient_clinical_problems SET description=$4,icd10_code=$5,
          onset_on=$6,resolved_on=$7,status=$8,notes=$9,version=version+1,updated_at=now()
         WHERE id=$1 AND patient_id=$2 AND organization_id=$3 RETURNING *`,
        [
          input.id,
          input.patientId,
          auth.organizationId,
          input.description,
          input.icd10Code,
          input.onsetOn,
          input.resolvedOn,
          input.status,
          input.notes,
        ],
      );
    }
    const current = result.rows[0];
    await client.query(
      `INSERT INTO inventory_patient_clinical_problem_changes(organization_id,problem_id,action,
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
      "clinical problem write failed",
      error instanceof Error ? error.message : "unknown",
    );
    return Response.json(
      { error: "Não foi possível salvar o registro clínico." },
      { status: 500, headers },
    );
  } finally {
    client.release();
  }
}
