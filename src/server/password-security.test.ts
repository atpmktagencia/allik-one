import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./db";
import { authenticate, hashPassword, hashToken, previewLogin, verifyPassword } from "./auth";
import { passwordSecurityResponse } from "./password-security";
import { activationResponse, userAdminResponse } from "./user-admin";
const origin = "https://password-test.example";
const oldPassword = "synthetic-old-password-2026";
const newPassword = "synthetic-new-password-2026";
let emails: string[] = [];
beforeAll(async () => {
  if (!new URL(process.env["DATABASE_URL"] ?? "postgres://invalid").pathname.endsWith("_test"))
    throw new Error("Dedicated test database required");
  process.env["INVENTORY_ENVIRONMENT"] = "test";
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await getPool().end();
});
afterEach(() => {
  vi.unstubAllEnvs();
  process.env["INVENTORY_ENVIRONMENT"] = "test";
});
beforeEach(async () => {
  await getPool().query("DELETE FROM inventory_auth_rate_limits");
  vi.stubEnv("AUTH_RECOVERY_ENABLED", "true");
  vi.stubEnv("RESEND_API_KEY", "synthetic-test-key");
  vi.stubEnv("AUTH_EMAIL_FROM", "Allik Test <security@example.test>");
  vi.stubEnv("AUTH_PUBLIC_ORIGIN", origin);
  emails = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      emails.push(String(init.body));
      return Response.json({ id: randomUUID() });
    }),
  );
});
async function fixture() {
  const id = randomUUID(),
    org = randomUUID(),
    membership = randomUUID(),
    token = randomUUID(),
    email = `${id}@example.test`;
  const pool = getPool();
  await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
    org,
    `Password security ${org}`,
  ]);
  await pool.query(
    "INSERT INTO inventory_users(id,name,email,password_hash) VALUES($1,'Synthetic user',$2,$3)",
    [id, email, await hashPassword(oldPassword)],
  );
  await pool.query(
    "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'SUPER_ADMIN')",
    [membership, id, org],
  );
  await pool.query(
    "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
    [id, hashToken(token)],
  );
  const cookie = `allik_inventory_session=${token}`;
  const request = (
    body?: Record<string, unknown>,
    options: { cookie?: string; origin?: string } = {},
  ) =>
    passwordSecurityResponse(
      new Request(`${origin}/api/password-security`, {
        method: body ? "POST" : "GET",
        headers: {
          origin: options.origin ?? origin,
          cookie: options.cookie ?? cookie,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  const admin = (body: Record<string, unknown>) =>
    userAdminResponse(
      new Request(`${origin}/api/v1/inventory/users`, {
        method: "POST",
        headers: { origin, cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { id, org, email, cookie, request, admin };
}
async function seedReset(f: Awaited<ReturnType<typeof fixture>>, patch = "") {
  const token = randomUUID();
  await getPool().query(
    `INSERT INTO inventory_password_resets(user_id,token_hash,session_version,email_hash,expires_at) VALUES($1,$2,0,$3,now()+interval '30 minutes') ${patch}`,
    [f.id, hashToken(token), hashToken(f.email.toLowerCase())],
  );
  return token;
}

describe("individual password security", () => {
  it("requires same-origin and current password to change an individual password", async () => {
    const f = await fixture();
    expect(
      (
        await f.request(
          { action: "CHANGE_PASSWORD", currentPassword: oldPassword, newPassword },
          { origin: "https://attacker.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.request({
          action: "CHANGE_PASSWORD",
          currentPassword: "incorrect-current-password",
          newPassword,
        })
      ).status,
    ).toBe(401);
    const user = await getPool().query(
      "SELECT password_hash,session_version FROM inventory_users WHERE id=$1",
      [f.id],
    );
    expect(await verifyPassword(oldPassword, user.rows[0].password_hash)).toBe(true);
    expect(user.rows[0].session_version).toBe(0);
  });
  it("changes password and invalidates all sessions, invitations and recovery links", async () => {
    const f = await fixture();
    await seedReset(f);
    await getPool().query(
      "INSERT INTO inventory_invites(user_id,organization_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [f.id, f.org, hashToken(randomUUID())],
    );
    expect(
      (await f.request({ action: "CHANGE_PASSWORD", currentPassword: oldPassword, newPassword }))
        .status,
    ).toBe(200);
    const user = (
      await getPool().query(
        "SELECT password_hash,session_version FROM inventory_users WHERE id=$1",
        [f.id],
      )
    ).rows[0];
    expect(await verifyPassword(newPassword, user.password_hash)).toBe(true);
    expect(user.session_version).toBe(1);
    expect(await authenticate(new Request(origin, { headers: { cookie: f.cookie } }))).toBeNull();
    expect(
      (
        await getPool().query(
          "SELECT count(*)::integer AS count FROM inventory_invites WHERE user_id=$1 AND revoked_at IS NULL",
          [f.id],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::integer AS count FROM inventory_password_resets WHERE user_id=$1 AND revoked_at IS NULL AND used_at IS NULL",
          [f.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("reports recovery unavailable and does not issue tokens or send emails before service configuration", async () => {
    const f = await fixture();
    vi.stubEnv("AUTH_RECOVERY_ENABLED", "false");
    const status = await f.request();
    expect(status.status).toBe(200);
    expect((await status.json()).data.recoveryAvailable).toBe(false);
    const known = await f.request({ action: "REQUEST_RESET", email: f.email });
    const unknown = await f.request({
      action: "REQUEST_RESET",
      email: `${randomUUID()}@example.test`,
    });
    expect(known.status).toBe(503);
    expect(unknown.status).toBe(503);
    expect(await known.json()).toEqual(await unknown.json());
    expect(emails).toHaveLength(0);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::integer AS count FROM inventory_password_resets WHERE user_id=$1",
          [f.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("emails a hashed, expiring, single-use recovery token without exposing it in the response", async () => {
    const f = await fixture();
    expect((await (await f.request()).json()).data.recoveryAvailable).toBe(true);
    const response = await f.request({ action: "REQUEST_RESET", email: f.email.toUpperCase() });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(emails).toHaveLength(1);
    const email = JSON.parse(emails[0]!);
    expect(email.to).toEqual([f.email]);
    const token = email.text.match(/#recover=([a-f0-9]{64})/)[1];
    expect(email.text).toContain(`${origin}/estoque/acesso#recover=`);
    expect(JSON.stringify(body)).not.toContain(token);
    const row = (
      await getPool().query(
        "SELECT token_hash, expires_at FROM inventory_password_resets WHERE user_id=$1",
        [f.id],
      )
    ).rows[0];
    expect(row.token_hash).toBe(hashToken(token));
    expect(new Date(row.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
    expect((await f.request({ action: "RESET_PASSWORD", token, newPassword })).status).toBe(200);
    expect(
      (await f.request({ action: "RESET_PASSWORD", token, newPassword: oldPassword })).status,
    ).toBe(410);
  });
  it("does not reveal unknown or inactive accounts and limits delivery attempts", async () => {
    const f = await fixture();
    const unknown = await f.request({
      action: "REQUEST_RESET",
      email: `${randomUUID()}@example.test`,
    });
    expect(await unknown.json()).toEqual({ ok: true });
    await getPool().query("UPDATE inventory_users SET active=false WHERE id=$1", [f.id]);
    expect(await (await f.request({ action: "REQUEST_RESET", email: f.email })).json()).toEqual({
      ok: true,
    });
    expect(emails).toHaveLength(0);
    await getPool().query("UPDATE inventory_users SET active=true WHERE id=$1", [f.id]);
    for (let i = 0; i < 5; i++) await f.request({ action: "REQUEST_RESET", email: f.email });
    expect(emails.length).toBeLessThanOrEqual(3);
  });
  it("revokes undelivered links and returns the same non-enumerating response", async () => {
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: "provider failure" }, { status: 500 })),
    );
    expect(await (await f.request({ action: "REQUEST_RESET", email: f.email })).json()).toEqual({
      ok: true,
    });
    expect(
      (
        await getPool().query("SELECT revoked_at FROM inventory_password_resets WHERE user_id=$1", [
          f.id,
        ])
      ).rows[0].revoked_at,
    ).not.toBeNull();
  });
  it("accepts a valid recovery token only once and invalidates the old authenticated session", async () => {
    const f = await fixture();
    const token = await seedReset(f);
    expect((await f.request({ action: "RESET_PASSWORD", token, newPassword })).status).toBe(200);
    expect(
      (await f.request({ action: "RESET_PASSWORD", token, newPassword: oldPassword })).status,
    ).toBe(410);
    expect(await authenticate(new Request(origin, { headers: { cookie: f.cookie } }))).toBeNull();
    const user = (
      await getPool().query("SELECT password_hash FROM inventory_users WHERE id=$1", [f.id])
    ).rows[0];
    expect(await verifyPassword(newPassword, user.password_hash)).toBe(true);
  });
  it("rejects expired, inactive and changed-session recovery links", async () => {
    for (const mutation of ["expiry", "inactive", "session"]) {
      const f = await fixture();
      const token = await seedReset(f);
      if (mutation === "expiry")
        await getPool().query(
          "UPDATE inventory_password_resets SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
          [f.id],
        );
      if (mutation === "inactive")
        await getPool().query("UPDATE inventory_users SET active=false WHERE id=$1", [f.id]);
      if (mutation === "session")
        await getPool().query(
          "UPDATE inventory_users SET session_version=session_version+1 WHERE id=$1",
          [f.id],
        );
      expect((await f.request({ action: "RESET_PASSWORD", token, newPassword })).status).toBe(410);
    }
  });
  it("rate limits repeated attempts to change a password with an incorrect current password", async () => {
    const f = await fixture();
    for (let n = 0; n < 5; n++)
      expect(
        (
          await f.request({
            action: "CHANGE_PASSWORD",
            currentPassword: "incorrect-current-password",
            newPassword,
          })
        ).status,
      ).toBe(401);
    expect(
      (await f.request({ action: "CHANGE_PASSWORD", currentPassword: oldPassword, newPassword }))
        .status,
    ).toBe(429);
    const user = (
      await getPool().query(
        "SELECT password_hash,session_version FROM inventory_users WHERE id=$1",
        [f.id],
      )
    ).rows[0];
    expect(await verifyPassword(oldPassword, user.password_hash)).toBe(true);
    expect(user.session_version).toBe(0);
  });
  it("allows exactly one of two simultaneous uses of the same recovery token", async () => {
    const f = await fixture();
    const token = await seedReset(f);
    const outcomes = await Promise.all([
      f.request({ action: "RESET_PASSWORD", token, newPassword }),
      f.request({
        action: "RESET_PASSWORD",
        token,
        newPassword: "synthetic-alternate-password-2026",
      }),
    ]);
    expect(outcomes.map((response) => response.status).sort()).toEqual([200, 410]);
    expect(
      (await getPool().query("SELECT session_version FROM inventory_users WHERE id=$1", [f.id]))
        .rows[0].session_version,
    ).toBe(1);
  });
  it("revokes pending activation links when an administrator changes an unactivated account email", async () => {
    const f = await fixture();
    const target = randomUUID();
    const token = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    await getPool().query(
      "INSERT INTO inventory_users(id,name,email) VALUES($1,'Synthetic pending user',$2)",
      [target, `${target}@example.test`],
    );
    await getPool().query(
      "INSERT INTO inventory_memberships(user_id,organization_id,role) VALUES($1,$2,'PARTNER_ADMIN')",
      [target, f.org],
    );
    await getPool().query(
      "INSERT INTO inventory_invites(user_id,organization_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [target, f.org, hashToken(token)],
    );
    const updated = await f.admin({
      action: "UPDATE",
      userId: target,
      name: "Synthetic pending user",
      email: `${randomUUID()}@example.test`,
      role: "PARTNER_ADMIN",
      unitIds: [],
    });
    expect(updated.status).toBe(200);
    const invite = (
      await getPool().query(
        "SELECT revoked_at FROM inventory_invites WHERE user_id=$1 AND token_hash=$2",
        [target, hashToken(token)],
      )
    ).rows[0];
    expect(invite.revoked_at).not.toBeNull();
    expect(
      (await getPool().query("SELECT session_version FROM inventory_users WHERE id=$1", [target]))
        .rows[0].session_version,
    ).toBe(1);
    const activation = await activationResponse(
      new Request(`${origin}/api/inventory-activation`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: newPassword }),
      }),
    );
    expect(activation.status).toBe(410);
    expect(
      (await getPool().query("SELECT password_hash FROM inventory_users WHERE id=$1", [target]))
        .rows[0].password_hash,
    ).toBeNull();
  });
  it("prevents administrators using invitations or email changes to impersonate an activated account", async () => {
    const f = await fixture();
    const target = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_users(id,name,email,password_hash) VALUES($1,'Synthetic target',$2,$3)",
      [target, `${target}@example.test`, await hashPassword(oldPassword)],
    );
    await getPool().query(
      "INSERT INTO inventory_memberships(user_id,organization_id,role) VALUES($1,$2,'PARTNER_ADMIN')",
      [target, f.org],
    );
    expect((await f.admin({ action: "REINVITE", userId: target })).status).toBe(409);
    expect(
      (
        await f.admin({
          action: "UPDATE",
          userId: target,
          name: "Synthetic target",
          email: `${randomUUID()}@example.test`,
          role: "PARTNER_ADMIN",
          unitIds: [],
        })
      ).status,
    ).toBe(403);
    const token = randomUUID() + randomUUID();
    await getPool().query(
      "INSERT INTO inventory_invites(user_id,organization_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [target, f.org, hashToken(token)],
    );
    await expect(
      getPool().query("UPDATE inventory_users SET email=$2 WHERE id=$1", [
        target,
        `${randomUUID()}@example.test`,
      ]),
    ).rejects.toThrow();
    expect(
      (
        await activationResponse(
          new Request(`${origin}/api/inventory-activation`, {
            method: "POST",
            headers: { origin, "Content-Type": "application/json" },
            body: JSON.stringify({ token, password: newPassword }),
          }),
        )
      ).status,
    ).toBe(410);
  });
  it("keeps an activated professional registry immutable through user administration", async () => {
    const f = await fixture();
    const target = randomUUID();
    await getPool().query(
      "INSERT INTO inventory_users(id,name,email,password_hash,profession,professional_council,council_number,council_region) VALUES($1,'Synthetic doctor',$2,$3,'Médico','CRM','4321','CE')",
      [target, `${target}@example.test`, await hashPassword(oldPassword)],
    );
    await getPool().query(
      "INSERT INTO inventory_memberships(user_id,organization_id,role) VALUES($1,$2,'CLINICIAN')",
      [target, f.org],
    );
    const update = (registry: Record<string, string>) =>
      f.admin({
        action: "UPDATE",
        userId: target,
        name: "Synthetic doctor",
        email: `${target}@example.test`,
        profession: "Médico",
        role: "CLINICIAN",
        unitIds: [],
        ...registry,
      });
    const changed = await update({
      professionalCouncil: "CRM",
      councilNumber: "9999",
      councilRegion: "CE",
    });
    expect(changed.status).toBe(409);
    expect(
      (await getPool().query("SELECT council_number FROM inventory_users WHERE id=$1", [target]))
        .rows[0].council_number,
    ).toBe("4321");
    expect(
      (await update({ professionalCouncil: "crm", councilNumber: "CRM-4321", councilRegion: "ce" }))
        .status,
    ).toBe(200);
  });
  it("lets the Preview operator read but not change user accounts", async () => {
    vi.stubEnv("INVENTORY_ENVIRONMENT", "test");
    vi.stubEnv("INVENTORY_PREVIEW_PASSWORD", "synthetic-test-password");
    vi.stubEnv("INVENTORY_SESSION_SECRET", "synthetic-test-secret".repeat(3));
    vi.stubEnv("INVENTORY_PREVIEW_DATA_CLASSIFICATION", "synthetic");
    const login = await previewLogin(
      new Request(`${origin}/api/inventory-session`, {
        method: "POST",
        headers: { origin },
        body: JSON.stringify({ password: "synthetic-test-password" }),
      }),
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const preview = (body?: Record<string, unknown>) =>
      userAdminResponse(
        new Request(`${origin}/api/v1/inventory/users`, {
          method: body ? "POST" : "GET",
          headers: { origin, cookie, "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    expect((await preview()).status).toBe(200);
    const email = `${randomUUID()}@example.test`;
    expect(
      (
        await preview({
          action: "CREATE",
          name: "Preview created user",
          email,
          role: "VIEWER",
          unitIds: [],
        })
      ).status,
    ).toBe(403);
    expect(
      (await getPool().query("SELECT 1 FROM inventory_users WHERE email=$1", [email])).rowCount,
    ).toBe(0);
  });
  it("answers known and unknown recovery requests after the same minimum time", async () => {
    vi.stubEnv("INVENTORY_ENVIRONMENT", "pilot");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        emails.push(String(init.body));
        await new Promise((resolve) => setTimeout(resolve, 300));
        return Response.json({ id: randomUUID() });
      }),
    );
    const f = await fixture();
    const timed = async (email: string) => {
      const started = performance.now();
      const response = await f.request({ action: "REQUEST_RESET", email });
      expect(await response.json()).toEqual({ ok: true });
      return performance.now() - started;
    };
    const unknown = await timed(`${randomUUID()}@example.test`);
    const known = await timed(f.email);
    expect(emails).toHaveLength(1);
    expect(unknown).toBeGreaterThanOrEqual(2400);
    expect(known).toBeGreaterThanOrEqual(2400);
    expect(Math.abs(known - unknown)).toBeLessThan(400);
  });
  it("does not expose account existence when the provider exceeds the response window", async () => {
    vi.stubEnv("INVENTORY_ENVIRONMENT", "pilot");
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 3400);
          init.signal!.addEventListener(
            "abort",
            () => {
              aborted = true;
              clearTimeout(timer);
              reject(new Error("Synthetic abort"));
            },
            { once: true },
          );
        });
        return Response.json({ id: randomUUID() });
      }),
    );
    const f = await fixture();
    const timed = async (email: string) => {
      const started = performance.now();
      const response = await f.request({ action: "REQUEST_RESET", email });
      expect(await response.json()).toEqual({ ok: true });
      return performance.now() - started;
    };
    const unknown = await timed(`${randomUUID()}@example.test`);
    const known = await timed(f.email);
    expect(aborted).toBe(true);
    expect(Math.abs(known - unknown)).toBeLessThan(400);
    const resets = await getPool().query(
      "SELECT revoked_at FROM inventory_password_resets WHERE user_id=$1",
      [f.id],
    );
    expect(resets.rows).toHaveLength(1);
    expect(resets.rows[0].revoked_at).not.toBeNull();
  });
  it("bounds a stalled provider response body and revokes its ambiguous token", async () => {
    vi.stubEnv("INVENTORY_ENVIRONMENT", "pilot");
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal!;
        return { ok: true, json: () => new Promise(() => {}) };
      }),
    );
    const f = await fixture();
    const started = performance.now();
    expect(await (await f.request({ action: "REQUEST_RESET", email: f.email })).json()).toEqual({
      ok: true,
    });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(2400);
    expect(elapsed).toBeLessThan(3000);
    expect(signal?.aborted).toBe(true);
    expect(
      (
        await getPool().query("SELECT revoked_at FROM inventory_password_resets WHERE user_id=$1", [
          f.id,
        ])
      ).rows[0].revoked_at,
    ).not.toBeNull();
  });
});
