import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";

test("catalog manager creates service and unit price, reloads it, and clinician remains read only", async ({
  page,
  context,
  baseURL,
  browser,
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
      `Browser engine ${org}`,
    ]);
    await pool.query(
      "INSERT INTO inventory_units(id,organization_id,name) VALUES($1,$2,'Synthetic browser unit')",
      [unit, org],
    );
    const cookies: Record<string, string> = {};
    for (const role of ["INVENTORY_MANAGER", "CLINICIAN"]) {
      const user = randomUUID(),
        membership = randomUUID(),
        token = randomUUID();
      cookies[role] = token;
      await pool.query(
        "INSERT INTO inventory_users(id,name,email) VALUES($1,'Synthetic catalog browser',$2)",
        [user, `${user}@example.test`],
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
      { name: "allik_inventory_session", value: cookies["INVENTORY_MANAGER"]!, url: baseURL! },
    ]);
    await page.goto("/catalogo-clinico");
    await page.getByRole("button", { name: "Novo item", exact: true }).click();
    await page.getByLabel("Tipo do item", { exact: true }).selectOption("SERVICE");
    await page.getByLabel("Nome do item", { exact: true }).fill("Serviço sintético isolado");
    await page
      .getByLabel("Descrição do item", { exact: true })
      .fill("Catálogo sem cobrança automática");
    await page.getByRole("button", { name: "Salvar item", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Serviço sintético isolado", exact: true }),
    ).toBeVisible();
    const item = await pool.query(
      "SELECT id FROM inventory_engine_catalog_items WHERE organization_id=$1",
      [org],
    );
    await page.getByRole("tab", { name: "Preços por unidade", exact: true }).click();
    await page.getByRole("button", { name: "Novo preço", exact: true }).click();
    await page.getByLabel("Unidade do preço", { exact: true }).selectOption(unit);
    await page
      .getByLabel("Item precificado", { exact: true })
      .selectOption(`ITEM:${item.rows[0].id}`);
    await page.getByLabel("Preço de venda (BRL)", { exact: true }).fill("125.50");
    await page.getByLabel("Unidade de venda", { exact: true }).fill("sessão");
    await page.getByLabel("Origem do preço", { exact: true }).fill("Tabela sintética aprovada");
    await page.getByLabel("Disponibilidade", { exact: true }).selectOption("AVAILABLE");
    await page.getByLabel("Vigência inicial", { exact: true }).fill("2020-01-01");
    await page.getByRole("button", { name: "Salvar preço", exact: true }).click();
    await expect(page.getByText(/Tabela sintética aprovada/)).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "Preços por unidade", exact: true }).click();
    await expect(page.getByText(/Tabela sintética aprovada/)).toBeVisible();
    const price = await pool.query(
      "SELECT amount::text,selling_unit,source FROM inventory_engine_unit_sale_prices WHERE organization_id=$1",
      [org],
    );
    expect(price.rows).toEqual([
      { amount: "125.50", selling_unit: "sessão", source: "Tabela sintética aprovada" },
    ]);
    const clinical = await browser.newContext();
    try {
      await clinical.addCookies([
        { name: "allik_inventory_session", value: cookies["CLINICIAN"]!, url: baseURL! },
      ]);
      const clinicalPage = await clinical.newPage();
      await clinicalPage.goto(`${baseURL}/catalogo-clinico`);
      await expect(
        clinicalPage.getByRole("heading", { name: "Serviço sintético isolado", exact: true }),
      ).toBeVisible();
      await expect(
        clinicalPage.getByRole("button", { name: "Novo item", exact: true }),
      ).toHaveCount(0);
      await clinicalPage.getByRole("tab", { name: "Preços por unidade", exact: true }).click();
      await expect(
        clinicalPage.getByRole("button", { name: "Novo preço", exact: true }),
      ).toHaveCount(0);
      await expect(clinicalPage.getByText(/Tabela sintética aprovada/)).toBeVisible();
    } finally {
      await clinical.close();
    }
  } finally {
    await pool.end();
  }
});
