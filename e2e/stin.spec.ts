import { test, expect } from "@playwright/test";
import type {
  SupplierProfile,
  SupplierCatalogItem,
  SupplierOrder,
} from "../src/data/supplier-input";
test("Stin catalog preserves boxes, complete kit, notes and vendor-specific costs/exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/estoque/acesso");
  await page.getByLabel("Senha do Preview").fill(process.env["INVENTORY_PREVIEW_PASSWORD"] ?? "");
  await page.getByRole("button", { name: "Acessar estoque", exact: true }).click();
  await page.goto("/estoque/fornecedores");
  await page
    .getByRole("combobox", { name: "Fornecedor do catálogo", exact: true })
    .selectOption({ label: "Stin Pharma" });
  const suppliers = (await (await page.request.get("/api/v1/inventory/vendors")).json())
    .data as SupplierProfile[];
  const supplier = suppliers.find((s) => s.name === "Stin Pharma")!;
  expect(supplier.phone).toBe("551120781800");
  const catalog = (
    await (
      await page.request.get(`/api/v1/inventory/vendor-catalog?supplierId=${supplier.id}`)
    ).json()
  ).data as SupplierCatalogItem[];
  expect(catalog).toHaveLength(116);
  expect(catalog.filter((i) => i.kind === "PRODUCT")).toHaveLength(115);
  await page.getByLabel("Buscar no catálogo", { exact: true }).fill("STIN-P038");
  await expect(page.getByText("Conferir cadastro", { exact: true })).toBeVisible();
  await page.getByText("Ver composição e fonte", { exact: true }).click();
  await expect(page.getByText(/Pendência de cadastro: Divergência: 15%/)).toBeVisible();
  await page.getByLabel("Buscar no catálogo", { exact: true }).fill("STIN-P001");
  await page.getByRole("checkbox", { name: "Selecionar STIN-P001", exact: true }).check();
  await page
    .getByRole("spinbutton", { name: "Quantidade de apresentações STIN-P001", exact: true })
    .fill("2");
  await page.getByLabel("Buscar no catálogo", { exact: true }).fill("STIN-K001");
  await expect(page.getByRole("checkbox", { name: /Selecionar STIN-K001/ })).toHaveCount(1);
  await page.getByText("Ver composição e fonte", { exact: true }).click();
  for (let n = 1; n <= 5; n++)
    await expect(page.getByText(new RegExp(`STIN-K001-F${n}`))).toBeVisible();
  await page.getByRole("checkbox", { name: "Selecionar STIN-K001", exact: true }).check();
  await page.getByRole("button", { name: "Revisar pedido", exact: true }).click();
  const review = page.getByRole("region", { name: "Revisão do pedido", exact: true });
  await expect(review).toContainText("2 boxes físicos");
  await expect(review).toContainText("609,00");
  const reference = `STIN-DEMO-${Date.now()}`;
  await page.getByLabel("Referência do pedido", { exact: true }).fill(reference);
  await page
    .getByLabel("Observações do pedido", { exact: true })
    .fill("Validação sintética do catálogo; não enviado ao fornecedor.");
  await page.getByRole("button", { name: "Salvar pedido e exportar", exact: true }).click();
  const saved = page.getByRole("region", { name: `Pedido ${reference}`, exact: true });
  await expect(saved).toContainText("5 frascos + 1 ampola");
  const href = (await saved
    .getByRole("link", { name: "Revisar e enviar no WhatsApp", exact: true })
    .getAttribute("href"))!;
  expect(href).toMatch(/^https:\/\/wa.me\/551120781800\?text=/);
  expect(decodeURIComponent(href)).toContain("SKU oficial não informado");
  const orders = (await (await page.request.get("/api/v1/inventory/vendor-orders")).json())
    .data as SupplierOrder[];
  const order = orders.find((o) => o.reference === reference)!;
  expect(order).toMatchObject({
    subtotal: "609.00",
    freight: null,
    total: "609.00",
    items: [
      { quantity: 2, boxes: 2, price: "55.00", subtotal: "110.00" },
      { quantity: 1, boxes: null, price: "499.00", subtotal: "499.00" },
    ],
  });
  for (const item of order.items) {
    const stock = (
      await (await page.request.get(`/api/v1/inventory/stock?productId=${item.productId}`)).json()
    ).data;
    expect(stock).toEqual([]);
  }
  const csv = await (
    await page.request.get(`/api/v1/inventory/vendor-orders?id=${order.id}&format=csv`)
  ).text();
  expect(csv).toContain('"2";"2";"55,00";"110,00"');
  expect(csv).toContain('"STIN-K001"');
  expect(csv).toContain('"499,00"');
  await page.reload();
  await page
    .getByRole("combobox", { name: "Fornecedor do catálogo", exact: true })
    .selectOption({ label: "Stin Pharma" });
  await page.getByLabel("Buscar no catálogo", { exact: true }).fill("STIN-K001");
  await page.getByRole("button", { name: `Abrir pedido ${reference}`, exact: true }).click();
  await expect(saved).toContainText("609,00");
  await page.screenshot({ path: "/tmp/oi-stin-e2e.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "/tmp/oi-stin-mobile-e2e.png", fullPage: true });
  expect(errors).toEqual([]);
});
