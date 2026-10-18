import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";

test("clinical estimate persists pending amounts and finance adjusts a safe commercial projection without operational effects", async ({
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
    patient = randomUUID(),
    catalog = randomUUID(),
    planId = randomUUID();
  const tokens: Record<string, string> = {};
  try {
    await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
      org,
      "Estimates browser " + org,
    ]);
    await pool.query(
      "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Unidade estimativa sintética')",
      [unit, org],
    );
    await pool.query(
      "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'ESTIMATE','Paciente estimativa sintético')",
      [patient, org, unit],
    );
    for (const role of ["CLINICIAN", "FINANCE", "INVENTORY_MANAGER"]) {
      const user = randomUUID(),
        membership = randomUUID(),
        token = randomUUID();
      tokens[role] = token;
      await pool.query(
        "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,$2,$3,'CRM',$4,'CE')",
        [
          user,
          role + " sintético",
          user + "@example.test",
          parseInt(user.slice(0, 8), 16).toString(),
        ],
      );
      await pool.query(
        "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)",
        [membership, user, org, role],
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
    await context.addCookies([
      { name: "allik_inventory_session", value: tokens["INVENTORY_MANAGER"]!, url: baseURL! },
    ]);
    const catalogResponse = await context.request.post(
      `${baseURL}/api/v1/inventory/engine-catalog`,
      {
        headers: { Origin: baseURL! },
        data: {
          action: "SAVE_ITEM",
          id: catalog,
          operationId: randomUUID(),
          version: null,
          kind: "SERVICE",
          name: "Serviço comercial sintético",
          description: "",
          active: true,
        },
      },
    );
    expect(catalogResponse.status()).toBe(201);
    const priceResponse = await context.request.post(`${baseURL}/api/v1/inventory/engine-catalog`, {
      headers: { Origin: baseURL! },
      data: {
        action: "SET_UNIT_PRICE",
        id: randomUUID(),
        operationId: randomUUID(),
        version: null,
        unitId: unit,
        productId: null,
        catalogItemId: catalog,
        amount: "12.50",
        sellingUnit: "SESSION",
        source: "Tabela comercial sintética",
        validFrom: "2020-01-01",
        validUntil: null,
        availability: "AVAILABLE",
        active: true,
      },
    });
    expect(priceResponse.status()).toBe(201);
    await context.addCookies([
      { name: "allik_inventory_session", value: tokens["CLINICIAN"]!, url: baseURL! },
    ]);
    const sourceItem = (optional: boolean) => ({
      id: randomUUID(),
      kind: "SERVICE",
      title: optional ? "PRIVATE_OPTIONAL_MARKER" : "PRIVATE_CLINICAL_MARKER",
      productId: null,
      catalogItemId: optional ? null : catalog,
      administrationUnit: "SESSION",
      optional,
      patientInstructions: "PRIVATE_INSTRUCTION_MARKER",
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
    });
    const sourcePlan = {
      startDate: "2026-10-19",
      previewDays: 30,
      items: [sourceItem(false), sourceItem(true)],
    };
    const creation = await context.request.post(
      `${baseURL}/api/v1/inventory/patient-treatment-plans`,
      {
        headers: { Origin: baseURL! },
        data: {
          action: "SAVE_PLAN",
          id: planId,
          operationId: randomUUID(),
          version: null,
          patientId: patient,
          title: "PRIVATE_PLAN_TITLE",
          status: "ACTIVE",
          plan: sourcePlan,
        },
      },
    );
    expect(creation.status()).toBe(201);
    const clinicalBefore = (
      await pool.query("SELECT version FROM inventory_clinical_plans WHERE id=$1", [planId])
    ).rows[0].version;
    const counts = async () =>
      (
        await pool.query(
          `SELECT jsonb_build_object('treatments',(SELECT count(*) FROM inventory_patient_treatments),'applications',(SELECT count(*) FROM inventory_patient_applications),'stock',(SELECT count(*) FROM inventory_movements),'documents',(SELECT count(*) FROM inventory_encounter_documents),'quotes',(SELECT count(*) FROM inventory_encounter_quotes),'appointments',(SELECT count(*) FROM inventory_care_appointments)) AS counts`,
        )
      ).rows[0].counts;
    const before = await counts();
    await page.goto(`/pacientes/${patient}`);
    const clinicalPanel = page.getByRole("region", {
      name: "Plano clínico estruturado",
      exact: true,
    });
    await clinicalPanel.getByRole("button", { name: "Abrir plano clínico", exact: true }).click();
    await clinicalPanel.getByRole("button", { name: /PRIVATE_PLAN_TITLE · Ativo · v1/ }).click();
    await clinicalPanel.getByRole("tab", { name: "Orçamento", exact: true }).click();
    const estimate = page.getByRole("region", {
      name: "Orçamento estimado — não aprovado",
      exact: true,
    });
    await estimate.getByRole("button", { name: "Calcular estimativa", exact: true }).click();
    await expect(
      estimate.getByText("Pendente — há itens sem valor confirmado", { exact: true }),
    ).toBeVisible();
    await expect(
      estimate.getByText("Subtotal do item: Valor pendente", { exact: true }),
    ).toBeVisible();
    await estimate
      .getByLabel("Quantidade comercial (ajuste explícito)", { exact: true })
      .first()
      .fill("2");
    await estimate
      .getByLabel("Unidade comercial (ajuste explícito)", { exact: true })
      .first()
      .fill("SESSION");
    await clinicalPanel.getByRole("tab", { name: "Plano clínico", exact: true }).click();
    await clinicalPanel.getByRole("tab", { name: "Orçamento", exact: true }).click();
    await expect(
      estimate.getByLabel("Quantidade comercial (ajuste explícito)", { exact: true }).first(),
    ).toHaveValue("2");
    await expect(
      estimate.getByLabel("Unidade comercial (ajuste explícito)", { exact: true }).first(),
    ).toHaveValue("SESSION");
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM inventory_plan_quotes WHERE plan_id=$1",
          [planId],
        )
      ).rows[0].count,
    ).toBe(0);
    await estimate.getByRole("button", { name: "Calcular estimativa", exact: true }).click();
    await estimate.getByRole("button", { name: "Salvar estimativa", exact: true }).click();
    await expect(
      estimate.getByText(
        "Estimativa armazenada. Nenhuma aprovação ou ação operacional foi criada.",
        { exact: true },
      ),
    ).toBeVisible();
    const stored = (
      await pool.query("SELECT id FROM inventory_plan_quotes WHERE plan_id=$1", [planId])
    ).rows;
    expect(stored).toHaveLength(1);
    const commercial = await browser.newContext();
    try {
      await commercial.addCookies([
        { name: "allik_inventory_session", value: tokens["FINANCE"]!, url: baseURL! },
      ]);
      const finance = await commercial.newPage();
      const paths: string[] = [];
      finance.on("request", (request) => paths.push(new URL(request.url()).pathname));
      await finance.goto(`${baseURL}/orcamentos-planos`);
      await finance
        .getByRole("button", {
          name: /Paciente estimativa sintético · Unidade estimativa sintética/,
        })
        .click();
      const card = finance.getByRole("region", {
        name: "Orçamento estimado — não aprovado",
        exact: true,
      });
      await card.getByRole("button", { name: "Revisar esta estimativa", exact: true }).click();
      await card.getByRole("button", { name: "Calcular estimativa", exact: true }).click();
      await expect(
        card.getByText("Subtotal do item: Valor pendente", { exact: true }),
      ).toBeVisible();
      await expect(card.getByLabel("Desconto percentual", { exact: true })).toHaveCount(0);
      await card.getByLabel("Incluir item opcional nesta estimativa", { exact: true }).uncheck();
      await card
        .getByLabel("Quantidade comercial (ajuste explícito)", { exact: true })
        .first()
        .fill("3");
      await card
        .getByLabel("Unidade comercial (ajuste explícito)", { exact: true })
        .first()
        .fill("SESSION");
      await card.getByRole("button", { name: "Calcular estimativa", exact: true }).click();
      await expect(card.getByText("R$ 37,50", { exact: true }).first()).toBeVisible();
      await card.getByRole("button", { name: "Salvar estimativa", exact: true }).click();
      await expect(
        card.getByText("Estimativa armazenada. Nenhuma aprovação ou ação operacional foi criada.", {
          exact: true,
        }),
      ).toBeVisible();
      const api = await commercial.request.get(
        `${baseURL}/api/v1/inventory/plan-quotes?planId=${planId}&quoteId=${stored[0].id}`,
      );
      expect(api.status()).toBe(200);
      const raw = await api.text();
      for (const marker of [
        "PRIVATE_CLINICAL_MARKER",
        "PRIVATE_OPTIONAL_MARKER",
        "PRIVATE_INSTRUCTION_MARKER",
        "PRIVATE_PLAN_TITLE",
        "doseUnits",
        "patientInstructions",
        "originItemId",
      ])
        expect(raw).not.toContain(marker);
      expect(paths).not.toContain("/api/v1/inventory/patient-treatment-plans");
      expect(paths).not.toContain("/api/v1/inventory/encounter-documents");
      const previous = await commercial.request.get(
        `${baseURL}/api/v1/inventory/plan-quotes?planId=${planId}&quoteId=${stored[0].id}&revision=1`,
      );
      expect(previous.status()).toBe(200);
      expect((await previous.json()).data.snapshot.total).toBe(null);
      const latest = await commercial.request.get(
        `${baseURL}/api/v1/inventory/plan-quotes?planId=${planId}&quoteId=${stored[0].id}`,
      );
      const latestData = await latest.json();
      expect(latestData.data.record.version).toBe(2);
      expect(latestData.data.snapshot.total).toBe("37.50");
      await finance.reload({ waitUntil: "networkidle" });
      await expect(
        finance.getByRole("button", {
          name: /Paciente estimativa sintético · Unidade estimativa sintética/,
        }),
      ).toHaveCount(1);
    } finally {
      await commercial.close();
    }
    expect(
      (await pool.query("SELECT version FROM inventory_clinical_plans WHERE id=$1", [planId]))
        .rows[0].version,
    ).toBe(clinicalBefore);
    expect(await counts()).toEqual(before);
  } finally {
    await pool.end();
  }
});
