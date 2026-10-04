import { test, expect } from "@playwright/test";

test("supplier, purchase, partial delivery, completion and persistent stock", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const suffix = Date.now().toString();
  const supplier = `Fornecedor E2E ${suffix}`;
  const reference = `PO-E2E-${suffix}`;
  await page.goto("/estoque/acesso");
  await page.getByLabel("Senha do Preview").fill(process.env["INVENTORY_PREVIEW_PASSWORD"] ?? "");
  await page.getByRole("button", { name: "Acessar estoque", exact: true }).click();
  await page.goto("/estoque/recebimento");
  await page.getByText("Cadastrar fornecedor", { exact: true }).click();
  await page.getByLabel("Nome do fornecedor", { exact: true }).fill(supplier);
  await page.getByRole("button", { name: "Salvar fornecedor", exact: true }).click();
  await expect(page.getByText("Fornecedor cadastrado.", { exact: true })).toBeVisible();
  await page.getByText("Criar pedido", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Fornecedor do pedido", exact: true })
    .selectOption({ label: supplier });
  await page.getByLabel("Número do pedido", { exact: true }).fill(reference);
  await page
    .getByRole("combobox", { name: "Produto do pedido 1", exact: true })
    .selectOption({ label: "Material C" });
  await page.getByLabel("Quantidade pedida 1", { exact: true }).fill("10");
  await page.getByLabel("Custo previsto 1", { exact: true }).fill("4.8");
  await page.getByRole("button", { name: "Salvar pedido", exact: true }).click();
  await page.getByRole("button", { name: `Receber ${reference}`, exact: true }).click();
  await page
    .getByRole("combobox", { name: "Localização", exact: true })
    .selectOption({ label: "Allik Fortaleza" });
  await page.getByLabel("Lote 1", { exact: true }).fill(`E2E-${suffix}`);
  await page.getByLabel("Validade 1", { exact: true }).fill("2099-01-01");
  await page.getByLabel("Quantidade 1", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
  await expect(
    page.getByText("Material C: pedido 10.000 · recebido 4.000 · pendente 6.000", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Material C: pedido 10.000 · recebido 4.000 · pendente 6.000", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: `Receber ${reference}`, exact: true }).click();
  await page
    .getByRole("combobox", { name: "Localização", exact: true })
    .selectOption({ label: "Allik Fortaleza" });
  await page.getByLabel("Lote 1", { exact: true }).fill(`E2E-${suffix}`);
  await page.getByLabel("Validade 1", { exact: true }).fill("2099-01-01");
  await expect(page.getByLabel("Quantidade 1", { exact: true })).toHaveValue("6.000");
  await page.getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Receber ${reference}`, exact: true }),
  ).toBeDisabled();
  await page.goto("/estoque/movimentacoes");
  await expect(page.getByRole("cell", { name: reference, exact: true })).toHaveCount(2);
  await page.screenshot({ path: "/tmp/oi-receiving-e2e.png", fullPage: true });
  expect(errors).toEqual([]);
});
