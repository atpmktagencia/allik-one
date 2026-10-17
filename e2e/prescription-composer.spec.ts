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
    await page.setViewportSize({ width: 1500, height: 1000 });
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
    const component = (n: number) =>
      dialog.getByRole("group", { name: `Componente ${n}`, exact: true });
    await component(1)
      .getByLabel("Nome do componente", { exact: true })
      .fill("Componente sintético");
    await component(1).getByLabel("Quantidade por unidade", { exact: true }).fill("10");
    await component(1).getByLabel("Unidade da quantidade (ex.: mg)", { exact: true }).fill("mg");
    for (const [number, name] of [
      [2, "Ingrediente excluído B"],
      [3, "Ingrediente excluído C"],
    ] as const) {
      await dialog.getByRole("button", { name: "Adicionar componente", exact: true }).click();
      await component(number).getByLabel("Nome do componente", { exact: true }).fill(name);
      await component(number).getByLabel("Quantidade por unidade", { exact: true }).fill("5");
      await component(number)
        .getByLabel("Unidade da quantidade (ex.: mg)", { exact: true })
        .fill("mg");
    }
    await dialog
      .getByLabel("Apresentação (unidade de administração)", { exact: true })
      .fill("cápsula");
    await dialog.getByLabel("Via de administração", { exact: true }).fill("oral");
    await dialog.getByLabel("Quantidade a dispensar", { exact: true }).fill("70");
    await dialog.getByLabel("Unidade de dispensação", { exact: true }).fill("cápsulas");
    const first = dialog.getByRole("group", { name: "Etapa 1", exact: true });
    await first.getByLabel("Unidades por administração", { exact: true }).fill("1");
    await first.getByLabel("Administrações por dia", { exact: true }).fill("2");
    await first.getByLabel("Duração em dias", { exact: true }).fill("10");
    await dialog.getByRole("button", { name: "Adicionar etapa", exact: true }).click();
    const second = dialog.getByRole("group", { name: "Etapa 2", exact: true });
    await second.getByLabel("Unidades por administração", { exact: true }).fill("2");
    await second.getByLabel("Administrações por dia", { exact: true }).fill("1");
    await second.getByLabel("Duração em dias", { exact: true }).fill("25");
    const livePreview = dialog.getByRole("complementary", {
      name: "Prévia do documento",
      exact: true,
    });
    await expect(livePreview).toContainText("Ingrediente excluído B");
    await page.screenshot({ path: "/workspace/work/m20b-composer-desktop.png", fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    // A tall desktop viewport keeps all three selectors visible for a genuine continuous pointer drag.
    await page.setViewportSize({ width: 1500, height: 1600 });
    await dialog.locator('[data-composer-selector="0"]').scrollIntoViewIfNeeded();
    const boxes = await Promise.all(
      [1, 2, 3].map((n) =>
        dialog
          .getByRole("checkbox", { name: `Incluir componente ${n}`, exact: true })
          .boundingBox(),
      ),
    );
    expect(boxes.every(Boolean)).toBe(true);
    const points = boxes.map((box) => ({
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
    }));
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    await page.mouse.move(points[1].x, points[1].y, { steps: 12 });
    await page.mouse.move(points[2].x, points[2].y, { steps: 12 });
    await page.mouse.up();
    for (const n of [1, 2, 3])
      await expect(
        dialog.getByRole("checkbox", { name: `Incluir componente ${n}`, exact: true }),
      ).not.toBeChecked();
    await expect(livePreview).not.toContainText("Componente sintético");
    await dialog.getByRole("checkbox", { name: "Incluir componente 1", exact: true }).click();
    await expect(
      dialog.getByRole("checkbox", { name: "Incluir componente 1", exact: true }),
    ).toBeChecked();
    await expect(livePreview).toContainText("Componente sintético: 10 mg");
    await expect(livePreview).not.toContainText("Ingrediente excluído B");
    await expect(livePreview).not.toContainText("Ingrediente excluído C");
    await page.setViewportSize({ width: 1500, height: 1000 });
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
    await expect(component(1).getByLabel("Nome do componente", { exact: true })).toHaveValue(
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
    expect(stored.rows[0].content).toContain(
      "Quantidade a dispensar: 70 cápsulas (informada pelo prescritor).",
    );
    expect(stored.rows[0].content).not.toContain("Ingrediente excluído B");
    expect(stored.rows[0].content).not.toContain("Ingrediente excluído C");
    await page.reload({ waitUntil: "networkidle" });
    await expect(documents.getByText(/Componente sintético: 10 mg/)).toBeVisible();
    await documents
      .getByRole("button", { name: "Compor receita estruturada", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Modelo da foto · conferir", exact: true }).click();
    const photoSelectors = dialog.getByRole("checkbox", { name: /^Incluir componente \d+$/ });
    expect(await photoSelectors.count()).toBeGreaterThan(60);
    expect(
      await photoSelectors.evaluateAll((nodes) =>
        nodes.every((node) => !(node as HTMLInputElement).checked),
      ),
    ).toBe(true);
    await expect(livePreview).not.toContainText("Glycyrrhiza glabra");
    await expect(livePreview).not.toContainText("Rhodiola rosea");
    await dialog.getByRole("checkbox", { name: "Incluir componente 1", exact: true }).click();
    await component(1).getByLabel("Quantidade por unidade", { exact: true }).fill("10");
    await component(1).getByLabel("Unidade da quantidade (ex.: mg)", { exact: true }).fill("mg");
    await dialog
      .getByLabel("Apresentação (unidade de administração)", { exact: true })
      .fill("cápsula");
    await dialog.getByLabel("Via de administração", { exact: true }).fill("oral");
    const referencePhase = dialog.getByRole("group", { name: "Etapa 1", exact: true });
    await referencePhase.getByLabel("Unidades por administração", { exact: true }).fill("1");
    await referencePhase.getByLabel("Administrações por dia", { exact: true }).fill("1");
    await referencePhase.getByLabel("Duração em dias", { exact: true }).fill("30");
    await expect(livePreview).toContainText("Glycyrrhiza glabra: 10 mg");
    await expect(livePreview).not.toContainText("Rhodiola rosea");
    await expect(livePreview).not.toContainText("Progesterona base lipofílica");
    // Loading/reference selection alone never writes a template or modifies the saved prescription.
    const unchanged = await pool.query(
      "SELECT content FROM inventory_encounter_documents WHERE appointment_id=$1",
      [appointment],
    );
    expect(unchanged.rows[0].content).toBe(stored.rows[0].content);
  } finally {
    await pool.end();
  }
});
