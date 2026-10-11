import "@tanstack/react-start/server-only";
import { authenticate, can } from "./auth";
import { getPool } from "./db";
import { careSettingsInput } from "../data/care-settings-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const codeFromName = (name: string) =>
  `CUSTOM_${name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32)}`;

export async function careSettingsResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar configurações." }, { status: 401, headers });
  if (!can(auth, "organization.read"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  const unrestricted = auth.preview || auth.role === "SUPER_ADMIN" || auth.role === "PARTNER_ADMIN";
  if (request.method === "GET") {
    const [units, rooms, resources, types, professionals] = await Promise.all([
      getPool().query(
        `SELECT id,name,active FROM inventory_units WHERE organization_id=$1 AND ($2::boolean OR id=ANY($3::uuid[])) ORDER BY name`,
        [auth.organizationId, unrestricted, auth.unitIds],
      ),
      getPool().query(
        `SELECT r.id,r.unit_id AS "unitId",r.name,r.active,u.name AS "unitName" FROM inventory_care_rooms r JOIN inventory_units u ON u.id=r.unit_id WHERE r.organization_id=$1 AND ($2::boolean OR r.unit_id=ANY($3::uuid[])) ORDER BY u.name,r.name`,
        [auth.organizationId, unrestricted, auth.unitIds],
      ),
      getPool().query(
        `SELECT r.id,r.unit_id AS "unitId",r.room_id AS "roomId",r.name,r.active FROM inventory_care_resources r WHERE r.organization_id=$1 AND ($2::boolean OR r.unit_id=ANY($3::uuid[])) ORDER BY r.name`,
        [auth.organizationId, unrestricted, auth.unitIds],
      ),
      getPool().query(
        `SELECT id,code,name,active FROM inventory_care_types WHERE organization_id=$1 ORDER BY name`,
        [auth.organizationId],
      ),
      getPool().query(
        `SELECT DISTINCT u.id,u.name,u.email,u.profession,u.title FROM inventory_users u JOIN inventory_memberships m ON m.user_id=u.id LEFT JOIN inventory_unit_access ua ON ua.membership_id=m.id WHERE m.organization_id=$1 AND m.active AND u.active AND (u.profession IS NOT NULL OR u.title IS NOT NULL) AND ($2::boolean OR ua.unit_id=ANY($3::uuid[])) ORDER BY u.name`,
        [auth.organizationId, unrestricted, auth.unitIds],
      ),
    ]);
    return Response.json(
      {
        data: {
          units: units.rows,
          rooms: rooms.rows,
          resources: resources.rows,
          types: types.rows,
          professionals: professionals.rows,
          canManageUnits: auth.preview || auth.role === "SUPER_ADMIN",
          canManageCare: can(auth, "patients.manage"),
        },
      },
      { headers },
    );
  }
  if (request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const parsed = careSettingsInput.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "Confira os dados da configuração." }, { status: 400, headers });
  const input = parsed.data;
  if (
    (input.action === "CREATE_UNIT" || input.action === "CREATE_TYPE") &&
    !(auth.preview || auth.role === "SUPER_ADMIN")
  )
    return Response.json(
      { error: "Somente Super Admin pode realizar esta ação." },
      { status: 403, headers },
    );
  if (
    (input.action === "CREATE_ROOM" || input.action === "CREATE_RESOURCE") &&
    !can(auth, "patients.manage", input.unitId)
  )
    return Response.json({ error: "Unidade não autorizada." }, { status: 403, headers });
  try {
    let result;
    if (input.action === "CREATE_UNIT")
      result = await getPool().query(
        "INSERT INTO inventory_units(organization_id,name) VALUES($1,$2) RETURNING id",
        [auth.organizationId, input.name],
      );
    else if (input.action === "CREATE_TYPE")
      result = await getPool().query(
        "INSERT INTO inventory_care_types(organization_id,code,name) VALUES($1,$2,$3) RETURNING id",
        [auth.organizationId, codeFromName(input.name), input.name],
      );
    else if (input.action === "CREATE_ROOM")
      result = await getPool().query(
        "INSERT INTO inventory_care_rooms(organization_id,unit_id,name) SELECT $1,id,$3 FROM inventory_units WHERE id=$2 AND organization_id=$1 RETURNING id",
        [auth.organizationId, input.unitId, input.name],
      );
    else
      result = await getPool().query(
        "INSERT INTO inventory_care_resources(organization_id,unit_id,room_id,name) SELECT $1,r.unit_id,r.id,$4 FROM inventory_care_rooms r WHERE r.id=$2 AND r.unit_id=$3 AND r.organization_id=$1 RETURNING id",
        [auth.organizationId, input.roomId, input.unitId, input.name],
      );
    if (!result.rowCount)
      return Response.json(
        { error: "Configuração inválida para esta unidade." },
        { status: 400, headers },
      );
    return Response.json({ data: { id: result.rows[0].id } }, { status: 201, headers });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return Response.json(
      {
        error:
          code === "23505"
            ? "Já existe um cadastro com este nome."
            : "Não foi possível salvar a configuração.",
      },
      { status: code === "23505" ? 409 : 503, headers },
    );
  }
}
