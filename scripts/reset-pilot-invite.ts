import { getPool } from "../src/server/db";
import { hashToken } from "../src/server/auth";

if (
  process.env["INVENTORY_ENVIRONMENT"] !== "production" ||
  process.env["PILOT_RESET_INVITE"] !== "true"
)
  throw new Error("Pilot invite reset requires explicit production authorization.");

const email = process.env["PILOT_RESET_EMAIL"]?.trim().toLowerCase();
const inviteToken = process.env["PILOT_RESET_INVITE_TOKEN"];
if (!email || !inviteToken || inviteToken.length < 40)
  throw new Error("Reset requires an explicit user and a strong one-time token.");

const pool = getPool();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const user = await client.query(
    `SELECT u.id FROM inventory_users u
     JOIN inventory_memberships m ON m.user_id=u.id
     WHERE lower(u.email)=lower($1) AND m.role='SUPER_ADMIN' FOR UPDATE OF u`,
    [email],
  );
  if (user.rowCount !== 1) throw new Error("Pilot administrator was not found uniquely.");
  const userId = user.rows[0].id as string;
  await client.query(
    `UPDATE inventory_users SET password_hash=NULL,session_version=session_version+1,updated_at=now()
     WHERE id=$1`,
    [userId],
  );
  await client.query(
    "UPDATE inventory_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",
    [userId],
  );
  await client.query(
    "UPDATE inventory_invites SET revoked_at=now() WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL",
    [userId],
  );
  await client.query(
    `INSERT INTO inventory_invites(user_id,organization_id,token_hash,expires_at)
     SELECT u.id,m.organization_id,$2,now()+interval '24 hours'
     FROM inventory_users u JOIN inventory_memberships m ON m.user_id=u.id WHERE u.id=$1`,
    [userId, hashToken(inviteToken)],
  );
  await client.query(
    "INSERT INTO inventory_auth_events(user_id,event) VALUES($1,'INVITE_CREATED')",
    [userId],
  );
  await client.query("COMMIT");
  console.log("A new one-time password setup invitation is ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
