import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";
import PDFDocument from "pdfkit";

test("Paciente360º preserves laboratory review, conditional preconsultation and prescription for one patient", async ({
  page,
  browser,
  context,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  const url = process.env["DATABASE_URL"];
  if (!url || !new URL(url).pathname.endsWith("_test")) throw Error("Disposable database required");
  const pool = new Pool({ connectionString: url }),
    org = randomUUID(),
    unit = randomUUID(),
    user = randomUUID(),
    membership = randomUUID(),
    patient = randomUUID(),
    document = randomUUID(),
    token = randomUUID();
  const pdf = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.text("EXAME SINTETICO - SOMENTE TESTE");
    doc.text("TSH: <0,1 uUI/mL");
    doc.text("Referencia: 0,27 a 4,2");
    doc.text("Basofilos (%): 1 %, referencia 0 a 2");
    doc.text("Basofilos (absoluto): 300 /mm3, referencia 0 a 100");
    doc.text("Basofilos sem unidade: 7, referencia 0 a 10; unidade ausente");
    doc.end();
  });
  try {
    await pool.query("INSERT INTO inventory_organizations(id,name) VALUES($1,$2)", [
      org,
      "Laboratory " + org,
    ]);
    await pool.query(
      "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Unidade sintética')",
      [unit, org],
    );
    await pool.query(
      "INSERT INTO inventory_users(id,name,email,professional_council,council_number,council_region) VALUES($1,'Clínico sintético',$2,'CRM','12345','CE')",
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
      "INSERT INTO inventory_sessions(user_id,token_hash,session_version,expires_at) VALUES($1,$2,0,now()+interval '1 hour')",
      [user, createHash("sha256").update(token).digest("hex")],
    );
    await pool.query(
      "INSERT INTO inventory_patients(id,organization_id,primary_unit_id,internal_code,full_name) VALUES($1,$2,$3,'LAB-TEST','Paciente fictício')",
      [patient, org, unit],
    );
    await pool.query(
      "UPDATE inventory_users SET profession='Médico',prescribing_address='Rua sintética 1',prescribing_city='Fortaleza',prescribing_state='CE',prescribing_phone='+5585999990000' WHERE id=$1",
      [user],
    );
    await pool.query(
      "INSERT INTO inventory_care_types(organization_id,code,name) VALUES($1,'CONSULTATION','Consulta sintética')",
      [org],
    );
    await pool.query(
      "INSERT INTO inventory_care_rooms(organization_id,unit_id,name) VALUES($1,$2,'Sala sintética')",
      [org, unit],
    );
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "INSERT INTO inventory_patient_documents(id,organization_id,unit_id,patient_id,title,categories,blob_pathname,original_filename,content_type,size_bytes,sha256,uploaded_by_user_id) VALUES($1,$2,$3,$4,'Laboratório sintético',ARRAY['LAB_RESULT'],$5,'test.pdf','application/pdf',$6,$7,$8)",
        [
          document,
          org,
          unit,
          patient,
          "patient-documents/" + org + "/" + patient + "/" + document + ".pdf",
          pdf.length,
          createHash("sha256").update(pdf).digest("hex"),
          user,
        ],
      );
      await c.query(
        "INSERT INTO inventory_patient_document_events(organization_id,unit_id,document_id,actor_user_id,action) VALUES($1,$2,$3,$4,'UPLOADED')",
        [org, unit, document, user],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    // Browser storage fixture only; application review API and PostgreSQL remain real/restricted.
    await page.route("**/api/v1/inventory/patient-document-file?**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("sourceId") === document)
        await route.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
      else await route.continue();
    });
    await context.addCookies([{ name: "allik_inventory_session", value: token, url: baseURL! }]);
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.goto("/pacientes/" + patient);
    await page
      .getByRole("navigation", { name: "Seções do paciente" })
      .getByRole("button", { name: "Exames", exact: true })
      .click();
    await page.getByRole("button", { name: /Laboratório sintético/ }).click();
    await page.getByRole("button", { name: "Conferir resultados laboratoriais" }).click();
    const dialog = page.getByRole("dialog", { name: "Conferência de exames laboratoriais" });
    await expect(dialog.getByRole("button", { name: "Adicionar resultado" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Confirmar resultados" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Adicionar resultado" }).click();
    await dialog.getByLabel("Exame da linha 1", { exact: true }).fill("TSH");
    await dialog.getByLabel("Resultado da linha 1", { exact: true }).fill("<0,1");
    await dialog.getByLabel("Unidade da linha 1", { exact: true }).fill("µUI/mL");
    await dialog.getByLabel("Referência da linha 1", { exact: true }).fill("0,27 – 4,2");
    await dialog.locator("summary").filter({ hasText: "Datas, método" }).first().click();
    await dialog.getByLabel("Coleta da linha 1", { exact: true }).fill("2026-09-01");
    await dialog.getByRole("button", { name: "Adicionar resultado" }).click();
    await dialog.getByLabel("Exame da linha 2", { exact: true }).fill("TSH");
    await dialog.getByLabel("Resultado da linha 2", { exact: true }).fill("1,2");
    await dialog.getByLabel("Unidade da linha 2", { exact: true }).fill("µUI/mL");
    await dialog.getByLabel("Referência da linha 2", { exact: true }).fill("0,27 – 4,2");
    await dialog.locator("summary").filter({ hasText: "Datas, método" }).nth(1).click();
    await dialog.getByLabel("Coleta da linha 2", { exact: true }).fill("2026-10-01");
    await dialog.getByLabel("Conferir linha 2", { exact: true }).check();
    for (const [index, fixture] of [
      [3, { name: "Basófilos (%)", unit: "%", result: "1", reference: "0 a 2" }],
      [4, { name: "Basófilos (absoluto)", unit: "/mm³", result: "300", reference: "0 a 100" }],
      [5, { name: "Basófilos sem unidade", unit: "", result: "7", reference: "0 a 10" }],
    ] as const) {
      await dialog.getByRole("button", { name: "Adicionar resultado" }).click();
      await dialog.getByLabel(`Exame da linha ${index}`, { exact: true }).fill(fixture.name);
      await dialog.getByLabel(`Resultado da linha ${index}`, { exact: true }).fill(fixture.result);
      await dialog.getByLabel(`Unidade da linha ${index}`, { exact: true }).fill(fixture.unit);
      await dialog
        .getByLabel(`Referência da linha ${index}`, { exact: true })
        .fill(fixture.reference);
      await dialog
        .locator("summary")
        .filter({ hasText: "Datas, método" })
        .nth(index - 1)
        .click();
      await dialog.getByLabel(`Coleta da linha ${index}`, { exact: true }).fill("2026-10-01");
      await dialog.getByLabel(`Conferir linha ${index}`, { exact: true }).check();
    }
    await dialog.getByLabel("Confirmei que o PDF corresponde ao paciente selecionado.").check();
    await dialog.getByLabel("Conferir linha 1", { exact: true }).check();
    await page.screenshot({
      path: testInfo.outputPath("laboratory-review-desktop.png"),
      fullPage: false,
    });
    await dialog.getByRole("button", { name: "Confirmar resultados" }).click();
    await expect(dialog.getByText("Validado", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Resultado da linha 1", { exact: true })).toBeDisabled();
    const result = (
      await pool.query("SELECT payload FROM inventory_laboratory_results WHERE patient_id=$1", [
        patient,
      ])
    ).rows;
    expect(result).toHaveLength(5);
    expect(result.map((row) => row.payload.result)).toContain("<0,1");
    await dialog.getByRole("button", { name: "Corrigir resultados" }).click();
    await expect(
      dialog.getByLabel("Confirmei que o PDF corresponde ao paciente selecionado."),
    ).not.toBeChecked();
    await expect(dialog.getByLabel("Conferir linha 1", { exact: true })).not.toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog.getByRole("tab", { name: "Resultados", exact: true })).toBeVisible();
    await dialog.getByRole("tab", { name: "PDF original", exact: true }).click();
    await expect(
      dialog.getByRole("complementary", { name: "PDF original do exame" }),
    ).toBeVisible();
    await dialog.getByRole("tab", { name: "Resultados", exact: true }).click();
    await expect(dialog.getByLabel("Resultado da linha 1", { exact: true })).toHaveValue("<0,1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath("laboratory-review-mobile.png"),
      fullPage: false,
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Histórico de resultados", exact: true }).click();
    const history = page.getByRole("region", { name: "Histórico longitudinal de exames" });
    await expect(
      history.getByRole("table", { name: "Tabela longitudinal de exames" }),
    ).toBeVisible();
    await expect(
      history.getByRole("columnheader", { name: "01/09/2026", exact: true }),
    ).toBeVisible();
    await expect(history.getByText("<0,1", { exact: true })).toBeVisible();
    await history.getByRole("button", { name: "TSH", exact: true }).click();
    const graph = history.getByRole("img", { name: /Evolução de TSH/ });
    await expect(graph).toBeVisible();
    await expect(graph.locator("circle")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath("laboratory-history-mobile.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.screenshot({
      path: testInfo.outputPath("laboratory-history-desktop.png"),
      fullPage: false,
    });
    const biomarkerRow = history.locator('tr[data-biomarker="basofilos"][data-main-row="true"]');
    await expect(biomarkerRow).toHaveCount(1);
    await expect(
      biomarkerRow.getByRole("button", { name: "Detalhes de Basófilos: 1" }),
    ).toBeVisible();
    await history.getByRole("button", { name: "Modalidades de Basófilos" }).click();
    await expect(history.locator('tr[data-biomarker="basofilos"]')).toHaveCount(3);
    await page.screenshot({
      path: testInfo.outputPath("biomarker-modalities-expanded.png"),
      fullPage: false,
    });
    await biomarkerRow
      .getByLabel("Modalidade principal de Basófilos")
      .selectOption({ label: "Contagem absoluta (/mm³)" });
    await expect(biomarkerRow.getByRole("cell", { name: /^0 a 100/ })).toBeVisible();
    await biomarkerRow.getByRole("button", { name: "Basófilos", exact: true }).click();
    const absoluteGraph = history.getByRole("img", { name: "Evolução de Basófilos, unidade /mm³" });
    await expect(absoluteGraph).toBeVisible();
    await expect(absoluteGraph.locator("circle")).toHaveCount(1);
    await expect(absoluteGraph.locator("circle title")).toContainText(": 300 /mm³");
    await history
      .getByLabel("Modalidade do gráfico de Basófilos")
      .selectOption({ label: "Percentual (%)" });
    await expect(
      history.getByRole("img", { name: "Evolução de Basófilos, unidade %" }),
    ).toBeVisible();
    await expect(
      history
        .getByRole("img", { name: "Evolução de Basófilos, unidade %" })
        .locator("circle title"),
    ).toContainText(": 1 %");
    await history
      .getByLabel("Modalidade principal de Basófilos")
      .selectOption({ label: "Modalidade não resolvida · unidade não informada" });
    await expect(history.getByText(/gráfico indisponível/)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("biomarker-unresolved.png"),
      fullPage: false,
    });
    const afterPresentation = (
      await pool.query("SELECT payload FROM inventory_laboratory_results WHERE patient_id=$1", [
        patient,
      ])
    ).rows;
    expect(afterPresentation).toEqual(result);
    // Continue the same patient journey. Setup uses the authorized application API;
    // public answers use a separate context with no clinician session or real message.
    const postQuestionnaire = async (data: Record<string, unknown>) => {
      const response = await context.request.post(`${baseURL}/api/v1/inventory/preconsultation`, {
        headers: { Origin: baseURL! },
        data,
      });
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()).data;
    };
    const formId = randomUUID(),
      invitationId = randomUUID();
    const questionnaireTitle = "Preparo integrado Paciente360º";
    await postQuestionnaire({
      action: "SAVE_FORM",
      id: formId,
      unitId: unit,
      title: questionnaireTitle,
      description: "Somente homologação sintética",
      questions: [
        { id: "uses", label: "Usa algum medicamento?", type: "CHOICE", options: ["Sim", "Não"] },
        {
          id: "details",
          label: "Quais medicamentos?",
          type: "TEXT",
          visibleWhen: { questionId: "uses", equals: "Sim" },
        },
      ],
    });
    const version = (
      await pool.query("SELECT version FROM inventory_preconsultation_forms WHERE id=$1", [formId])
    ).rows[0].version;
    await postQuestionnaire({ action: "PUBLISH_FORM", id: formId, version });
    const invitation = await postQuestionnaire({
      action: "INVITE",
      id: invitationId,
      patientId: patient,
      formId,
      appointmentId: null,
      expiresInDays: 1,
    });
    expect(new URL(invitation.link).search).toBe("");
    const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const publicPage = await publicContext.newPage();
      await publicPage.goto(invitation.link);
      await expect(
        publicPage.getByRole("heading", { name: questionnaireTitle, exact: true }),
      ).toBeVisible();
      expect(new URL(publicPage.url()).hash).toBe("");
      const choice = publicPage.getByLabel(/Usa algum medicamento/);
      const details = publicPage.getByLabel(/Quais medicamentos/);
      await expect(details).toHaveCount(0);
      await choice.selectOption("Sim");
      await details.fill("Resposta que deve desaparecer ao ocultar");
      await choice.selectOption("Não");
      await expect(details).toHaveCount(0);
      await choice.selectOption("Sim");
      await expect(details).toHaveValue("");
      await details.fill("Medicamento sintético declarado pelo paciente");
      await publicPage.getByRole("button", { name: "Revisar respostas", exact: true }).click();
      await expect(
        publicPage.getByText("Medicamento sintético declarado pelo paciente", { exact: true }),
      ).toBeVisible();
      const submitted = publicPage.waitForResponse(
        (response) =>
          response.url().includes("/preconsultation-public") &&
          response.request().postDataJSON()?.action === "SUBMIT",
      );
      await publicPage.getByRole("button", { name: "Enviar respostas", exact: true }).click();
      expect((await submitted).ok()).toBe(true);
      await expect(
        publicPage.getByRole("heading", { name: "Respostas enviadas", exact: true }),
      ).toBeVisible();
      const replayPage = await publicContext.newPage();
      const closedRead = replayPage.waitForResponse(
        (response) =>
          response.url().includes("/preconsultation-public") &&
          response.request().postDataJSON()?.action === "READ",
      );
      const receipt = replayPage.waitForResponse(
        (response) =>
          response.url().includes("/preconsultation-public") &&
          response.request().postDataJSON()?.action === "STATUS",
      );
      await replayPage.goto(invitation.link);
      expect((await closedRead).status()).toBe(404);
      const receiptResponse = await receipt;
      expect(receiptResponse.status()).toBe(200);
      expect(await receiptResponse.json()).toEqual({ data: { submitted: true } });
      await expect(
        replayPage.getByRole("heading", { name: "Respostas enviadas", exact: true }),
      ).toBeVisible();
      expect(new URL(replayPage.url()).hash).toBe("");
      await expect(replayPage.locator("form")).toHaveCount(0);
      await expect(
        replayPage.getByRole("button", { name: "Enviar respostas", exact: true }),
      ).toHaveCount(0);
      await expect(
        replayPage.getByText("Medicamento sintético declarado pelo paciente", { exact: true }),
      ).toHaveCount(0);
      await publicPage.screenshot({
        path: testInfo.outputPath("paciente360-questionnaire-mobile.png"),
      });
    } finally {
      await publicContext.close();
    }
    const professionalRead = await context.request.get(
      `${baseURL}/api/v1/inventory/preconsultation?patientId=${patient}`,
    );
    expect(professionalRead.ok()).toBe(true);
    const readPayload = (await professionalRead.json()).data;
    expect(readPayload.invitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: invitationId,
          patientId: patient,
          answers: { uses: "Sim", details: "Medicamento sintético declarado pelo paciente" },
        }),
      ]),
    );
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM inventory_preconsultation_responses WHERE invitation_id=$1",
          [invitationId],
        )
      ).rows[0].n,
    ).toBe(1);
    await page.goto(`/pacientes/${patient}`);
    const navigation = page.getByRole("navigation", { name: /Seções do paciente|Paciente360/ });
    await navigation.getByRole("button", { name: "Documentos", exact: true }).click();
    await expect(page.getByRole("button", { name: new RegExp(questionnaireTitle) })).toBeVisible();
    await page.getByRole("button", { name: new RegExp(questionnaireTitle) }).click();
    await page.getByRole("button", { name: "Pré-consulta", exact: true }).click();
    const contextualQuestionnaire = page.getByRole("dialog", {
      name: "Pré-consulta · Paciente fictício",
      exact: true,
    });
    await contextualQuestionnaire
      .getByText("Ver respostas da pré-consulta", { exact: true })
      .click();
    await expect(
      contextualQuestionnaire.getByText("Medicamento sintético declarado pelo paciente", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(contextualQuestionnaire).toContainText("não foram validadas clinicamente");
    await contextualQuestionnaire.getByRole("button", { name: "Close", exact: true }).click();

    const questionnaireOrigin = page.getByRole("link", {
      name: "Abrir registro de origem",
      exact: true,
    });
    await expect(questionnaireOrigin).toHaveAttribute(
      "href",
      `/pre-consultas?patientId=${patient}`,
    );
    await questionnaireOrigin.click();
    await page.getByText("Ver respostas da pré-consulta", { exact: true }).click();
    await expect(
      page.getByText("Medicamento sintético declarado pelo paciente", { exact: true }),
    ).toBeVisible();
    await page.goto(`/pacientes/${patient}`);

    await page.setViewportSize({ width: 1536, height: 1024 });
    await expect(page.getByRole("region", { name: "Visão geral do paciente" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("mockup-06-prontuario-desktop.png") });

    // Create and start a real consultation through existing scheduling rules.
    await page.getByRole("button", { name: "Nova consulta", exact: true }).click();
    const newEncounter = page.getByRole("dialog", { name: "Nova consulta", exact: true });
    await expect(newEncounter.getByLabel("Profissional responsável", { exact: true })).toHaveValue(
      user,
    );
    await expect(newEncounter.getByLabel("Sala de atendimento", { exact: true })).toHaveValue(
      "Sala sintética",
    );
    await newEncounter
      .getByRole("button", { name: "Criar e abrir atendimento", exact: true })
      .click();
    await expect(page).toHaveURL(/\/atendimentos\/[a-f0-9-]+$/);
    const appointmentId = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.getByRole("button", { name: "Iniciar atendimento", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Concluir atendimento", exact: true }),
    ).toBeVisible();
    const steps = page.getByRole("tablist", { name: "Etapas do atendimento" });
    const evolutionDraft =
      "Consulta sintética integrada: exames e respostas declaradas conferidos pelo profissional.";
    await page.getByRole("textbox", { name: "Evolução", exact: true }).fill(evolutionDraft);
    await page.screenshot({ path: testInfo.outputPath("mockup-01-anamnese-desktop.png") });
    await steps.getByRole("tab", { name: "Exames", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Exames laboratoriais", exact: true }),
    ).toBeVisible();
    // A reopened PDF must remain visible even while the longitudinal table still
    // serves the last confirmed revision. Confirming it refreshes this mounted
    // table without a reload or switching away from the encounter.
    const examFiles = page.getByRole("region", { name: "Arquivos de exames do paciente" });
    await expect(
      page.getByRole("complementary", { name: "Documento original do exame", exact: true }),
    ).toHaveCount(0);
    await page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: "Arquivos e extrações" }) })
      .locator("summary")
      .click();
    await expect(examFiles.getByText("Pronto para revisão", { exact: true })).toBeVisible();
    await examFiles
      .getByRole("button", { name: "Abrir exame: Laboratório sintético", exact: true })
      .click();
    const originalPanel = page.getByRole("complementary", {
      name: "Documento original do exame",
      exact: true,
    });
    await expect(originalPanel.getByRole("link", { name: "Baixar", exact: true })).toHaveAttribute(
      "href",
      /download=true/,
    );
    await expect(originalPanel.locator("iframe")).toHaveAttribute("src", /^blob:/);
    await originalPanel
      .getByRole("button", { name: "Conferir resultados laboratoriais", exact: true })
      .click();
    await expect(dialog.getByLabel("Resultado da linha 1", { exact: true })).toBeEnabled();
    await dialog.getByLabel("Resultado da linha 1", { exact: true }).fill("0,2");
    await dialog.getByLabel("Conferir linha 1", { exact: true }).check();
    await dialog.getByLabel("Conferir linha 2", { exact: true }).check();
    for (const index of [3, 4, 5])
      await dialog.getByLabel(`Conferir linha ${index}`, { exact: true }).check();
    await dialog.getByLabel("Confirmei que o PDF corresponde ao paciente selecionado.").check();
    await dialog.getByRole("button", { name: "Confirmar resultados", exact: true }).click();
    await expect(dialog.getByText("Validado", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const encounterHistory = page.getByRole("table", {
      name: "Tabela longitudinal de exames",
      exact: true,
    });
    await expect(encounterHistory.getByText("0,2", { exact: true })).toBeVisible();
    await expect(encounterHistory.getByText("<0,1", { exact: true })).toHaveCount(0);
    await expect(examFiles.getByText("Validado", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("mockup-02-exames-desktop.png") });
    await steps.getByRole("tab", { name: "Anamnese", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Evolução", exact: true })).toHaveValue(
      evolutionDraft,
    );
    await steps.getByRole("tab", { name: "Prescrição", exact: true }).click();
    const documents = page.locator("#documentos");
    const prescription = documents.locator(".clinical-inline-composer");
    await expect(prescription.getByLabel("Nome do componente", { exact: true })).toBeVisible();
    expect(
      (
        await pool.query(
          "SELECT count(*)::int count FROM inventory_encounter_documents WHERE appointment_id=$1",
          [appointmentId],
        )
      ).rows[0].count,
    ).toBe(0);
    const component = prescription.getByRole("group", { name: "Componente 1", exact: true });
    await component
      .getByLabel("Nome do componente", { exact: true })
      .fill("Componente sintético integrado");
    await component.getByLabel("Quantidade por unidade", { exact: true }).fill("10");
    await component.getByLabel("Unidade da quantidade (ex.: mg)", { exact: true }).fill("mg");
    await prescription
      .getByLabel("Apresentação (unidade de administração)", { exact: true })
      .selectOption("cápsula");
    await prescription.getByLabel("Via de administração", { exact: true }).selectOption("oral");
    await prescription.getByLabel("Quantidade a dispensar", { exact: true }).fill("30");
    await prescription.getByLabel("Unidade de dispensação", { exact: true }).fill("cápsulas");
    const stage = prescription.getByRole("group", { name: "Etapa 1", exact: true });
    await stage.getByLabel("Unidades por administração", { exact: true }).fill("1");
    await stage.getByLabel("Administrações por dia", { exact: true }).fill("1");
    await stage.getByLabel("Duração em dias", { exact: true }).fill("30");
    await prescription
      .getByRole("button", { name: "Calcular e revisar composição", exact: true })
      .click();
    await prescription
      .getByRole("checkbox", {
        name: "Conferi composição, posologia, quantidade e adequação para este paciente.",
        exact: true,
      })
      .check();
    await prescription
      .getByRole("button", { name: "Inserir no rascunho da receita", exact: true })
      .click();
    await documents.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
    await expect(documents.getByText("Rascunho salvo.", { exact: true })).toBeVisible();
    const saved = (
      await pool.query(
        "SELECT d.status,d.content,a.patient_id FROM inventory_encounter_documents d JOIN inventory_care_appointments a ON a.id=d.appointment_id WHERE d.appointment_id=$1",
        [appointmentId],
      )
    ).rows;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ status: "DRAFT", patient_id: patient });
    expect(saved[0].content).toContain("Componente sintético integrado: 10 mg");
    expect(saved[0].content).toContain("Quantidade a dispensar: 30 cápsulas");
    // Persist the clinical note before a page reload; internal tabs did not submit or discard it.
    await steps.getByRole("tab", { name: "Anamnese", exact: true }).click();
    await page
      .locator("#evolucao")
      .getByRole("button", { name: "Salvar rascunho", exact: true })
      .click();
    await expect(page.getByRole("status").filter({ hasText: /^Rascunho salvo\.$/ })).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await steps.getByRole("tab", { name: "Prescrição", exact: true }).click();
    await documents.getByRole("button", { name: "Receitas e histórico", exact: true }).click();
    await documents.getByRole("button", { name: "Editar receita", exact: true }).click();
    await expect(
      documents.getByRole("textbox", { name: "Conteúdo do documento", exact: true }),
    ).toContainText("Componente sintético integrado: 10 mg");
    await page.screenshot({ path: testInfo.outputPath("mockup-03-prescricao-editor-desktop.png") });
    await documents.getByRole("button", { name: "Voltar aos medicamentos", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("mockup-03-prescricao-desktop.png") });
    await documents.getByRole("button", { name: "Editar receita", exact: true }).click();
    page.once("dialog", (confirmation) => confirmation.accept());
    await documents.getByRole("button", { name: "Finalizar documento", exact: true }).click();
    await expect(documents.getByText("Documento finalizado.", { exact: true })).toBeVisible();
    const finalDocument = (
      await pool.query(
        "SELECT id,status,content,final_snapshot FROM inventory_encounter_documents WHERE appointment_id=$1",
        [appointmentId],
      )
    ).rows[0];
    expect(finalDocument.status).toBe("FINAL");
    expect(finalDocument.final_snapshot).toBeTruthy();
    const printPagePromise = context.waitForEvent("page");
    await documents.getByRole("button", { name: "Visualizar impressão", exact: true }).click();
    const printPage = await printPagePromise;
    await printPage.waitForLoadState();
    await expect(printPage.locator("body")).toContainText("Componente sintético integrado");
    await expect(printPage.locator("body")).toContainText("30 cápsulas");
    await printPage.close();
    await steps.getByRole("tab", { name: "Solicitações", exact: true }).click();
    await documents.getByRole("button", { name: "Adicionar solicitação", exact: true }).click();
    await documents
      .getByRole("textbox", { name: "Conteúdo do documento", exact: true })
      .fill("Solicitação sintética: TSH. Conferir conforme avaliação profissional.");
    await documents.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
    await expect(documents.getByText("Rascunho salvo.", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("mockup-04-solicitacoes-editor-desktop.png"),
    });
    await documents.getByRole("button", { name: "Voltar às solicitações", exact: true }).click();
    await documents.getByRole("button", { name: /^Duplicar rascunho:/ }).click();
    await expect(
      documents.getByText("Cópia independente criada em rascunho.", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await pool.query(
          "SELECT count(*)::int count FROM inventory_encounter_documents WHERE appointment_id=$1 AND type='EXAM_REQUEST' AND discarded_at IS NULL",
          [appointmentId],
        )
      ).rows[0].count,
    ).toBe(2);
    page.once("dialog", (confirmation) => confirmation.accept());
    await documents.getByRole("button", { name: "Excluir rascunho", exact: true }).click();
    await expect(
      documents.getByText("Rascunho excluído da lista. Histórico preservado.", { exact: true }),
    ).toBeVisible();
    const requestCounts = (
      await pool.query(
        "SELECT count(*)::int total,count(*) FILTER (WHERE discarded_at IS NULL)::int active FROM inventory_encounter_documents WHERE appointment_id=$1 AND type='EXAM_REQUEST'",
        [appointmentId],
      )
    ).rows[0];
    expect(requestCounts).toMatchObject({ total: 2, active: 1 });
    await page.screenshot({ path: testInfo.outputPath("mockup-04-solicitacoes-desktop.png") });
    await steps.getByRole("tab", { name: "Revisão", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Resumo do atendimento", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("mockup-05-revisao-desktop.png") });
    await steps.getByRole("tab", { name: "Anamnese", exact: true }).click();
    const evolution = page.locator("#evolucao");
    await evolution
      .getByRole("textbox", { name: "Evolução", exact: true })
      .fill(
        "Consulta sintética integrada: exames e respostas declaradas conferidos pelo profissional.",
      );
    page.once("dialog", (confirmation) => confirmation.accept());
    await evolution.getByRole("button", { name: "Finalizar evolução", exact: true }).click();
    await expect(page.getByText("Evolução finalizada.", { exact: true })).toBeVisible();
    expect(
      (
        await pool.query("SELECT status FROM inventory_clinical_notes WHERE appointment_id=$1", [
          appointmentId,
        ])
      ).rows[0].status,
    ).toBe("FINAL");
    await page.goto(`/pacientes/${patient}`);
    await page
      .getByRole("navigation", { name: /Seções do paciente|Paciente360/ })
      .getByRole("button", { name: "Consultas", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Resumo das consultas", exact: true })
        .getByText(
          "Consulta sintética integrada: exames e respostas declaradas conferidos pelo profissional.",
          { exact: true },
        ),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: /Seções do paciente|Paciente360/ })
      .getByRole("button", { name: "Documentos", exact: true })
      .click();
    await expect(page.getByRole("button", { name: /Receita médica/i })).toBeVisible();
    // Earlier clinical data and source identity survive the new encounter.
    const lastHistory = await context.request.get(
      `${baseURL}/api/v1/inventory/laboratory-history?patientId=${patient}`,
    );
    expect((await lastHistory.json()).data.rows).toHaveLength(5);
  } finally {
    await pool.end();
  }
});
