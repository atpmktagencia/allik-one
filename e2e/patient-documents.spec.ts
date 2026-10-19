import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";

test("patient workspace keeps existing flows and privately previews an indexed clinical document", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_test"))
    throw Error("Disposable test database required");
  const pool = new Pool({ connectionString: databaseUrl });
  const org = randomUUID(),
    unit = randomUUID(),
    user = randomUUID(),
    membership = randomUUID(),
    patient = randomUUID(),
    appointment = randomUUID(),
    document = randomUUID(),
    token = randomUUID();
  try {
    await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
      org,
      `Workspace synthetic ${org}`,
    ]);
    await pool.query(
      "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Unidade documentos sintética')",
      [unit, org],
    );
    await pool.query(
      "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Profissional sintético',$2,'CRM','321','CE')",
      [user, `${user}@example.test`],
    );
    await pool.query(
      "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'CLINICIAN')",
      [membership, user, org],
    );
    await pool.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
      membership,
      unit,
    ]);
    await pool.query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [user, createHash("sha256").update(token).digest("hex")],
    );
    await pool.query(
      "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'WORKSPACE','Paciente documentos sintético')",
      [patient, org, unit],
    );
    await pool.query(
      "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room,status) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour','Sala','IN_PROGRESS')",
      [appointment, org, unit, patient, user],
    );
    await pool.query(
      "INSERT INTO inventory_encounter_documents(id,organization_id,unit_id,patient_id,appointment_id,author_user_id,author_name,professional_council,council_number,council_region,type,title,content,status) VALUES($1,$2,$3,$4,$5,$6,'Profissional sintético','CRM','321','CE','EXAM_REQUEST','Solicitação sintética privada','Conteúdo clínico sintético para revisão','DRAFT')",
      [document, org, unit, patient, appointment, user],
    );
    await context.addCookies([{ name: "allik_inventory_session", value: token, url: baseURL! }]);
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.goto(`/pacientes/${patient}`);
    await expect(
      page.getByRole("region", { name: "Visão geral do paciente", exact: true }),
    ).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Seções do paciente", exact: true });
    await nav.getByRole("button", { name: "Documentos", exact: true }).click();
    const center = page.getByRole("region", { name: "Documentos do paciente", exact: true });
    await center.getByRole("button", { name: /Solicitação sintética privada/ }).click();
    const preview = center.getByRole("complementary", {
      name: "Prévia privada do documento",
      exact: true,
    });
    await expect(
      preview.getByRole("heading", { name: "Solicitação sintética privada", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .frameLocator('iframe[title="Prévia privada: Solicitação sintética privada"]')
        .getByText("Conteúdo clínico sintético para revisão", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("patient-phase1-desktop.png"),
      fullPage: true,
    });
    const opened = page.waitForEvent("popup");
    await preview.getByRole("link", { name: "Abrir prévia em nova aba", exact: true }).click();
    const nativePreview = await opened;
    await expect(
      nativePreview.getByText("Conteúdo clínico sintético para revisão", { exact: true }),
    ).toBeVisible();
    await nativePreview.close();
    await center.getByRole("button", { name: "Tabela", exact: true }).click();
    await expect(center.getByRole("table")).toBeVisible();
    await nav.getByRole("button", { name: "Exames", exact: true }).click();
    await expect(
      page
        .getByRole("region", { name: "Documentos de exames", exact: true })
        .getByText("Solicitação sintética privada", { exact: true })
        .first(),
    ).toBeVisible();
    await nav.getByRole("button", { name: "Tratamentos", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Plano clínico estruturado", exact: true }),
    ).toBeVisible();
    await nav.getByRole("button", { name: "Consultas", exact: true }).click();
    await expect(nav.getByRole("button", { name: "Consultas", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await nav.getByRole("button", { name: "Documentos", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await center.getByRole("button", { name: /Solicitação sintética privada/ }).click();
    await expect
      .poll(async () => {
        const box = await center.boundingBox();
        return !!box && box.x >= -1 && box.x + box.width <= 391;
      })
      .toBe(true);
    await preview.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => {
        const box = await preview.boundingBox();
        return !!box && box.x >= -1 && box.x + box.width <= 391;
      })
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("patient-phase1-mobile.png"),
      fullPage: true,
    });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      )
      .toBe(true);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int count FROM inventory_clinical_access_events WHERE patient_id=$1",
          [patient],
        )
      ).rows[0].count,
    ).toBeGreaterThan(0);
  } finally {
    await pool.end();
  }
});
