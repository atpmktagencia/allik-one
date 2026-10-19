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
    expect(result).toHaveLength(2);
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
      await replayPage.goto(invitation.link);
      await expect(replayPage.getByRole("alert")).toBeVisible();
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
    const documents = page.locator("#documentos");
    await documents.getByRole("button", { name: "Novo documento", exact: true }).click();
    await page.getByRole("menuitem", { name: "Receita médica", exact: true }).click();
    await documents
      .getByRole("button", { name: "Compor receita estruturada", exact: true })
      .click();
    const prescription = page.getByRole("dialog", {
      name: "Composição estruturada e protocolos pessoais",
    });
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
    await page.reload({ waitUntil: "networkidle" });
    await expect(documents.getByText(/Componente sintético integrado: 10 mg/)).toBeVisible();
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
    const evolution = page.locator("#evolucao");
    await evolution
      .getByLabel("Evolução", { exact: true })
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
    expect((await lastHistory.json()).data.rows).toHaveLength(2);
  } finally {
    await pool.end();
  }
});
