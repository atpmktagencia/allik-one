import "@tanstack/react-start/server-only";
import type { PoolClient } from "pg";
import { actor, authenticate, can } from "./auth";
import { getPool } from "./db";
import { careAppointmentInput } from "../data/care-appointment-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };

async function hasConflict(
  client: PoolClient,
  input: {
    id: string;
    unitId: string;
    professionalUserId: string;
    startsAt: string;
    endsAt: string;
    room: string;
    chair: number | null;
    resourceName: string | null;
  },
) {
  const result = await client.query(
    `SELECT id FROM inventory_care_appointments
     WHERE id<>$1 AND unit_id=$2 AND status NOT IN ('CANCELED','NO_SHOW')
       AND starts_at<$4 AND ends_at>$3
       AND (professional_user_id=$5 OR (lower(room)=lower($6) AND
         (($7::text IS NULL AND resource_name IS NULL) OR lower(resource_name)=lower($7))))
     LIMIT 1 FOR UPDATE`,
    [
      input.id,
      input.unitId,
      input.startsAt,
      input.endsAt,
      input.professionalUserId,
      input.room,
      input.resourceName,
    ],
  );
  return Boolean(result.rowCount);
}

export async function careAppointmentsResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json(
      { error: "Entre para acessar os agendamentos." },
      { status: 401, headers },
    );
  if (!can(auth, "patients.read"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });

  if (request.method === "GET") {
    const url = new URL(request.url);
    const unitId = url.searchParams.get("unitId");
    if (unitId && !can(auth, "patients.read", unitId))
      return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)))
      return Response.json({ error: "Período inválido." }, { status: 400, headers });
    const unrestricted =
      auth.preview || auth.role === "SUPER_ADMIN" || auth.role === "PARTNER_ADMIN";
    const pool = getPool();
    const [appointments, patients, professionals, units, careTypes, rooms, resources] =
      await Promise.all([
        pool.query(
          `SELECT a.id,a.unit_id AS "unitId",u.name AS "unitName",a.patient_id AS "patientId",
          p.full_name AS "patientName",p.phone,a.professional_user_id AS "professionalUserId",
          usr.name AS "professionalName",a.care_type AS "careType",a.other_care_type AS "otherCareType",
          a.starts_at AS "startsAt",a.ends_at AS "endsAt",a.room,a.chair,a.resource_name AS "resourceName",a.notes,a.status,a.version
         FROM inventory_care_appointments a
         JOIN inventory_units u ON u.id=a.unit_id JOIN inventory_patients p ON p.id=a.patient_id
         JOIN inventory_users usr ON usr.id=a.professional_user_id
         WHERE a.organization_id=$1 AND a.starts_at<$3 AND a.ends_at>$2
           AND ($4::uuid IS NULL OR a.unit_id=$4) AND ($5::boolean OR a.unit_id=ANY($6::uuid[]))
         ORDER BY a.starts_at,a.ends_at,lower(p.full_name) LIMIT 1000`,
          [auth.organizationId, from, to, unitId, unrestricted, auth.unitIds],
        ),
        pool.query(
          `SELECT id,primary_unit_id AS "unitId",full_name AS "fullName",phone,email,
          document_number AS "documentNumber",internal_code AS "internalCode"
         FROM inventory_patients WHERE organization_id=$1 AND active
           AND ($2::uuid IS NULL OR primary_unit_id=$2) AND ($3::boolean OR primary_unit_id=ANY($4::uuid[]))
         ORDER BY lower(full_name) LIMIT 1000`,
          [auth.organizationId, unitId, unrestricted, auth.unitIds],
        ),
        pool.query(
          `SELECT DISTINCT usr.id,usr.name,usr.profession,ua.unit_id AS "unitId"
         FROM inventory_users usr JOIN inventory_memberships m ON m.user_id=usr.id
         LEFT JOIN inventory_unit_access ua ON ua.membership_id=m.id
         WHERE m.organization_id=$1 AND m.active AND usr.active
           AND (m.role IN ('SUPER_ADMIN','PARTNER_ADMIN') OR ua.unit_id IS NOT NULL)
           AND ($2::boolean OR ua.unit_id=ANY($3::uuid[]))
           AND ($4::uuid IS NULL OR m.role IN ('SUPER_ADMIN','PARTNER_ADMIN') OR ua.unit_id=$4)
         ORDER BY usr.name`,
          [auth.organizationId, unrestricted, auth.unitIds, unitId],
        ),
        pool.query(
          `SELECT id,name FROM inventory_units WHERE organization_id=$1 AND active
          AND ($2::boolean OR id=ANY($3::uuid[])) ORDER BY name`,
          [auth.organizationId, unrestricted, auth.unitIds],
        ),
        pool.query(
          `SELECT code,name FROM inventory_care_types WHERE organization_id=$1 AND active ORDER BY name`,
          [auth.organizationId],
        ),
        pool.query(
          `SELECT id,unit_id AS "unitId",name FROM inventory_care_rooms WHERE organization_id=$1 AND active AND ($2::boolean OR unit_id=ANY($3::uuid[])) ORDER BY name`,
          [auth.organizationId, unrestricted, auth.unitIds],
        ),
        pool.query(
          `SELECT id,unit_id AS "unitId",room_id AS "roomId",name FROM inventory_care_resources WHERE organization_id=$1 AND active AND ($2::boolean OR unit_id=ANY($3::uuid[])) ORDER BY name`,
          [auth.organizationId, unrestricted, auth.unitIds],
        ),
      ]);
    return Response.json(
      {
        data: {
          appointments: appointments.rows,
          patients: patients.rows,
          professionals: professionals.rows,
          units: units.rows,
          careTypes: careTypes.rows,
          rooms: rooms.rows,
          resources: resources.rows,
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
    return Response.json({ error: "Sem permissão para agendar." }, { status: 403, headers });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const parsed = careAppointmentInput.safeParse(body);
  if (!parsed.success)
    return Response.json(
      { error: "Confira paciente, profissional, período, sala e tipo do atendimento." },
      { status: 400, headers },
    );
  const input = parsed.data;
  if (!can(auth, "patients.manage", input.unitId))
    return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `care:${input.unitId}:${input.startsAt.slice(0, 10)}`,
    ]);
    const scope = await client.query(
      `SELECT p.id FROM inventory_patients p WHERE p.id=$1 AND p.organization_id=$2 AND p.primary_unit_id=$3 AND p.active
       AND EXISTS(SELECT 1 FROM inventory_users u JOIN inventory_memberships m ON m.user_id=u.id
         LEFT JOIN inventory_unit_access ua ON ua.membership_id=m.id
         WHERE u.id=$4 AND u.active AND m.organization_id=$2 AND m.active
           AND (m.role IN ('SUPER_ADMIN','PARTNER_ADMIN') OR ua.unit_id=$3)) FOR SHARE`,
      [input.patientId, auth.organizationId, input.unitId, input.professionalUserId],
    );
    if (!scope.rowCount) throw new Error("INVALID_SCOPE");
    const configuredType = await client.query(
      "SELECT 1 FROM inventory_care_types WHERE organization_id=$1 AND code=$2 AND active FOR SHARE",
      [auth.organizationId, input.careType],
    );
    if (!configuredType.rowCount) throw new Error("INVALID_TYPE");
    const configuredRoom = await client.query(
      `SELECT r.id FROM inventory_care_rooms r
       WHERE r.organization_id=$1 AND r.unit_id=$2 AND r.active AND lower(r.name)=lower($3)
         AND ($4::text IS NULL OR EXISTS(
           SELECT 1 FROM inventory_care_resources cr
           WHERE cr.room_id=r.id AND cr.unit_id=$2 AND cr.active AND lower(cr.name)=lower($4)
         )) FOR SHARE`,
      [auth.organizationId, input.unitId, input.room, input.resourceName],
    );
    if (!configuredRoom.rowCount) throw new Error("INVALID_ROOM");
    let before: unknown = null;
    let result;
    if (input.action === "CREATE") {
      if (await hasConflict(client, input)) throw new Error("CONFLICT");
      result = await client.query(
        `INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,
          care_type,other_care_type,starts_at,ends_at,room,chair,resource_name,notes,status,created_by_user_id,updated_by_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING *`,
        [
          input.id,
          auth.organizationId,
          input.unitId,
          input.patientId,
          input.professionalUserId,
          input.careType,
          input.otherCareType ?? null,
          input.startsAt,
          input.endsAt,
          input.room,
          input.chair,
          input.resourceName,
          input.notes,
          input.status,
          auth.user.id,
        ],
      );
    } else {
      const current = await client.query(
        "SELECT * FROM inventory_care_appointments WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [input.id, auth.organizationId],
      );
      if (!current.rowCount || current.rows[0].unit_id !== input.unitId)
        throw new Error("NOT_FOUND");
      if (current.rows[0].version !== input.version) throw new Error("STALE");
      before = current.rows[0];
      result = await client.query(
        "UPDATE inventory_care_appointments SET status=$2,updated_by_user_id=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [input.id, input.status, auth.user.id],
      );
    }
    await client.query(
      `INSERT INTO inventory_care_appointment_changes(organization_id,appointment_id,action,before_data,after_data,reason,actor,actor_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        auth.organizationId,
        input.id,
        input.action === "CREATE" ? "CREATE" : "UPDATE",
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
    const message = error instanceof Error ? error.message : "";
    const response =
      message === "CONFLICT"
        ? ["Profissional ou sala/poltrona já possui atendimento neste horário.", 409]
        : message === "STALE"
          ? ["O agendamento mudou. Recarregue e tente novamente.", 409]
          : message === "NOT_FOUND"
            ? ["Agendamento não encontrado.", 404]
            : ["INVALID_SCOPE", "INVALID_TYPE", "INVALID_ROOM"].includes(message)
              ? ["Paciente, profissional, tipo ou sala inválido para esta unidade.", 400]
              : ["Não foi possível salvar o agendamento.", 503];
    return Response.json({ error: response[0] }, { status: response[1] as number, headers });
  } finally {
    client.release();
  }
}
