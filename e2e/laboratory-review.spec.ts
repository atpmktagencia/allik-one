import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";
import PDFDocument from "pdfkit";

test("clinician reviews laboratory values beside the original and explicitly seals an immutable revision", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
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
    expect(result).toHaveLength(1);
    expect(result[0].payload.result).toBe("<0,1");
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
  } finally {
    await pool.end();
  }
});
