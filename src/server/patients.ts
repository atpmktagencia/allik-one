import "@tanstack/react-start/server-only";
import { del, put } from "@vercel/blob";
import { actor, authenticate, can } from "./auth";
import { getPool } from "./db";
import { patientInput } from "../data/patient-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const optional = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);
const patientPhotoTypes = new Set(["image/jpeg", "image/png", "image/heic", "image/heif"]);

async function uploadPatientPhoto(
  request: Request,
  auth: Awaited<ReturnType<typeof authenticate>>,
) {
  if (!auth || !can(auth, "patients.manage"))
    return Response.json(
      { error: "Sem permissão para alterar pacientes." },
      { status: 403, headers },
    );
  const form = await request.formData();
  const patientId = String(form.get("patientId") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const file = form.get("photo");
  if (
    !/^[0-9a-f-]{36}$/i.test(patientId) ||
    reason.length < 10 ||
    !(file instanceof File) ||
    file.size < 1 ||
    file.size > 5 * 1024 * 1024 ||
    !patientPhotoTypes.has(file.type)
  )
    return Response.json(
      { error: "Envie uma foto JPG, PNG ou HEIC de até 5 MB." },
      { status: 400, headers },
    );
  const current = await getPool().query(
    "SELECT * FROM inventory_patients WHERE id=$1 AND organization_id=$2",
    [patientId, auth.organizationId],
  );
  const patient = current.rows[0];
  if (!patient || !can(auth, "patients.manage", String(patient.primary_unit_id)))
    return Response.json({ error: "Paciente não encontrado." }, { status: 404, headers });
  const stored = await put(
    `patients/${auth.organizationId}/${patientId}/photo-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`,
    file,
    { access: "private", addRandomSuffix: true },
  );
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      "SELECT * FROM inventory_patients WHERE id=$1 AND organization_id=$2 FOR UPDATE",
      [patientId, auth.organizationId],
    );
    const before = locked.rows[0];
    if (!before || !can(auth, "patients.manage", String(before.primary_unit_id)))
      throw new Error("SCOPE");
    const updated = await client.query(
      `UPDATE inventory_patients SET photo_blob_pathname=$3,photo_filename=$4,photo_content_type=$5,
        updated_by_user_id=$6,version=version+1,updated_at=now()
       WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [
        patientId,
        auth.organizationId,
        stored.pathname,
        file.name.slice(0, 180),
        file.type,
        auth.user.id,
      ],
    );
    await client.query(
      `INSERT INTO inventory_patient_changes(organization_id,patient_id,action,before_data,after_data,reason,actor,actor_user_id)
       VALUES($1,$2,'UPDATE',$3,$4,$5,$6,$7)`,
      [
        auth.organizationId,
        patientId,
        before,
        updated.rows[0],
        reason,
        actor(auth).name,
        actor(auth).userId,
      ],
    );
    await client.query("COMMIT");
    if (before.photo_blob_pathname) await del(String(before.photo_blob_pathname)).catch(() => {});
    return Response.json({ data: { id: patientId } }, { headers });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await del(stored.pathname).catch(() => {});
    console.error(
      "Patient photo upload failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return Response.json({ error: "Não foi possível salvar a foto." }, { status: 503, headers });
  } finally {
    client.release();
  }
}

export async function patientsResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar pacientes." }, { status: 401, headers });
  if (!can(auth, "patients.read"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });

  if (request.method === "GET") {
    const requestedUnit = new URL(request.url).searchParams.get("unitId");
    if (requestedUnit && !can(auth, "patients.read", requestedUnit))
      return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });
    const unrestricted =
      auth.preview || auth.role === "SUPER_ADMIN" || auth.role === "PARTNER_ADMIN";
    const pool = getPool();
    const [result, availableUnits] = await Promise.all([
      pool.query(
        `SELECT p.id,p.primary_unit_id AS "primaryUnitId",u.name AS "unitName",
        p.internal_code AS "internalCode",p.full_name AS "fullName",p.phone,p.phone2,p.email,
        p.document_type AS "documentType",p.document_number AS "documentNumber",
        p.no_document AS "noDocument",p.birth_date::text AS "birthDate",
        p.insurance_data AS insurance,p.additional_data AS additional,p.private_data AS "privateData",p.active,
        p.consent_status AS "consentStatus",p.consent_recorded_at AS "consentRecordedAt",
        p.version,p.created_at AS "createdAt",p.updated_at AS "updatedAt"
       FROM inventory_patients p JOIN inventory_units u ON u.id=p.primary_unit_id
       WHERE p.organization_id=$1
         AND ($2::uuid IS NULL OR p.primary_unit_id=$2)
         AND ($3::boolean OR p.primary_unit_id=ANY($4::uuid[]))
       ORDER BY p.active DESC,lower(p.full_name),p.id`,
        [auth.organizationId, requestedUnit, unrestricted, auth.unitIds],
      ),
      pool.query(
        `SELECT id,name FROM inventory_units
         WHERE organization_id=$1 AND active
           AND ($2::boolean OR id=ANY($3::uuid[]))
         ORDER BY name`,
        [auth.organizationId, unrestricted, auth.unitIds],
      ),
    ]);
    return Response.json(
      {
        data: {
          patients: result.rows,
          units: availableUnits.rows,
          canManage: can(auth, "patients.manage"),
        },
      },
      { headers },
    );
  }

  if (request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  if (!can(auth, "patients.manage"))
    return Response.json(
      { error: "Sem permissão para alterar pacientes." },
      { status: 403, headers },
    );

  if (request.headers.get("content-type")?.startsWith("multipart/form-data"))
    return uploadPatientPhoto(request, auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const parsed = patientInput.safeParse(body);
  if (!parsed.success)
    return Response.json(
      { error: "Confira os dados operacionais do paciente." },
      { status: 400, headers },
    );
  const input = parsed.data;
  if (!can(auth, "patients.manage", input.primaryUnitId))
    return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const unit = await client.query(
      "SELECT id FROM inventory_units WHERE id=$1 AND organization_id=$2 AND active FOR SHARE",
      [input.primaryUnitId, auth.organizationId],
    );
    if (!unit.rowCount) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Unidade inválida." }, { status: 400, headers });
    }

    let before: unknown = null;
    let result;
    const consentAt = input.consentStatus === "PENDING" ? null : new Date();
    const consentUser = input.consentStatus === "PENDING" ? null : auth.user.id;
    if (input.action === "CREATE") {
      result = await client.query(
        `INSERT INTO inventory_patients(
          id,organization_id,primary_unit_id,internal_code,full_name,phone,phone2,email,
          document_type,document_number,no_document,birth_date,insurance_data,additional_data,private_data,active,
          consent_status,consent_recorded_at,consent_recorded_by_user_id,created_by_user_id,updated_by_user_id
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20) RETURNING *`,
        [
          input.id,
          auth.organizationId,
          input.primaryUnitId,
          input.internalCode,
          input.fullName,
          optional(input.phone),
          optional(input.phone2),
          optional(input.email)?.toLowerCase() ?? null,
          input.noDocument ? null : (input.documentType ?? null),
          input.noDocument ? null : optional(input.documentNumber),
          input.noDocument,
          optional(input.birthDate),
          input.insurance,
          input.additional,
          input.privateData,
          input.active,
          input.consentStatus,
          consentAt,
          consentUser,
          auth.user.id,
        ],
      );
    } else {
      const current = await client.query(
        "SELECT * FROM inventory_patients WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [input.id, auth.organizationId],
      );
      if (!current.rowCount) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Paciente não encontrado." }, { status: 404, headers });
      }
      const currentUnit = String(current.rows[0].primary_unit_id);
      if (!can(auth, "patients.manage", currentUnit)) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });
      }
      if (current.rows[0].version !== input.version) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "O paciente mudou desde a consulta. Recarregue e tente novamente." },
          { status: 409, headers },
        );
      }
      before = current.rows[0];
      result = await client.query(
        `UPDATE inventory_patients SET primary_unit_id=$3,internal_code=$4,full_name=$5,
          phone=$6,phone2=$7,email=$8,document_type=$9,document_number=$10,no_document=$11,
          birth_date=$12,insurance_data=$13,additional_data=$14,private_data=$15,active=$16,
          consent_status=$17,consent_recorded_at=$18,consent_recorded_by_user_id=$19,
          updated_by_user_id=$20,version=version+1,updated_at=now()
         WHERE id=$1 AND organization_id=$2 RETURNING *`,
        [
          input.id,
          auth.organizationId,
          input.primaryUnitId,
          input.internalCode,
          input.fullName,
          optional(input.phone),
          optional(input.phone2),
          optional(input.email)?.toLowerCase() ?? null,
          input.noDocument ? null : (input.documentType ?? null),
          input.noDocument ? null : optional(input.documentNumber),
          input.noDocument,
          optional(input.birthDate),
          input.insurance,
          input.additional,
          input.privateData,
          input.active,
          input.consentStatus,
          consentAt,
          consentUser,
          auth.user.id,
        ],
      );
    }
    await client.query(
      `INSERT INTO inventory_patient_changes(
        organization_id,patient_id,action,before_data,after_data,reason,actor,actor_user_id
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        auth.organizationId,
        input.id,
        input.action,
        before,
        result.rows[0],
        input.reason,
        actor(auth).name,
        actor(auth).userId,
      ],
    );
    await client.query("COMMIT");
    return Response.json(
      { data: { id: input.id } },
      { status: input.action === "CREATE" ? 201 : 200, headers },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return Response.json(
      {
        error:
          code === "23505"
            ? "Já existe um paciente com este código interno."
            : "Não foi possível salvar o paciente.",
      },
      { status: code === "23505" ? 409 : 503, headers },
    );
  } finally {
    client.release();
  }
}
