import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";

test("individual clinician saves an independent plan with explicit schedule and dispensing without operational side effects", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_test"))
    throw Error("Disposable test database required");
  const pool = new Pool({ connectionString: databaseUrl });
  const org = randomUUID(),
    unit = randomUUID(),
    patient = randomUUID();
  try {
    await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
      org,
      "Clinical plan browser " + org,
    ]);
    await pool.query(
      "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Unidade plano sintético')",
      [unit, org],
    );
    await pool.query(
      "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'CLINICAL-PLAN','Paciente plano sintético')",
      [patient, org, unit],
    );
    const tokens: string[] = [];
    for (let i = 0; i < 2; i++) {
      const user = randomUUID(),
        membership = randomUUID(),
        token = randomUUID();
      tokens.push(token);
      await pool.query(
        "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,$2,$3,'CRM',$4,'CE')",
        [
          user,
          `Clínico sintético ${i}`,
          `${user}@example.test`,
          parseInt(user.slice(0, 8), 16).toString(),
        ],
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
    }
    const operationalCounts = async () =>
      (
        await pool.query(
          `SELECT jsonb_build_object('treatments',(SELECT count(*) FROM inventory_patient_treatments),'applications',(SELECT count(*) FROM inventory_patient_applications),'stockMovements',(SELECT count(*) FROM inventory_movements),'documents',(SELECT count(*) FROM inventory_encounter_documents),'quotes',(SELECT count(*) FROM inventory_encounter_quotes),'appointments',(SELECT count(*) FROM inventory_care_appointments)) AS counts`,
        )
      ).rows[0].counts;
    const before = await operationalCounts();
    await context.addCookies([
      { name: "allik_inventory_session", value: tokens[0]!, url: baseURL! },
    ]);
    await page.goto(`/pacientes/${patient}`);
    await page.getByRole("button", { name: "Tratamentos", exact: true }).click();
    const panel = page.getByRole("region", { name: "Plano clínico estruturado", exact: true });
    await panel.getByRole("button", { name: "Abrir plano clínico", exact: true }).click();
    await panel.getByRole("button", { name: "Novo plano clínico", exact: true }).click();
    await panel
      .getByLabel("Nome do plano clínico", { exact: true })
      .fill("Plano clínico sintético independente");
    await panel.getByLabel("Data inicial do plano", { exact: true }).fill("2026-10-19");
    await panel.getByLabel("Nome do item clínico", { exact: true }).fill("Item clínico sintético");
    await panel.getByLabel("Situação do plano clínico", { exact: true }).selectOption("ACTIVE");
    await panel.getByLabel("Unidade por administração", { exact: true }).selectOption("CAPSULE");
    await panel.getByLabel("Quantidade por administração", { exact: true }).fill("1");
    await panel.getByLabel("Administrações por dia", { exact: true }).fill("1");
    await panel.getByLabel("Intervalo em dias", { exact: true }).fill("1");
    await panel.getByLabel("Duração da etapa (dias)", { exact: true }).fill("10");
    await panel.getByLabel("Horários (HH:mm separados por vírgula)", { exact: true }).fill("08:00");
    await panel.getByLabel("Selecionar dias da semana", { exact: true }).check();
    await panel.getByLabel("Segunda-feira", { exact: true }).check();
    await panel.getByLabel("Quarta-feira", { exact: true }).check();
    await panel.getByLabel("Informar quantidade a dispensar", { exact: true }).check();
    await panel.getByLabel("Quantidade a dispensar", { exact: true }).fill("35");
    await panel.getByLabel("Unidade de dispensação", { exact: true }).selectOption("CAPSULE");
    await panel.getByLabel("Informar capacidade da embalagem", { exact: true }).check();
    await panel.getByLabel("Capacidade por embalagem", { exact: true }).fill("30");
    await panel.getByLabel("Unidade da capacidade", { exact: true }).selectOption("CAPSULE");
    await expect(panel.getByText(/35 CAPSULE · Embalagens necessárias: 2 embalagem/)).toBeVisible();
    await panel.getByRole("button", { name: "Salvar plano clínico", exact: true }).click();
    await expect(
      panel.getByText("Plano clínico salvo. Nenhuma ação operacional foi criada.", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: "Plano clínico sintético independente", exact: true }),
    ).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Tratamentos", exact: true }).click();
    await panel.getByRole("button", { name: "Abrir plano clínico", exact: true }).click();
    await panel
      .getByRole("button", { name: /Plano clínico sintético independente · Ativo · v1/ })
      .click();
    await expect(panel.getByText(/35 CAPSULE · Embalagens necessárias: 2 embalagem/)).toBeVisible();
    await panel.getByText("Ver calendário informado", { exact: true }).click();
    await expect(panel.getByText(/2026-10-19 · 1 administração/)).toBeVisible();
    await expect(panel.getByText(/2026-10-21 · 1 administração/)).toBeVisible();
    await expect(panel.getByText(/2026-10-20 · 1 administração/)).toHaveCount(0);
    const stored = await pool.query(
      "SELECT id,status FROM inventory_clinical_plans WHERE organization_id=$1 AND patient_id=$2",
      [org, patient],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].status).toBe("ACTIVE");
    const colleague = await browser.newContext();
    try {
      await colleague.addCookies([
        { name: "allik_inventory_session", value: tokens[1]!, url: baseURL! },
      ]);
      const other = await colleague.newPage();
      await other.goto(`${baseURL}/pacientes/${patient}`);
      await other.getByRole("button", { name: "Tratamentos", exact: true }).click();
      const otherPanel = other.getByRole("region", {
        name: "Plano clínico estruturado",
        exact: true,
      });
      await otherPanel.getByRole("button", { name: "Abrir plano clínico", exact: true }).click();
      await otherPanel
        .getByRole("button", { name: /Plano clínico sintético independente · Ativo · v1/ })
        .click();
      await expect(
        otherPanel.getByRole("heading", {
          name: "Plano clínico sintético independente",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        otherPanel.getByRole("button", { name: "Editar plano clínico", exact: true }),
      ).toHaveCount(0);
      await expect(
        otherPanel.getByText(/35 CAPSULE · Embalagens necessárias: 2 embalagem/),
      ).toBeVisible();
    } finally {
      await colleague.close();
    }
    expect(await operationalCounts()).toEqual(before);
  } finally {
    await pool.end();
  }
});
