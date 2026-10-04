import { test, expect } from "@playwright/test";
test("database-backed stock, product details, movements and reload", async ({ page }) => {
  await page.goto("/estoque");
  await page.getByRole("link", { name: "Acessar demonstração" }).click();
  await page.getByLabel("Senha do Preview").fill(process.env["INVENTORY_PREVIEW_PASSWORD"] ?? "");
  await page.getByRole("button", { name: "Acessar estoque", exact: true }).click();
  await expect(page.getByRole("link", { name: "Injetável A", exact: true })).toBeVisible();
  await expect(page.getByText("Dados persistidos no PostgreSQL")).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "Injetável A", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lotes", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Rastrear lote A-SEED-02", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Movimentações", exact: true }).last().click();
  await expect(page.getByRole("cell", { name: "SEED-M1", exact: true }).first()).toBeVisible();
  await page.goto("/estoque/recebimento");
  await expect(page.getByRole("heading", { name: "Receber compra", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar recebimento" })).toBeEnabled();
  await page.goto("/aplicacoes/nova");
  await expect(page.getByRole("heading", { name: "Nova aplicação", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar aplicação" })).toBeEnabled();
  expect(await page.locator("form").evaluate((form: HTMLFormElement) => form.checkValidity())).toBe(
    false,
  );
});
test("filters to empty and reports missing products", async ({ page }) => {
  await page.goto("/estoque/acesso");
  await page.getByLabel("Senha do Preview").fill(process.env["INVENTORY_PREVIEW_PASSWORD"] ?? "");
  await page.getByRole("button", { name: "Acessar estoque", exact: true }).click();
  await page.getByLabel("Buscar estoque").fill("nenhum-produto");
  await expect(page.getByText("Nenhum produto encontrado para estes filtros.")).toBeVisible();
  await page.goto("/estoque/produtos/00000000-0000-4000-8000-000000000001");
  await expect(page.getByRole("alert")).toContainText("Produto não encontrado");
});
