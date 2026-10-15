import { getPool } from "../src/server/db";
import { hashToken } from "../src/server/auth";

const email = process.env["PILOT_SUPER_ADMIN_EMAIL"]?.trim().toLowerCase();
const name = process.env["PILOT_SUPER_ADMIN_NAME"]?.trim();
const inviteToken = process.env["PILOT_SUPER_ADMIN_INVITE_TOKEN"];
if (!email || !name || !inviteToken || inviteToken.length < 40)
  throw new Error("Pilot bootstrap requires the protected super-admin identity and invite token.");

const pool = getPool();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const organizationId = "a1100000-0000-4000-8000-000000000001";
  const existing = await client.query(
    "SELECT id FROM inventory_users WHERE lower(email)=lower($1)",
    [email],
  );
  let userId = existing.rows[0]?.id as string | undefined;
  if (!userId) {
    const created = await client.query(
      "INSERT INTO inventory_users(name,email,profession,title) VALUES($1,$2,'Médico','Sócio / administrador do sistema') RETURNING id",
      [name, email],
    );
    userId = created.rows[0].id;
  }
  await client.query(
    `INSERT INTO inventory_memberships(user_id,organization_id,role)
     VALUES($1,$2,'SUPER_ADMIN') ON CONFLICT(user_id,organization_id)
     DO UPDATE SET active=true,role='SUPER_ADMIN',updated_at=now()`,
    [userId, organizationId],
  );
  const alreadyActivated = await client.query(
    "SELECT password_hash IS NOT NULL AS activated FROM inventory_users WHERE id=$1",
    [userId],
  );
  if (!alreadyActivated.rows[0].activated) {
    await client.query(
      `INSERT INTO inventory_invites(user_id,organization_id,token_hash,expires_at)
       SELECT $1,$2,$3,now()+interval '7 days'
       WHERE NOT EXISTS (SELECT 1 FROM inventory_invites WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now())`,
      [userId, organizationId, hashToken(inviteToken)],
    );
  }
  await client.query("COMMIT");
  console.log("Pilot organization and initial administrator are ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
