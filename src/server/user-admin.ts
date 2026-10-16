import { prescriberContactFields } from "../lib/prescriber-contact";
import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { authenticate, can, hashPassword, hashToken, roles } from "./auth";
import { getPool } from "./db";
import { sendInvitationEmail } from "./invitation-email";

function registryError(error: unknown) {
  const constraint =
    error && typeof error === "object" && "constraint" in error ? String(error.constraint) : "";
  if (constraint === "professional_registration_identity_unique")
    return Response.json(
      {
        error:
          "Este conselho, número e UF já pertencem a outro usuário nesta organização, inclusive contas inativas. Corrija o cadastro existente.",
      },
      { status: 409, headers },
    );
  if (constraint === "professional_registration_format_valid")
    return Response.json(
      { error: "Confira o conselho, o número do registro e a UF." },
      { status: 400, headers },
    );
  return null;
}

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const createUser = z.object({
  action: z.literal("CREATE"),
  ...prescriberContactFields,
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(254),
  profession: z.string().trim().max(100).optional(),
  title: z.string().trim().max(150).optional(),
  professionalCouncil: z.string().trim().min(2).max(20).optional(),
  councilNumber: z.string().trim().min(2).max(30).optional(),
  councilRegion: z.string().trim().length(2).toUpperCase().optional(),
  role: z.enum(roles),
  unitIds: z.array(z.string().uuid()).max(20),
});
const updateUser = z.object({
  action: z.enum(["ACTIVATE", "DEACTIVATE", "REINVITE"]),
  userId: z.string().uuid(),
});
const editUser = createUser.omit({ action: true }).extend({
  action: z.literal("UPDATE"),
  userId: z.string().uuid(),
  role: z.enum(roles),
});

function hasValidProfessionalRegistry(
  input: z.infer<typeof createUser> | z.infer<typeof editUser>,
) {
  const councilFields = [
    input.professionalCouncil,
    input.councilNumber,
    input.councilRegion,
  ].filter(Boolean).length;
  return !((input.profession && councilFields !== 3) || (!input.profession && councilFields !== 0));
}

