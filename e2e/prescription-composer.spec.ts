import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";

test("individual clinician composes a prescription and explicitly saves a draft", async ({
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
    const documents = page.locator("#documentos");
    await documents.getByRole("button", { name: "Novo documento", exact: true }).click();
    await page.getByRole("menuitem", { name: "Receita médica", exact: true }).click();
    await documents
      .getByRole("button", { name: "Compor receita estruturada", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Composição estruturada e protocolos pessoais",
    });
    await dialog.getByLabel("Nome do componente", { exact: true }).fill("Componente sintético");
    await dialog.getByLabel("Quantidade por unidade", { exact: true }).fill("10");
    await dialog.getByLabel("Unidade da quantidade (ex.: mg)", { exact: true }).fill("mg");
    await dialog
      .getByLabel("Apresentação (unidade de administração)", { exact: true })
      .fill("cápsula");
    await dialog.getByLabel("Via de administração", { exact: true }).fill("oral");
    const first = dialog.getByRole("group", { name: "Etapa 1", exact: true });
    await first.getByLabel("Unidades por administração", { exact: true }).fill("1");
    await first.getByLabel("Administrações por dia", { exact: true }).fill("2");
    await first.getByLabel("Duração em dias", { exact: true }).fill("10");
    await dialog.getByRole("button", { name: "Adicionar etapa", exact: true }).click();
    const second = dialog.getByRole("group", { name: "Etapa 2", exact: true });
    await second.getByLabel("Unidades por administração", { exact: true }).fill("2");
    await second.getByLabel("Administrações por dia", { exact: true }).fill("1");
    await second.getByLabel("Duração em dias", { exact: true }).fill("25");
    await dialog
      .getByRole("button", { name: "Calcular e revisar composição", exact: true })
      .click();
    const preview = dialog.getByRole("region", { name: "Revisão da composição" });
    await expect(preview.getByRole("heading")).toContainText("70 unidade(s)");
    await expect(
      dialog.getByRole("button", { name: "Inserir no rascunho da receita" }),
    ).toBeDisabled();
    await dialog
      .getByLabel("Nome do protocolo pessoal", { exact: true })
      .fill("Protocolo sintético navegador");
    page.once("dialog", (d) => d.accept());
    await dialog.getByRole("button", { name: "Salvar protocolo", exact: true }).click();
    await expect(dialog.getByText("Protocolo pessoal salvo.", { exact: true })).toBeVisible();
    const protocol = await pool.query(
      "SELECT id FROM inventory_prescription_protocols WHERE organization_id=$1",
      [org],
    );
    await dialog.getByRole("combobox", { name: "Protocolo pessoal", exact: true }).selectOption("");
    await dialog
      .getByRole("combobox", { name: "Protocolo pessoal", exact: true })
      .selectOption(protocol.rows[0].id);
    await expect(dialog.getByLabel("Nome do componente", { exact: true })).toHaveValue(
      "Componente sintético",
    );
    await dialog
      .getByRole("button", { name: "Calcular e revisar composição", exact: true })
      .click();
    await preview
      .getByRole("checkbox", {
        name: "Conferi composição, posologia, quantidade e adequação para este paciente.",
        exact: true,
      })
      .check();
    await dialog
      .getByRole("button", { name: "Inserir no rascunho da receita", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await documents.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
    await expect(documents.getByText("Rascunho salvo.", { exact: true })).toBeVisible();
    const stored = await pool.query(
      "SELECT status,content FROM inventory_encounter_documents WHERE appointment_id=$1",
      [appointment],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].status).toBe("DRAFT");
    expect(stored.rows[0].content).toContain("Componente sintético: 10 mg");
    expect(stored.rows[0].content).toContain("70 unidade(s)");
    await page.reload({ waitUntil: "networkidle" });
    await expect(documents.getByText(/Componente sintético: 10 mg/)).toBeVisible();
  } finally {
    await pool.end();
  }
});
