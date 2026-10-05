import { test, expect } from "@playwright/test";
import type { CatalogProduct, CatalogLocation } from "../src/data/catalog-input";
import type { InventoryPosition } from "../src/data/inventory-api";

test("create and edit catalog, reactivate empty records, receive and protect physical stock", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const suffix = Date.now().toString();
  const name = `Produto cadastro ${suffix}`;
  const sku = `CAT-${suffix}`;
  const local = `Local cadastro ${suffix}`;
  const renamedLocal = `${local} revisado`;
  const revisedName = `${name} revisado`;
  await page.goto("/estoque/acesso");
  await page.getByLabel("Senha do Preview").fill(process.env["INVENTORY_PREVIEW_PASSWORD"] ?? "");
  await page.getByRole("button", { name: "Acessar estoque", exact: true }).click();
  await expect(page).toHaveURL(/\/estoque$/);
  await page.getByRole("link", { name: "Produtos e locais", exact: true }).click();
  await page.getByRole("button", { name: "Novo produto", exact: true }).click();
  await page.getByLabel("Nome do produto", { exact: true }).fill(name);
  await page.getByLabel("SKU", { exact: true }).fill(sku);
  await page.getByLabel("Categoria", { exact: true }).fill("Material sintético");
  await page.getByLabel("Unidade", { exact: true }).fill("un");
  await page.getByLabel("Estoque mínimo", { exact: true }).fill("1.125");
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Produto cadastrado.");
  await page.getByLabel("Buscar cadastros", { exact: true }).fill(sku);
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Editar produto ${name}`, exact: true }).click();
  await expect(page.getByLabel("SKU", { exact: true })).toHaveAttribute("readonly");
  await expect(page.getByLabel("Unidade", { exact: true })).toHaveAttribute("readonly");
  await page.getByLabel("Estoque mínimo", { exact: true }).fill("3.25");
  await page.getByLabel("Motivo da alteração", { exact: true }).fill("Mínimo sintético revisado");
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Produto atualizado.");
  await page.getByRole("button", { name: `Histórico do produto ${name}`, exact: true }).click();
  const history = page.getByRole("region", { name: `Histórico de ${name}`, exact: true });
  await expect(history.getByText("Estoque mínimo: 1,125 → 3,25", { exact: true })).toBeVisible();
  await expect(history.getByText("Responsável: preview-operator", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Fechar histórico", exact: true }).click();
  await page.getByRole("button", { name: `Editar produto ${name}`, exact: true }).click();
  await page.getByLabel("Produto ativo", { exact: true }).uncheck();
  await page
    .getByLabel("Motivo da alteração", { exact: true })
    .fill("Desativação sintética sem saldo");
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Produto atualizado.");
  await page
    .getByRole("combobox", { name: "Situação dos cadastros", exact: true })
    .selectOption("inactive");
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await page.goto("/estoque/recebimento");
  await expect(
    page
      .getByRole("combobox", { name: "Produto 1", exact: true })
      .locator(`option[value]`)
      .filter({ hasText: name }),
  ).toHaveCount(0);
  await page.goto("/estoque/cadastros");
  await page.getByRole("button", { name: `Editar produto ${name}`, exact: true }).click();
  await page.getByLabel("Produto ativo", { exact: true }).check();
  await page
    .getByLabel("Motivo da alteração", { exact: true })
    .fill("Reativação sintética para receber");
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Produto atualizado.");
  await page.getByRole("button", { name: "Novo local", exact: true }).click();
  await page.getByLabel("Nome do local", { exact: true }).fill(local);
  await page.getByRole("button", { name: "Salvar local", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Local cadastrado.");
  await page.getByRole("button", { name: `Editar local ${local}`, exact: true }).click();
  await page.getByLabel("Nome do local", { exact: true }).fill(renamedLocal);
  await page
    .getByLabel("Motivo da alteração", { exact: true })
    .fill("Identificação sintética do local");
  await page.getByRole("button", { name: "Salvar local", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Local atualizado.");
  await page.reload();
  await expect(page.getByRole("cell", { name: renamedLocal, exact: true })).toBeVisible();
  const products = (await (await page.request.get("/api/v1/inventory/catalog/products")).json())
    .data as CatalogProduct[];
  const product = products.find((p) => p.sku === sku)!;
  const locations = (await (await page.request.get("/api/v1/inventory/catalog/locations")).json())
    .data as CatalogLocation[];
  const location = locations.find((l) => l.name === renamedLocal)!;
  expect(product.minimum).toBe("3.250");
  await page.goto("/estoque/recebimento");
  await page.getByLabel("Fornecedor", { exact: true }).fill("Fornecedor sintético cadastro");
  await page.getByLabel("Referência da compra", { exact: true }).fill(`RC-CAT-${suffix}`);
  await page.getByRole("combobox", { name: "Localização", exact: true }).selectOption(location.id);
  await page.getByRole("combobox", { name: "Produto 1", exact: true }).selectOption(product.id);
  await page.getByLabel("Lote 1", { exact: true }).fill(`LOT-CAT-${suffix}`);
  await page.getByLabel("Validade 1", { exact: true }).fill("2099-01-01");
  await page.getByLabel("Quantidade 1", { exact: true }).fill("2.125");
  await page.getByLabel("Custo unitário 1", { exact: true }).fill("4.8");
  await page.getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Recebimento registrado." }),
  ).toBeVisible();
  await page.goto("/estoque/cadastros");
  for (const [kind, label, item] of [
    ["produto", "Produto ativo", name],
    ["local", "Local ativo", renamedLocal],
  ] as const) {
    await page.getByRole("button", { name: `Editar ${kind} ${item}`, exact: true }).click();
    await page.getByLabel(label, { exact: true }).uncheck();
    await page
      .getByLabel("Motivo da alteração", { exact: true })
      .fill("Tentativa sintética com saldo físico");
    await page.getByRole("button", { name: `Salvar ${kind}`, exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Ainda há saldo físico");
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  }
  await page.getByRole("button", { name: `Editar produto ${name}`, exact: true }).click();
  await page.getByLabel("Nome do produto", { exact: true }).fill(revisedName);
  await page.getByLabel("Estoque mínimo", { exact: true }).fill("5.375");
  await page
    .getByLabel("Motivo da alteração", { exact: true })
    .fill("Nome e mínimo sintéticos com saldo");
  await page.getByRole("button", { name: "Salvar produto", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Produto atualizado.");
  await page
    .getByRole("button", { name: `Histórico do produto ${revisedName}`, exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: `Histórico de ${revisedName}`, exact: true })
      .getByText("Responsável: preview-operator", { exact: true }),
  ).toHaveCount(5);
  await page.screenshot({ path: "/tmp/oi-catalog-e2e.png", fullPage: true });
  await page.reload();
  await page.getByRole("link", { name: revisedName, exact: true }).click();
  await expect(page.getByRole("heading", { name: revisedName, exact: true })).toBeVisible();
  await page.getByRole("link", { name: `Rastrear lote LOT-CAT-${suffix}`, exact: true }).click();
  await expect(page.getByText("2.125 un", { exact: true })).toHaveCount(4);
  await expect(
    page.getByText("1 movimentações · 1 registros de auditoria", { exact: true }),
  ).toBeVisible();
  const stock = (
    await (await page.request.get(`/api/v1/inventory/stock?productId=${product.id}`)).json()
  ).data as InventoryPosition[];
  expect(stock).toEqual([
    expect.objectContaining({
      name: revisedName,
      quantity: 2.125,
      location: renamedLocal,
      active: true,
      minimum: 5.375,
    }),
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/estoque/cadastros");
  await page.getByLabel("Buscar cadastros", { exact: true }).fill(sku);
  await expect(page.getByRole("link", { name: revisedName, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "/tmp/oi-catalog-mobile-e2e.png", fullPage: true });
  expect(errors).toEqual([]);
});
