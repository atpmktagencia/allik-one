import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type {
  SupplierProfile,
  SupplierCatalogItem,
  SupplierOrder,
} from "../src/data/supplier-input";

test("maintain suppliers/catalog and order grouped boxes with costs, exports, WhatsApp and receiving", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const suffix = Date.now().toString();
  const vendor = `Fornecedor catálogo ${suffix}`;
  const code = `MANUAL-${suffix}`;
  const reference = `PO-CATALOG-${suffix}`;
  await page.goto("/estoque/acesso");
  await page.getByLabel("Senha").fill(process.env["INVENTORY_PREVIEW_PASSWORD"] ?? "");
  await page.getByRole("button", { name: "Acessar estoque", exact: true }).click();
  await page.getByRole("link", { name: "Fazer compra", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fazer compra", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Novo fornecedor", exact: true }).click();
  await page.getByLabel("Nome do fornecedor", { exact: true }).fill(vendor);
  await page.getByLabel("WhatsApp com código do país", { exact: true }).fill("+55 48 8802-9876");
  await page.getByRole("button", { name: "Salvar fornecedor", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Fornecedor do catálogo", exact: true })
    .selectOption({ label: vendor });
  await page.getByRole("button", { name: "Novo item", exact: true }).click();
  await page
    .getByLabel("Nome completo do item", { exact: true })
    .fill("Item sintético de catálogo");
  await page.getByLabel("Código interno", { exact: true }).fill(code);
  await page
    .getByLabel("SKU oficial do fornecedor (opcional)", { exact: true })
    .fill("SKU-CONFIRMADO-01");
  await page.getByLabel("Boxes físicos por apresentação (opcional)", { exact: true }).fill("1");
  await page.getByLabel("Preço por apresentação (R$)", { exact: true }).fill("10.25");
  await page.getByRole("button", { name: "Salvar item", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: `Editar ${code}`, exact: true }).click();
  await page.getByLabel("Preço por apresentação (R$)", { exact: true }).fill("11.50");
  await page
    .getByLabel("Motivo da alteração", { exact: true })
    .fill("Cotação sintética atualizada");
  await page.getByRole("button", { name: "Salvar item", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Histórico do fornecedor", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Histórico do fornecedor", exact: true }),
  ).toContainText("Preço: 10.25 → 11.50");
  await page.getByRole("button", { name: "Fechar histórico", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Fornecedor do catálogo", exact: true })
    .selectOption({ label: "Essentia" });
  const suppliers = (await (await page.request.get("/api/v1/inventory/vendors")).json())
    .data as SupplierProfile[];
  const essentia = suppliers.find((s) => s.name === "Essentia")!;
  const catalog = (
    await (
      await page.request.get(`/api/v1/inventory/vendor-catalog?supplierId=${essentia.id}`)
    ).json()
  ).data as SupplierCatalogItem[];
  expect(catalog).toHaveLength(388);
  await page
    .getByRole("combobox", { name: "Tipo do catálogo", exact: true })
    .selectOption("pending");
  await expect(page.getByRole("checkbox", { name: /Selecionar/ })).toHaveCount(7);
  for (const c of await page.getByRole("checkbox", { name: /Selecionar/ }).all())
    await expect(c).toBeDisabled();
  await page.getByRole("combobox", { name: "Tipo do catálogo", exact: true }).selectOption("all");
  await page.getByLabel("Buscar no catálogo", { exact: true }).fill("ESS-P092");
  await page.getByRole("checkbox", { name: "Selecionar ESS-P092", exact: true }).check();
  await page
    .getByRole("spinbutton", { name: "Quantidade de apresentações ESS-P092", exact: true })
    .fill("2");
  await expect(page.getByRole("cell", { name: "2 boxes físicos", exact: false })).toHaveCount(0);
  await expect(page.getByText("4 boxes físicos", { exact: true })).toBeVisible();
  await page.getByLabel("Buscar no catálogo", { exact: true }).fill("ESS-P001");
  await page.getByRole("checkbox", { name: "Selecionar ESS-P001", exact: true }).check();
  await page
    .getByRole("spinbutton", { name: "Quantidade de apresentações ESS-P001", exact: true })
    .fill("3");
  await page.getByRole("button", { name: "Revisar pedido", exact: true }).click();
  await expect(page.getByRole("region", { name: "Revisão do pedido", exact: true })).toContainText(
    "4 boxes físicos",
  );
  await page.getByLabel("Referência do pedido", { exact: true }).fill(reference);
  await page.getByLabel("Frete estimado (R$, opcional)", { exact: true }).fill("25.50");
  await page
    .getByLabel("Observações do pedido", { exact: true })
    .fill("Pedido sintético para validação; confirmar cotação.");
  await page.getByRole("button", { name: "Salvar pedido e exportar", exact: true }).click();
  const region = page.getByRole("region", { name: `Pedido ${reference}`, exact: true });
  await expect(region).toBeVisible();
  const whatsapp = region.getByRole("link", { name: "Revisar e enviar no WhatsApp", exact: true });
  const href = (await whatsapp.getAttribute("href"))!;
  expect(href).toMatch(/^https:\/\/wa.me\/554888029876\?text=/);
  expect(decodeURIComponent(href)).toContain("4 box(es)");
  expect(decodeURIComponent(href)).toContain("SKU oficial não informado");
  const downloadPromise = page.waitForEvent("download");
  await region.getByRole("link", { name: "Exportar CSV", exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const csv = await readFile(path!, "utf8");
  expect(csv).toContain('"ESS-P092"');
  expect(csv).toContain('"2";"4";"378,00";"756,00"');
  expect(csv).toContain('"25,50"');
  const orders = (await (await page.request.get("/api/v1/inventory/vendor-orders")).json())
    .data as SupplierOrder[];
  const order = orders.find((o) => o.reference === reference)!;
  expect(order.items).toHaveLength(2);
  const expected = 756 + Number(catalog.find((i) => i.code === "ESS-P001")!.price) * 3 + 25.5;
  expect(Number(order.total)).toBe(expected);
  for (const i of order.items) {
    const stock = (
      await (await page.request.get(`/api/v1/inventory/stock?productId=${i.productId}`)).json()
    ).data;
    expect(stock).toEqual([]);
  }
  await page.reload();
  await page.getByRole("button", { name: `Abrir pedido ${reference}`, exact: true }).click();
  await expect(region).toContainText("Total estimado:");
  await page.screenshot({ path: "/tmp/oi-suppliers-e2e.png", fullPage: true });
  await region.getByRole("link", { name: "Receber pedido", exact: true }).click();
  await page.getByRole("button", { name: `Receber ${reference}`, exact: true }).click();
  await page
    .getByRole("combobox", { name: "Localização", exact: true })
    .selectOption({ label: "Allik Fortaleza" });
  const po = (await (await page.request.get("/api/v1/inventory/purchases")).json()).data.find(
    (p: { id: string }) => p.id === order.id,
  ) as { items: { productId: string; name: string; quantity: string }[] };
  for (let n = 1; n <= po.items.length; n++) {
    await page.getByLabel(`Lote ${n}`, { exact: true }).fill(`CAT-${suffix}-${n}`);
    await page.getByLabel(`Validade ${n}`, { exact: true }).fill("2099-01-01");
  }
  await page.getByRole("button", { name: "Confirmar recebimento", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Recebimento registrado." }),
  ).toBeVisible();
  for (const i of po.items) {
    const positions = (
      await (await page.request.get(`/api/v1/inventory/stock?productId=${i.productId}`)).json()
    ).data;
    expect(positions).toHaveLength(1);
    expect(positions[0].quantity).toBe(Number(i.quantity));
    expect(positions[0].unit).toBe("apresentação");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/estoque/fornecedores");
  await page.getByLabel("Buscar no catálogo", { exact: true }).fill("ESS-P092");
  await expect(
    page.getByRole("checkbox", { name: "Selecionar ESS-P092", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "/tmp/oi-suppliers-mobile-e2e.png", fullPage: true });
  expect(errors).toEqual([]);
});
