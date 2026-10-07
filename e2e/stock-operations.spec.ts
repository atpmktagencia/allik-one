import { test, expect } from "@playwright/test";
import type { InventoryPosition } from "../src/data/inventory-api";

test("transfer and physical count persist with paired history and reasons", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/estoque/acesso");
  await page.getByLabel("Senha").fill(process.env["INVENTORY_PREVIEW_PASSWORD"] ?? "");
  await page.getByRole("button", { name: "Acessar estoque", exact: true }).click();
  await expect(page).toHaveURL(/\/estoque$/);
  const original = (await (await page.request.get("/api/v1/inventory/stock")).json())
    .data as InventoryPosition[];
  const source = original.find(
    (row) =>
      row.name === "Material C" &&
      row.location === "Almoxarifado" &&
      row.status === "AVAILABLE" &&
      row.quantity > 3,
  )!;
  expect(source).toBeTruthy();
  const locations = (await (await page.request.get("/api/v1/inventory/locations")).json()).data as {
    id: string;
    name: string;
  }[];
  const destination = locations.find((row) => row.name === "Allik Fortaleza")!;
  const reference = `TR-E2E-${Date.now()}`;
  const countReference = `CT-E2E-${Date.now()}`;
  await page.goto("/estoque/movimentacoes");
  await page
    .getByRole("combobox", { name: "Posição de origem", exact: true })
    .selectOption(source.id);
  await page
    .getByRole("combobox", { name: "Local de destino", exact: true })
    .selectOption(destination.id);
  await page.getByLabel("Quantidade a transferir", { exact: true }).fill("2.125");
  await page.getByLabel("Referência da transferência", { exact: true }).fill(reference);
  await page
    .getByLabel("Motivo da transferência", { exact: true })
    .fill("Reposição sintética da unidade Fortaleza");
  await page.getByRole("button", { name: "Confirmar transferência", exact: true }).click();
  await expect(
    page.getByText("Transferência registrada. Os saldos e o histórico foram atualizados.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: reference, exact: true })).toHaveCount(2);
  await expect(
    page.getByRole("cell", { name: "Almoxarifado → Allik Fortaleza", exact: true }),
  ).toHaveCount(2);
  const transferred = (await (await page.request.get("/api/v1/inventory/stock")).json())
    .data as InventoryPosition[];
  const received = transferred.find(
    (row) => row.lotId === source.lotId && row.locationId === destination.id,
  )!;
  expect(received.quantity).toBe(2.125);
  expect(transferred.find((row) => row.id === source.id)?.quantity).toBe(source.quantity - 2.125);
  await page
    .getByRole("combobox", { name: "Posição para contagem", exact: true })
    .selectOption(received.id);
  await page.getByLabel("Quantidade contada", { exact: true }).fill("1.125");
  await page.getByLabel("Referência da contagem", { exact: true }).fill(countReference);
  await page
    .getByLabel("Motivo do ajuste", { exact: true })
    .fill("Diferença sintética identificada na contagem");
  await page.getByRole("button", { name: "Confirmar ajuste", exact: true }).click();
  await expect(
    page.getByText("Ajuste registrado. O saldo e o histórico foram atualizados.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("cell", { name: countReference, exact: true })).toHaveCount(1);
  await expect(
    page.getByRole("cell", { name: "Diferença sintética identificada na contagem", exact: true }),
  ).toBeVisible();
  const counted = (await (await page.request.get("/api/v1/inventory/stock")).json())
    .data as InventoryPosition[];
  expect(counted.find((row) => row.id === received.id)?.quantity).toBe(1.125);
  await page
    .getByRole("combobox", { name: "Filtrar tipo", exact: true })
    .selectOption("ADJUSTMENT");
  await expect(page.getByRole("cell", { name: reference, exact: true })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: countReference, exact: true })).toHaveCount(1);
  await page.screenshot({ path: "/tmp/oi-stock-operations-e2e.png", fullPage: true });
  expect(errors).toEqual([]);
});
