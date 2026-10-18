import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";

test("clinician copies an organization template into a private model and independent prescription draft", async ({
  page,
  context,
  baseURL,
  request,
}) => {
  const url = process.env["DATABASE_URL"];
  if (!url || !new URL(url).pathname.endsWith("_test"))
    throw Error("Disposable test database required");
  const pool = new Pool({ connectionString: url }),
    org = randomUUID(),
    unit = randomUUID();
  try {
    await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
      org,
      `Shared browser ${org}`,
    ]);
    await pool.query(
      "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Shared browser unit')",
      [unit, org],
    );
    const users: Record<string, { id: string; appointment: string; cookie: string }> = {};
    for (const role of ["owner", "colleague"]) {
      const id = randomUUID(),
        membership = randomUUID(),
        patient = randomUUID(),
        appointment = randomUUID(),
        token = randomUUID();
      users[role] = { id, appointment, cookie: token };
      await pool.query(
        "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Synthetic model browser',$2,'CRM',$3,'CE')",
        [id, `${id}@example.test`, String(BigInt("0x" + id.replaceAll("-", "").slice(0, 12)))],
      );
      await pool.query(
        "INSERT INTO inventory_memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'CLINICIAN')",
        [membership, id, org],
      );
      await pool.query("INSERT INTO inventory_unit_access(membership_id,unit_id) VALUES($1,$2)", [
        membership,
        unit,
      ]);
      await pool.query(
        "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
        [id, createHash("sha256").update(token).digest("hex")],
      );
      await pool.query(
        "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,$4,'Synthetic browser patient')",
        [patient, org, unit, randomUUID()],
      );
      await pool.query(
        "INSERT INTO inventory_care_appointments(id,organization_id,unit_id,patient_id,professional_user_id,care_type,starts_at,ends_at,room,status) VALUES($1,$2,$3,$4,$5,'CONSULTATION',now(),now()+interval '1 hour',$6,'IN_PROGRESS')",
        [appointment, org, unit, patient, id, `Shared room ${appointment}`],
      );
    }
    const formula = {
      ingredients: [
        {
          medicationName: "Synthetic shared component",
          dose: "1",
          doseUnit: "mg",
          individualCapsule: false,
        },
      ],
      route: "oral",
      presentation: "cápsula",
      instructions: "",
      phases: [{ doseUnits: 1, frequencyPerDay: 1, durationDays: 7, maintenance: false }],
    };
    const ownerHeaders = {
      origin: new URL(baseURL!).origin,
      cookie: `allik_inventory_session=${users["owner"]!.cookie}`,
    };
    const sourceBody = {
      action: "SAVE",
      appointmentId: users["owner"]!.appointment,
      title: "Modelo de organização sintético",
      formula,
      visibility: "ORGANIZATION",
      category: "Synthetic",
      description: "Reusable synthetic content",
      unitIds: [unit],
      confirmedNoPatientData: true,
    };
    const create = await request.post(`${baseURL}/api/v1/inventory/prescription-composer`, {
      headers: ownerHeaders,
      data: sourceBody,
    });
    expect(create.status()).toBe(200);
    const { data: source } = await create.json();
    await context.addCookies([
      { name: "allik_inventory_session", value: users["colleague"]!.cookie, url: baseURL! },
    ]);
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.goto(`/atendimentos/${users["colleague"]!.appointment}`);
    const documents = page.locator("#documentos");
    await documents.getByRole("button", { name: "Novo documento", exact: true }).click();
    await page.getByRole("menuitem", { name: "Receita médica", exact: true }).click();
    await documents
      .getByRole("button", { name: "Compor receita estruturada", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Composição estruturada e protocolos pessoais",
    });
    await dialog
      .getByRole("combobox", { name: "Protocolo pessoal", exact: true })
      .selectOption(source.id);
    await expect(dialog.getByLabel("Quantidade por unidade", { exact: true })).toHaveValue("1");
    await dialog.getByLabel("Quantidade por unidade", { exact: true }).fill("5");
    await dialog.getByRole("button", { name: "Transformar em modelo", exact: true }).click();
    await page.getByLabel("Nome do modelo", { exact: true }).fill("Minha cópia privada sintética");
    await expect(page.getByLabel("Visibilidade do modelo", { exact: true })).toHaveValue("PRIVATE");
    await page
      .getByLabel("Confirmei que o modelo não contém dados pessoais de pacientes.", { exact: true })
      .check();
    await page.getByRole("button", { name: "Salvar modelo", exact: true }).click();
    await expect(dialog.getByText("Protocolo pessoal salvo.", { exact: true })).toBeVisible();
    const copies = await pool.query(
      "SELECT id,author_user_id,visibility,formula FROM inventory_prescription_protocols WHERE organization_id=$1 ORDER BY created_at",
      [org],
    );
    expect(copies.rows).toHaveLength(2);
    const copy = copies.rows.find((row) => row.id !== source.id)!;
    expect(copy.author_user_id).toBe(users["colleague"]!.id);
    expect(copy.visibility).toBe("PRIVATE");
    expect(copy.formula.ingredients[0].dose).toBe("5");
    expect(copies.rows.find((row) => row.id === source.id).formula.ingredients[0].dose).toBe("1");
    await dialog
      .getByRole("button", { name: "Calcular e revisar composição", exact: true })
      .click();
    const review = dialog.getByRole("region", { name: "Revisão da composição" });
    await review
      .getByLabel("Conferi composição, posologia, quantidade e adequação para este paciente.", {
        exact: true,
      })
      .check();
    await review
      .getByRole("button", { name: "Inserir no rascunho da receita", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await documents.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
    await expect(documents.getByText("Rascunho salvo.", { exact: true })).toBeVisible();
    const update = await request.post(`${baseURL}/api/v1/inventory/prescription-composer`, {
      headers: ownerHeaders,
      data: {
        ...sourceBody,
        id: source.id,
        version: source.version,
        formula: { ...formula, ingredients: [{ ...formula.ingredients[0], dose: "2" }] },
      },
    });
    expect(update.status()).toBe(200);
    await page.reload({ waitUntil: "networkidle" });
    await expect(documents.getByText(/Synthetic shared component: 5 mg/)).toBeVisible();
    const persisted = await pool.query(
      "SELECT d.content,d.status,i.source_protocol_id,i.source_version,i.formula FROM inventory_encounter_documents d JOIN inventory_prescription_protocol_instances i ON i.document_id=d.id WHERE d.appointment_id=$1",
      [users["colleague"]!.appointment],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({
      status: "DRAFT",
      source_protocol_id: copy.id,
      source_version: 1,
    });
    expect(persisted.rows[0].formula.ingredients[0].dose).toBe("5");
    expect(persisted.rows[0].content).toContain("Synthetic shared component: 5 mg");
  } finally {
    await pool.end();
  }
});
