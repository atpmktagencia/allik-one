import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";

test("individual clinician composes a prescription and explicitly saves a draft", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  test.setTimeout(60_000);
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
    const assertMobileGeometry = async () => {
      const initialGeometry = await dialog.evaluate((node) => {
        const rect = node.getBoundingClientRect(),
          style = getComputedStyle(node),
          child = node.firstElementChild?.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          viewport: window.innerWidth,
          computed: {
            width: style.width,
            minWidth: style.minWidth,
            maxWidth: style.maxWidth,
            gridTemplateColumns: style.gridTemplateColumns,
          },
          className: node.getAttribute("class"),
          inlineStyle: node.getAttribute("style"),
          child: child ? { left: child.left, right: child.right, width: child.width } : null,
        };
      });
      await expect
        .poll(
          async () =>
            dialog.evaluate((node) => {
              const rect = node.getBoundingClientRect();
              return rect.left >= 0 && rect.right <= window.innerWidth;
            }),
          { message: JSON.stringify(initialGeometry) },
        )
        .toBe(true);
      const geometry = await dialog.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const columns = Array.from(node.querySelectorAll("div.grid.items-start > *"))
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0)
          .map((rect) => ({ left: rect.left, right: rect.right, width: rect.width }));
        const controls = Array.from(
          node.querySelectorAll('[role="tablist"],select,[aria-label="Prévia do orçamento"]'),
        )
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0)
          .map((rect) => ({ left: rect.left, right: rect.right, width: rect.width }));
        return {
          controls,
          left: bounds.left,
          right: bounds.right,
          width: bounds.width,
          viewport: window.innerWidth,
          columns,
        };
      });
      expect(geometry.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
      expect(geometry.right, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.columns.length).toBeGreaterThanOrEqual(3);
      for (const column of [...geometry.columns, ...geometry.controls]) {
        expect(column.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.left);
        expect(column.right, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.right + 1);
      }
    };
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
      .selectOption("cápsula");
    await dialog.getByLabel("Via de administração", { exact: true }).selectOption("oral");
    await dialog.getByLabel("Forma farmacêutica", { exact: true }).selectOption("cápsula");
    await dialog.getByLabel("Tipo de cápsula", { exact: true }).selectOption("vegetal");
    await dialog.getByLabel("Base / excipiente", { exact: true }).selectOption("__custom__");
    await dialog
      .getByLabel("Base / excipiente personalizado", { exact: true })
      .fill("Base sintética informada");
    await dialog.getByLabel("Embalagem", { exact: true }).selectOption("frasco");
    await dialog.getByLabel("Quantidade a dispensar", { exact: true }).fill("70");
    await dialog.getByLabel("Unidade de dispensação", { exact: true }).fill("cápsulas");
    const first = dialog.getByRole("group", { name: "Etapa 1", exact: true });
    await first.getByLabel("Unidades por administração", { exact: true }).fill("1");
    await first.getByLabel("Administrações por dia", { exact: true }).fill("2");
    await first.getByLabel("Duração em dias", { exact: true }).fill("10");
    await dialog.getByRole("button", { name: "Adicionar aumento de dose", exact: true }).click();
    const second = dialog.getByRole("group", { name: "Etapa 2", exact: true });
    await second.getByLabel("Unidades por administração", { exact: true }).fill("2");
    await second.getByLabel("Administrações por dia", { exact: true }).fill("1");
    await second.getByLabel("Duração em dias", { exact: true }).fill("25");
    const livePreview = dialog.getByRole("complementary", {
      name: "Prévia do documento",
      exact: true,
    });
    await expect(livePreview).toContainText("Ingrediente excluído B");
    await page.screenshot({
      path: testInfo.outputPath("m20b-composer-desktop.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await assertMobileGeometry();
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
    await expect(preview).toContainText("Posologia inicial (dias 1 a 10)");
    await expect(preview).toContainText("Após concluir a etapa anterior (dias 11 a 35)");
    await expect(
      dialog.getByRole("button", { name: "Inserir no rascunho da receita" }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Transformar em modelo", exact: true }).click();
    await page.getByLabel("Nome do modelo", { exact: true }).fill("Protocolo sintético navegador");
    await page
      .getByLabel("Confirmei que o modelo não contém dados pessoais de pacientes.", { exact: true })
      .check();
    await page.getByRole("button", { name: "Salvar modelo", exact: true }).click();
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
    expect(stored.rows[0].content).toContain("Forma farmacêutica: cápsula");
    expect(stored.rows[0].content).toContain("Tipo de cápsula: vegetal");
    expect(stored.rows[0].content).toContain("Base / excipiente: Base sintética informada");
    expect(stored.rows[0].content).toContain("Embalagem: frasco");
    const savedMetadata = await pool.query(
      "SELECT formula FROM inventory_prescription_protocols WHERE id=$1",
      [protocol.rows[0].id],
    );
    expect(savedMetadata.rows[0].formula).toMatchObject({
      pharmaceuticalForm: "cápsula",
      capsuleType: "vegetal",
      excipient: "Base sintética informada",
      packaging: "frasco",
    });
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
      .selectOption("cápsula");
    await dialog.getByLabel("Via de administração", { exact: true }).selectOption("oral");
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
    // A saved clinical plan is selected explicitly; the unsaved photo composition never supplies commercial links.
    const commercialCatalog = randomUUID(),
      commercialPrice = randomUUID(),
      clinicalPlan = randomUUID();
    await pool.query(
      "INSERT INTO inventory_engine_catalog_items(id,organization_id,kind,name) VALUES($1,$2,'SERVICE','Serviço comercial explícito do plano')",
      [commercialCatalog, org],
    );
    await pool.query(
      "INSERT INTO inventory_engine_unit_sale_prices(id,organization_id,unit_id,catalog_item_id,amount,selling_unit,source,valid_from,availability) VALUES($1,$2,$3,$4,12.50,'SESSION','Tabela sintética explícita','2020-01-01','AVAILABLE')",
      [commercialPrice, org, unit, commercialCatalog],
    );
    await pool.query(
      "INSERT INTO inventory_engine_unit_sale_price_versions(organization_id,unit_id,price_id,version,snapshot) SELECT organization_id,unit_id,id,version,to_jsonb(p) FROM inventory_engine_unit_sale_prices p WHERE id=$1",
      [commercialPrice],
    );
    const savedPlan = await context.request.post(
      `${baseURL}/api/v1/inventory/patient-treatment-plans`,
      {
        headers: { Origin: baseURL! },
        data: {
          action: "SAVE_PLAN",
          id: clinicalPlan,
          operationId: randomUUID(),
          version: null,
          patientId: patient,
          title: "Plano comercial escolhido explicitamente",
          status: "DRAFT",
          plan: {
            startDate: "2026-10-19",
            previewDays: 7,
            items: [
              {
                id: randomUUID(),
                kind: "SERVICE",
                title: "PRIVATE_PLAN_TITLE_M21F",
                productId: null,
                catalogItemId: commercialCatalog,
                administrationUnit: "SESSION",
                optional: false,
                patientInstructions: "PRIVATE_PLAN_INSTRUCTIONS_M21F",
                stages: [
                  {
                    doseUnits: "1",
                    frequencyPerDay: 1,
                    everyDays: 1,
                    durationDays: 2,
                    weekdays: null,
                    times: null,
                  },
                ],
                dispense: null,
                package: null,
              },
            ],
          },
        },
      },
    );
    expect(savedPlan.status()).toBe(201);
    const operationalBefore = (
      await pool.query(
        "SELECT (SELECT count(*) FROM inventory_movements)::int movements,(SELECT count(*) FROM inventory_encounter_quotes WHERE organization_id=$1)::int legacy_quotes",
        [org],
      )
    ).rows[0];
    await page.setViewportSize({ width: 1500, height: 1000 });
    await dialog.getByRole("tab", { name: "Receita", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("m21f-receita-desktop.png") });
    await dialog.getByRole("tab", { name: "Orçamento", exact: true }).click();
    await expect(component(1).getByLabel("Nome do componente", { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Protocolos pessoais / padrão", exact: true }),
    ).toBeVisible();

    const desktopColumns = await dialog
      .locator("div.grid.items-start")
      .first()
      .evaluate((node) =>
        Array.from(node.children).map((child) => {
          const box = child.getBoundingClientRect();
          return { left: box.left, right: box.right, width: box.width };
        }),
      );
    expect(desktopColumns).toHaveLength(3);
    expect(desktopColumns[0]!.right).toBeLessThanOrEqual(desktopColumns[1]!.left);
    expect(desktopColumns[1]!.right).toBeLessThanOrEqual(desktopColumns[2]!.left);
    const planSelect = dialog.getByRole("combobox", {
      name: "Plano clínico salvo para estimativa",
      exact: true,
    });
    await expect(planSelect).toHaveValue("");
    await expect(
      dialog.getByRole("button", { name: "Calcular estimativa", exact: true }),
    ).toHaveCount(0);
    await planSelect.selectOption(clinicalPlan);
    await dialog.getByRole("button", { name: "Calcular estimativa", exact: true }).click();
    await expect(
      dialog.getByText("Serviço comercial explícito do plano", { exact: true }).first(),
    ).toBeVisible();
    await expect(dialog).toContainText("25,00");
    const quoteTab = dialog.getByRole("tab", { name: "Orçamento", exact: true });
    await expect(quoteTab).toBeVisible();
    const tabBounds = await quoteTab.boundingBox();
    const rightBounds = await livePreview.boundingBox();
    expect(tabBounds).not.toBeNull();
    expect(rightBounds).not.toBeNull();
    expect(tabBounds!.x).toBeGreaterThanOrEqual(rightBounds!.x);
    expect(tabBounds!.y).toBeGreaterThanOrEqual(rightBounds!.y);
    expect(tabBounds!.y + tabBounds!.height).toBeLessThanOrEqual(
      Math.min(rightBounds!.y + rightBounds!.height, 1000),
    );

    await expect(dialog).not.toContainText("PRIVATE_PLAN_TITLE_M21F");
    await expect(dialog).not.toContainText("PRIVATE_PLAN_INSTRUCTIONS_M21F");
    await page.screenshot({ path: testInfo.outputPath("m21f-orcamento-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await assertMobileGeometry();
    await dialog
      .getByRole("tablist", { name: "Receita e orçamento", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("m21f-orcamento-mobile.png") });
    await page.setViewportSize({ width: 1500, height: 1000 });
    await dialog.getByRole("tab", { name: "Receita", exact: true }).click();
    await expect(component(1).getByLabel("Nome do componente", { exact: true })).toHaveValue(
      "Glycyrrhiza glabra",
    );
    await expect(component(1).getByLabel("Quantidade por unidade", { exact: true })).toHaveValue(
      "10",
    );
    await expect(livePreview).toContainText("Glycyrrhiza glabra: 10 mg");
    await dialog.getByRole("tab", { name: "Orçamento", exact: true }).click();
    await expect(component(1).getByLabel("Nome do componente", { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Protocolos pessoais / padrão", exact: true }),
    ).toBeVisible();

    await expect(planSelect).toHaveValue(clinicalPlan);
    await expect(dialog).toContainText("25,00");
    await dialog.getByRole("button", { name: "Salvar estimativa", exact: true }).click();
    const proposalLink = dialog.getByRole("link", {
      name: "Exportar proposta estimada",
      exact: true,
    });
    await expect(proposalLink).toBeVisible();
    const proposalPagePromise = context.waitForEvent("page");
    await proposalLink.click();
    const proposalPage = await proposalPagePromise;
    await proposalPage.waitForLoadState();
    await expect(proposalPage.locator("body")).toContainText(
      "Serviço comercial explícito do plano",
    );
    await expect(proposalPage.locator("body")).toContainText("25,00");
    await expect(proposalPage.locator("body")).not.toContainText("PRIVATE_PLAN_TITLE_M21F");
    await expect(proposalPage.locator("body")).not.toContainText("Glycyrrhiza");
    await proposalPage.setViewportSize({ width: 1500, height: 1000 });
    await proposalPage.screenshot({ path: testInfo.outputPath("m21f-proposta-desktop.png") });
    await proposalPage.close();
    expect(
      (
        await pool.query(
          "SELECT (SELECT count(*) FROM inventory_movements)::int movements,(SELECT count(*) FROM inventory_encounter_quotes WHERE organization_id=$1)::int legacy_quotes",
          [org],
        )
      ).rows[0],
    ).toEqual(operationalBefore);
    const preservedRecipe = (
      await pool.query(
        "SELECT content FROM inventory_encounter_documents WHERE appointment_id=$1",
        [appointment],
      )
    ).rows[0];
    expect(preservedRecipe.content).toBe(stored.rows[0].content);
  } finally {
    await pool.end();
  }
});
