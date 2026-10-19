import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";

test("individual holder publishes questionnaire, patient submits once, clinician reviews optional answers", async ({
  page,
  browser,
  context,
  baseURL,
}, testInfo) => {
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
    await page.goto("/pre-consultas");
    await page.getByText("Modelos de questionário", { exact: true }).click();
    await page.getByRole("button", { name: "Novo questionário", exact: true }).click();
    await page.getByLabel("Título do questionário", { exact: true }).fill("Preparo sintético");
    await page.getByLabel("Texto da pergunta", { exact: true }).fill("Qual seu objetivo?");
    await page.getByRole("button", { name: "Adicionar pergunta", exact: true }).click();
    await page.getByLabel("Texto da pergunta", { exact: true }).nth(1).fill("Algo mais?");
    for (let index = 2; index < 7; index++) {
      await page.getByRole("button", { name: "Adicionar pergunta", exact: true }).click();
      await page
        .getByLabel("Texto da pergunta", { exact: true })
        .nth(index)
        .fill(`Pergunta adicional ${index + 1}`);
    }
    await page.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
    await page.getByRole("button", { name: "Publicar versão", exact: true }).click();
    await page.getByRole("combobox", { name: "Paciente", exact: true }).selectOption(patient);
    const form = await pool.query(
      "SELECT id FROM inventory_preconsultation_forms WHERE organization_id=$1",
      [org],
    );
    await page
      .getByRole("combobox", { name: "Questionário publicado", exact: true })
      .selectOption(form.rows[0].id);
    await page.getByRole("button", { name: "Gerar link de pré-consulta", exact: true }).click();
    const link = await page.getByLabel("Link de pré-consulta", { exact: true }).inputValue();
    expect(new URL(link).search).toBe("");
    expect(new URL(link).hash).toContain("token=");
    const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const publicPage = await publicContext.newPage();
      await publicPage.goto(link);
      await expect(
        publicPage.getByRole("heading", { name: "Preparo sintético", exact: true }),
      ).toBeVisible();
      expect(new URL(publicPage.url()).hash).toBe("");
      await expect(publicPage.getByText("Paciente tarefas sintético", { exact: true })).toHaveCount(
        0,
      );
      await publicPage.getByLabel(/Qual seu objetivo/).fill("Desejo organizar o acompanhamento");
      await publicPage.getByRole("button", { name: "Próxima etapa", exact: true }).click();
      await expect(publicPage.getByText(/Etapa 2 de 2/)).toBeVisible();
      await publicPage.getByRole("button", { name: "Etapa anterior", exact: true }).click();
      await expect(publicPage.getByLabel(/Qual seu objetivo/)).toHaveValue(
        "Desejo organizar o acompanhamento",
      );
      await publicPage.getByRole("button", { name: "Próxima etapa", exact: true }).click();
      await publicPage.screenshot({
        path: testInfo.outputPath("preconsultation-steps-mobile.png"),
        fullPage: false,
      });
      await publicPage.getByRole("button", { name: "Revisar respostas", exact: true }).click();
      await expect(
        publicPage.getByText("Desejo organizar o acompanhamento", { exact: true }),
      ).toBeVisible();
      await publicPage.getByRole("button", { name: "Enviar respostas", exact: true }).click();
      await expect(
        publicPage.getByRole("heading", { name: "Respostas enviadas", exact: true }),
      ).toBeVisible();
      const replayPage = await publicContext.newPage();
      await replayPage.goto(link);
      await expect(replayPage.getByRole("alert")).toBeVisible();
      await expect(
        replayPage.getByText("Desejo organizar o acompanhamento", { exact: true }),
      ).toHaveCount(0);
    } finally {
      await publicContext.close();
    }
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Ver respostas da pré-consulta", { exact: true }).click();
    await expect(
      page.getByText("Desejo organizar o acompanhamento", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Não informado", { exact: true })).toHaveCount(6);
    const rows = await pool.query(
      "SELECT r.answers FROM inventory_preconsultation_responses r JOIN inventory_preconsultation_invitations i ON i.id=r.invitation_id WHERE i.patient_id=$1",
      [patient],
    );
    expect(Object.values(rows.rows[0].answers).sort()).toEqual([
      ...Array(6).fill(""),
      "Desejo organizar o acompanhamento",
    ]);
  } finally {
    await pool.end();
  }
});