async function createInvite(
  userId: string,
  organizationId: string,
  createdByUserId: string | null,
) {
  const token = randomBytes(32).toString("base64url");
  const client = await getPool().connect();
  let email: string;
  try {
    await client.query("BEGIN");
    const user = await client.query(
      "SELECT id,email FROM inventory_users WHERE id=$1 AND active AND password_hash IS NULL FOR UPDATE",
      [userId],
    );
    if (!user.rowCount) throw new Error("ACCOUNT_ALREADY_ACTIVE");
    email = user.rows[0].email;
    await client.query(
      "UPDATE inventory_invites SET revoked_at=now() WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL",
      [userId],
    );
    await client.query(
      "INSERT INTO inventory_invites(user_id,organization_id,token_hash,expires_at,created_by_user_id) VALUES($1,$2,$3,now()+interval '72 hours',$4)",
      [userId, organizationId, hashToken(token), createdByUserId],
    );
    await client.query(
      "INSERT INTO inventory_auth_events(user_id,event) VALUES($1,'INVITE_CREATED')",
      [userId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const emailDelivery = await sendInvitationEmail(email!, token);
  return { activationPath: `/estoque/ativar?token=${token}`, emailDelivery };
}

export async function userAdminResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para administrar usuários." }, { status: 401, headers });
  if (!can(auth, "users.manage") || auth.integration)
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  if (request.method === "GET") {
    const result = await getPool().query(
      `SELECT u.id,u.name,u.email,u.profession,u.title,
       inventory_professional_registration_state(u.id,m.organization_id) AS "professionalRegistryState",
       u.professional_council AS "professionalCouncil",u.council_number AS "councilNumber",
       u.prescribing_address AS "prescribingAddress",u.prescribing_city AS "prescribingCity",u.prescribing_state AS "prescribingState",u.prescribing_phone AS "prescribingPhone",u.council_region AS "councilRegion",(u.password_hash IS NOT NULL) AS credentialed,u.active,m.role,
       COALESCE(jsonb_agg(jsonb_build_object('id',un.id,'name',un.name) ORDER BY un.name) FILTER (WHERE un.id IS NOT NULL),'[]') AS units
       FROM inventory_users u JOIN inventory_memberships m ON m.user_id=u.id
       LEFT JOIN inventory_unit_access ua ON ua.membership_id=m.id LEFT JOIN inventory_units un ON un.id=ua.unit_id
       WHERE m.organization_id=$1 GROUP BY u.id,m.id ORDER BY u.name`,
      [auth.organizationId],
    );
    return Response.json({ data: result.rows }, { headers });
  }
  if (request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  // Account changes need an individual, accountable administrator.
  if (auth.preview || !auth.user.id)
    return Response.json(
      { error: "Entre com uma conta individual para administrar usuários." },
      { status: 403, headers },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const parsed = z.discriminatedUnion("action", [createUser, editUser, updateUser]).safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "Confira os dados do usuário." }, { status: 400, headers });
  const input = parsed.data;
  if (input.action === "CREATE") {
    if (!hasValidProfessionalRegistry(input))
      return Response.json(
        {
          error: "Profissionais de saúde exigem profissão, conselho, número e UF do registro.",
        },
        { status: 400, headers },
      );
    if (input.role === "SUPER_ADMIN")
      return Response.json(
        { error: "A criação de outro superadministrador exige o bootstrap controlado." },
        { status: 403, headers },
      );
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const validUnits = await client.query(
        "SELECT id FROM inventory_units WHERE organization_id=$1 AND active AND id=ANY($2::uuid[])",
        [auth.organizationId, input.unitIds],
      );
      if (validUnits.rowCount !== new Set(input.unitIds).size) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "Uma unidade informada é inválida." },
          { status: 400, headers },
        );
      }
      const user = await client.query(
        `INSERT INTO inventory_users(
          name,email,profession,title,professional_council,council_number,council_region,prescribing_address,prescribing_city,prescribing_state,prescribing_phone
        ) VALUES($1,lower($2),$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          input.name,
          input.email,
          input.profession ?? null,
          input.title ?? null,
          input.professionalCouncil?.toUpperCase() ?? null,
          input.councilNumber ?? null,
          input.councilRegion ?? null,
          input.prescribingAddress || null,
          input.prescribingCity || null,
          input.prescribingState || null,
          input.prescribingPhone || null,
        ],
      );
      const membership = await client.query(
        "INSERT INTO inventory_memberships(user_id,organization_id,role) VALUES($1,$2,$3) RETURNING id",
        [user.rows[0].id, auth.organizationId, input.role],
      );
      for (const unitId of input.unitIds)
        await client.query(
          "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
          [membership.rows[0].id, unitId],
        );
      await client.query("COMMIT");
      const invitation = await createInvite(user.rows[0].id, auth.organizationId, auth.user.id);
      return Response.json(
        { data: { id: user.rows[0].id, ...invitation } },
        { status: 201, headers },
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      const registrationError = registryError(error);
      if (registrationError) return registrationError;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      return Response.json(
        {
          error:
            code === "23505"
              ? "Este e-mail já está cadastrado."
              : "Não foi possível criar o usuário.",
        },
        { status: code === "23505" ? 409 : 503, headers },
      );
    } finally {
      client.release();
    }
  }
  if (input.action === "UPDATE") {
    if (!hasValidProfessionalRegistry(input))
      return Response.json(
        { error: "Profissionais de saúde exigem profissão, conselho, número e UF do registro." },
        { status: 400, headers },
      );
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        `SELECT u.id,u.name,u.email,u.profession,u.title,
       inventory_professional_registration_state(u.id,m.organization_id) AS "professionalRegistryState",
          u.professional_council AS "professionalCouncil",u.council_number AS "councilNumber",
          u.prescribing_address AS "prescribingAddress",u.prescribing_city AS "prescribingCity",u.prescribing_state AS "prescribingState",u.prescribing_phone AS "prescribingPhone",u.council_region AS "councilRegion",(u.password_hash IS NOT NULL) AS credentialed,m.id AS "membershipId",m.role
         FROM inventory_users u JOIN inventory_memberships m ON m.user_id=u.id
         WHERE u.id=$1 AND m.organization_id=$2 FOR UPDATE OF u,m`,
        [input.userId, auth.organizationId],
      );
      const before = target.rows[0];
      if (!before) throw new Error("NOT_FOUND");
      if (before.credentialed && before.email.toLowerCase() !== input.email.toLowerCase())
        throw new Error("EMAIL_LOCKED");
      // An activated professional's registry is their signing identity; reassigning it would
      // let an administrator attach another person's council number to an existing login.
      if (before.credentialed) {
        const registry = await client.query(
          `SELECT coalesce(inventory_professional_registration_key($1::text,$2::text,$3::text),upper(concat_ws('|',$1::text,$2::text,$3::text)))
            IS DISTINCT FROM coalesce(inventory_professional_registration_key($4::text,$5::text,$6::text),upper(concat_ws('|',$4::text,$5::text,$6::text))) AS changed`,
          [
            before.professionalCouncil,
            before.councilNumber,
            before.councilRegion,
            input.professionalCouncil ?? null,
            input.councilNumber ?? null,
            input.councilRegion ?? null,
          ],
        );
        if (registry.rows[0].changed) throw new Error("REGISTRY_LOCKED");
      }
      if (before.role === "SUPER_ADMIN" && input.role !== "SUPER_ADMIN")
        throw new Error("PROTECTED_ROLE");
      if (before.role !== "SUPER_ADMIN" && input.role === "SUPER_ADMIN")
        throw new Error("PROTECTED_ROLE");
      const currentUnits = await client.query<{ unitId: string }>(
        `SELECT unit_id AS "unitId" FROM inventory_unit_access
         WHERE membership_id=$1 ORDER BY unit_id FOR UPDATE`,
        [before.membershipId],
      );
      before.unitIds = currentUnits.rows.map((row) => row.unitId);
      const validUnits = await client.query(
        "SELECT id FROM inventory_units WHERE organization_id=$1 AND active AND id=ANY($2::uuid[])",
        [auth.organizationId, input.unitIds],
      );
      if (validUnits.rowCount !== new Set(input.unitIds).size) throw new Error("INVALID_UNIT");
      const normalizedUnitIds = [...new Set(input.unitIds)].sort();
      const emailChanged = before.email.toLowerCase() !== input.email.toLowerCase();
      const scopeChanged =
        emailChanged ||
        before.role !== input.role ||
        JSON.stringify(before.unitIds ?? []) !== JSON.stringify(normalizedUnitIds);
      await client.query(
        `UPDATE inventory_users SET name=$2,email=lower($3),profession=$4,title=$5,
          professional_council=$6,council_number=$7,council_region=$8,prescribing_address=$10,prescribing_city=$11,prescribing_state=$12,prescribing_phone=$13,
          session_version=session_version+CASE WHEN $9 THEN 1 ELSE 0 END,updated_at=now()
         WHERE id=$1`,
        [
          input.userId,
          input.name,
          input.email,
          input.profession ?? null,
          input.title ?? null,
          input.professionalCouncil?.toUpperCase() ?? null,
          input.councilNumber ?? null,
          input.councilRegion ?? null,
          scopeChanged,
          input.prescribingAddress === undefined
            ? before.prescribingAddress
            : input.prescribingAddress || null,
          input.prescribingCity === undefined
            ? before.prescribingCity
            : input.prescribingCity || null,
          input.prescribingState === undefined
            ? before.prescribingState
            : input.prescribingState || null,
          input.prescribingPhone === undefined
            ? before.prescribingPhone
            : input.prescribingPhone || null,
        ],
      );
      if (emailChanged)
        await client.query(
          "UPDATE inventory_invites SET revoked_at=now() WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL",
          [input.userId],
        );
      await client.query("UPDATE inventory_memberships SET role=$2,updated_at=now() WHERE id=$1", [
        before.membershipId,
        input.role,
      ]);
      await client.query("DELETE FROM inventory_unit_access WHERE membership_id=$1", [
        before.membershipId,
      ]);
      for (const unitId of normalizedUnitIds)
        await client.query(
          "INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)",
          [before.membershipId, unitId],
        );
      const after = {
        name: input.name,
        email: input.email.toLowerCase(),
        profession: input.profession ?? null,
        title: input.title ?? null,
        professionalCouncil: input.professionalCouncil?.toUpperCase() ?? null,
        councilNumber: input.councilNumber ?? null,
        councilRegion: input.councilRegion ?? null,
        prescribingAddress:
          input.prescribingAddress === undefined
            ? before.prescribingAddress
            : input.prescribingAddress || null,
        prescribingCity:
          input.prescribingCity === undefined
            ? before.prescribingCity
            : input.prescribingCity || null,
        prescribingState:
          input.prescribingState === undefined
            ? before.prescribingState
            : input.prescribingState || null,
        prescribingPhone:
          input.prescribingPhone === undefined
            ? before.prescribingPhone
            : input.prescribingPhone || null,
        role: input.role,
        unitIds: normalizedUnitIds,
      };
      await client.query(
        `INSERT INTO inventory_user_changes(organization_id,user_id,before_data,after_data,actor_user_id)
         VALUES($1,$2,$3,$4,$5)`,
        [auth.organizationId, input.userId, before, after, auth.user.id],
      );
      await client.query("COMMIT");
      return Response.json({ data: { id: input.userId } }, { headers });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      const registrationError = registryError(error);
      if (registrationError) return registrationError;
      const message = error instanceof Error ? error.message : "";
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const response =
        message === "NOT_FOUND"
          ? ["Usuário não encontrado.", 404]
          : message === "EMAIL_LOCKED"
            ? ["O e-mail de uma conta ativada só pode mudar após confirmação do titular.", 403]
            : message === "REGISTRY_LOCKED"
              ? [
                  "O registro profissional de uma conta ativada não pode ser alterado. Crie uma nova conta para o titular correto.",
                  409,
                ]
              : message === "PROTECTED_ROLE"
                ? ["O perfil SUPER_ADMIN não pode ser atribuído ou removido por esta tela.", 403]
                : message === "INVALID_UNIT"
                  ? ["Uma unidade informada é inválida.", 400]
                  : code === "23505"
                    ? ["Este e-mail já está cadastrado.", 409]
                    : ["Não foi possível atualizar o usuário.", 503];
      return Response.json({ error: response[0] }, { status: response[1] as number, headers });
    } finally {
      client.release();
    }
  }
  const target = await getPool().query(
    "SELECT u.id,u.active,(u.password_hash IS NOT NULL) AS credentialed FROM inventory_users u JOIN inventory_memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.organization_id=$2 AND m.role<>'SUPER_ADMIN'",
    [input.userId, auth.organizationId],
  );
  if (!target.rowCount)
    return Response.json(
      { error: "Usuário não encontrado ou protegido." },
      { status: 404, headers },
    );
  if (input.action === "REINVITE") {
    if (target.rows[0].credentialed)
      return Response.json(
        {
          error:
            "Esta conta já foi ativada. A recuperação deve ser solicitada pelo titular na tela de login.",
        },
        { status: 409, headers },
      );
    if (!target.rows[0].active)
      return Response.json(
        { error: "Ative o usuário antes de gerar um novo convite." },
        { status: 409, headers },
      );
    let invitation: Awaited<ReturnType<typeof createInvite>>;
    try {
      invitation = await createInvite(input.userId, auth.organizationId, auth.user.id);
    } catch {
      return Response.json(
        { error: "Esta conta não aceita reconvite. Confira a situação do usuário." },
        { status: 409, headers },
      );
    }
    return Response.json({ data: invitation }, { headers });
  }
  const active = input.action === "ACTIVATE";
  await getPool().query(
    `WITH changed AS (
       UPDATE inventory_users SET active=$2,session_version=session_version+1,updated_at=now()
       WHERE id=$1 RETURNING id
     ), revoked_invites AS (
       UPDATE inventory_invites SET revoked_at=now()
       WHERE user_id=(SELECT id FROM changed) AND $2=false
         AND used_at IS NULL AND revoked_at IS NULL
     )
     INSERT INTO inventory_auth_events(user_id,event) SELECT id,$3 FROM changed`,
    [input.userId, active, active ? "USER_ACTIVATED" : "USER_DEACTIVATED"],
  );
  return Response.json({ data: { id: input.userId, active } }, { headers });
}

const activationInput = z.object({
  token: z.string().min(40).max(100),
  password: z.string().min(12).max(200),
});
export async function activationResponse(request: Request) {
  if (request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405 });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const parsed = activationInput.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "Convite ou senha inválidos." }, { status: 400 });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const candidate = await client.query(
      "SELECT user_id FROM inventory_invites WHERE token_hash=$1",
      [hashToken(parsed.data.token)],
    );
    const lockedUser = candidate.rows[0]
      ? await client.query(
          "SELECT id,email FROM inventory_users WHERE id=$1 AND active AND password_hash IS NULL FOR UPDATE",
          [candidate.rows[0].user_id],
        )
      : { rowCount: 0 };
    const invite = lockedUser.rowCount
      ? await client.query(
          `SELECT id,user_id FROM inventory_invites WHERE token_hash=$1 AND user_id=$2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`,
          [hashToken(parsed.data.token), candidate.rows[0].user_id],
        )
      : { rowCount: 0, rows: [] };
    if (!invite.rowCount) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Este convite é inválido, expirou ou já foi utilizado." },
        { status: 410 },
      );
    }
    const passwordHash = await hashPassword(parsed.data.password);
    await client.query(
      "UPDATE inventory_users SET password_hash=$2,active=true,session_version=session_version+1,updated_at=now() WHERE id=$1",
      [invite.rows[0].user_id, passwordHash],
    );
    await client.query(
      "UPDATE inventory_invites SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND used_at IS NULL AND revoked_at IS NULL",
      [invite.rows[0].user_id, invite.rows[0].id],
    );
    await client.query("UPDATE inventory_invites SET used_at=now() WHERE id=$1", [
      invite.rows[0].id,
    ]);
    await client.query(
      "INSERT INTO inventory_auth_events(user_id,event) VALUES($1,'INVITE_ACCEPTED')",
      [invite.rows[0].user_id],
    );
    await client.query("COMMIT");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return Response.json({ error: "Não foi possível concluir a ativação." }, { status: 503 });
  } finally {
    client.release();
  }
}
