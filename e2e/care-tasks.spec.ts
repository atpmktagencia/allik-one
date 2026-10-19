import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";

test("individual holder creates, completes, reopens and audits a patient task", async ({
  page,
  context,
  baseURL,
}) => {
  const url = process.env["DATABASE_URL"];
  if (!url || !new URL(url).pathname.endsWith("_test"))
    throw Error("Disposable test database required");
  const pool = new Pool({ connectionString: url });
  const org = randomUUID(),
    unit = randomUUID(),
    user = randomUUID(),
    membership = randomUUID(),
    patient = randomUUID(),
    appointment = randomUUID(),
    token = randomUUID();
  try {
    await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
      org,
      "Tasks browser " + org,
    ]);
    await pool.query(
      "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Unidade tarefas')",
      [unit, org],
    );
    await pool.query(
      "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Responsável sintético',$2,'CRM','123','CE')",
      [user, user + "@example.test"],
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
      "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'TASK-BROWSER','Paciente tarefas sintético')",
      [patient, org, unit],
    );
    await pool.query(
      "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room,status) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour','Sala','IN_PROGRESS')",
      [appointment, org, unit, patient, user],
    );
    await pool.query(
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [user, createHash("sha256").update(token).digest("hex")],
    );
    await context.addCookies([{ name: "allik_inventory_session", value: token, url: baseURL! }]);
    await page.goto(`/atendimentos/${appointment}`);
    await page.getByRole("button", { name: "Questionários e tarefas", exact: true }).click();
    const tasks = page.getByRole("region", { name: "Tarefas da equipe" });
    await expect(tasks.getByRole("button", { name: "Nova tarefa", exact: true })).toBeVisible();
    await tasks.getByRole("button", { name: "Nova tarefa", exact: true }).click();
    await tasks.getByLabel("Prazo", { exact: true }).fill("2020-01-01");
    await tasks.getByRole("combobox", { name: "Responsável", exact: true }).selectOption(user);
    await tasks.getByLabel("Título", { exact: true }).fill("Combinar retorno sintético");
    await tasks.getByRole("button", { name: "Salvar tarefa", exact: true }).click();
    await expect(tasks.getByRole("heading", { name: "Combinar retorno sintético" })).toBeVisible();
    await expect(tasks.getByText("Pendente · Atrasada", { exact: true })).toBeVisible();
    await page.goto("/tarefas");
    await expect(page.getByRole("heading", { name: "Combinar retorno sintético" })).toBeVisible();
    await page.getByRole("button", { name: "Concluir", exact: true }).click();
    await page
      .getByLabel("Concluída — resultado ou motivo")
      .fill("Retorno combinado com o titular");
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Combinar retorno sintético" })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("DONE");
    await expect(page.getByText("Resultado: Retorno combinado com o titular")).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("DONE");
    await page.getByRole("button", { name: "Reabrir", exact: true }).click();
    await page.getByLabel("Pendente — resultado ou motivo").fill("Titular solicitou nova data");
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await page.getByRole("combobox", { name: "Situação", exact: true }).selectOption("PENDING");
    await page.getByRole("button", { name: "Ver histórico", exact: true }).click();
    await expect(
      page.getByText(/Responsável sintético · Concluída · Retorno combinado/),
    ).toBeVisible();
    const rows = await pool.query(
      "SELECT status,version,appointment_id FROM inventory_care_tasks WHERE patient_id=$1",
      [patient],
    );
    expect(rows.rows).toEqual([{ status: "OPEN", version: 2, appointment_id: appointment }]);
  } finally {
    await pool.end();
  }
});
