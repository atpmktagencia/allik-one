import { test, expect } from "@playwright/test";
import type { InventoryPosition, InventoryProduct } from "../src/data/inventory-api";

test("receive, recommend FEFO, apply multiple items and retain consumption history", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/estoque/acesso");
  await page.getByLabel("Senha").fill(process.env["INVENTORY_PREVIEW_PASSWORD"] ?? "");
  await page.getByRole("button", { name: "Acessar estoque", exact: true }).click();
  await expect(page).toHaveURL(/\/estoque$/);
  const origin = new URL(page.url()).origin;
  const products = (await (await page.request.get("/api/v1/inventory/products")).json())
    .data as InventoryProduct[];
  const product = products.find((row) => row.name === "Material C")!;
  const second = products.find((row) => row.name === "Injetável B")!;
  const locations = (await (await page.request.get("/api/v1/inventory/locations")).json()).data as {
    id: string;
    name: string;
  }[];
  const location = locations.find((row) => row.name === "Allik Fortaleza")!;
  const suffix = Date.now().toString();
  const firstLot = `FEFO-FIRST-${suffix}`;
  const laterLot = `FEFO-LATER-${suffix}`;
  const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const receipt = await page.request.post("/api/v1/inventory/receipts", {
    headers: { origin },
    data: {
      operationId: crypto.randomUUID(),
      reference: `REC-FEFO-${suffix}`,
      supplier: "Fornecedor sintético FEFO",
      locationId: location.id,
      items: [
        { productId: product.id, lot: laterLot, expiry: date(20), quantity: "3", unitCost: "4.8" },
        { productId: product.id, lot: firstLot, expiry: date(10), quantity: "3", unitCost: "4.8" },
      ],
    },
  });
  expect(receipt.status()).toBe(201);
  const stock = (await (await page.request.get("/api/v1/inventory/stock")).json())
    .data as InventoryPosition[];
  const earliest = stock.find((row) => row.lot === firstLot)!;
  const secondPosition = stock.find(
    (row) =>
      row.productId === second.id && row.locationId === location.id && row.status === "AVAILABLE",
  )!;
  const reference = `AP-E2E-${suffix}`;
  await page.goto("/aplicacoes/nova");
  await page
    .getByRole("combobox", { name: "Paciente sintético", exact: true })
    .selectOption("demo-patient-a");
  await page.getByLabel("Referência da aplicação", { exact: true }).fill(reference);
  await page
    .getByLabel("Serviço / procedimento", { exact: true })
    .fill("Procedimento sintético E2E");
  await page.getByLabel("Profissional executor", { exact: true }).fill("Executor sintético E2E");
  await page
    .getByRole("combobox", { name: "Local do consumo", exact: true })
    .selectOption(location.id);
  await page
    .getByRole("combobox", { name: "Produto consumido 1", exact: true })
    .selectOption(product.id);
  await expect(page.getByRole("combobox", { name: "Lote consumido 1", exact: true })).toHaveValue(
    earliest.lotId,
  );
  await page.getByLabel("Quantidade consumida 1", { exact: true }).fill("2.125");
  await page.getByRole("button", { name: "Adicionar produto", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Produto consumido 2", exact: true })
    .selectOption(second.id);
  await page.getByLabel("Quantidade consumida 2", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "Confirmar aplicação", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`Aplicação ${reference} concluída`);
  const after = (await (await page.request.get("/api/v1/inventory/stock")).json())
    .data as InventoryPosition[];
  expect(after.find((row) => row.id === earliest.id)?.quantity).toBe(0.875);
  expect(after.find((row) => row.lot === laterLot)?.quantity).toBe(3);
  expect(after.find((row) => row.id === secondPosition.id)?.quantity).toBe(
    secondPosition.quantity - 0.5,
  );
  await page.getByRole("link", { name: "Ver aplicações", exact: true }).click();
  await expect(page.getByText(reference, { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel("Buscar aplicações", { exact: true }).fill(reference);
  await expect(page.getByRole("cell", { name: "Paciente A.", exact: true })).toBeVisible();
  await expect(
    page.getByText(`Material C · ${firstLot} · 2.125 un`, { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/oi-application-e2e.png", fullPage: true });
  await page.goto("/estoque/movimentacoes");
  await page.getByLabel("Buscar movimentações", { exact: true }).fill(reference);
  await expect(page.getByRole("cell", { name: reference, exact: true })).toHaveCount(2);
  const history = await page.request.get(
    `/api/v1/inventory/movements?search=${encodeURIComponent(reference)}`,
  );
  const movements = (await history.json()).data as {
    applicationId: string;
    type: string;
    quantity: number;
  }[];
  expect(movements).toHaveLength(2);
  expect(
    movements.every((row) => Boolean(row.applicationId) && row.type === "OUT" && row.quantity < 0),
  ).toBe(true);
  expect(errors).toEqual([]);
});
