import { test, expect } from "@playwright/test";

test("supplier, partial deliveries, transfer, application, count and complete lot trace", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const suffix = Date.now().toString();
  const supplier = `Fornecedor E2E ${suffix}`;
  const reference = `PO-E2E-${suffix}`;
  await page.goto("/estoque/acesso");
  await page.getByLabel("Senha").fill(process.env["INVENTORY_PREVIEW_PASSWORD"] ?? "");
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
    page.getByRole("status").filter({ hasText: "Recebimento registrado." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Receber ${reference}`, exact: true }),
  ).toBeDisabled();
  await page.goto("/estoque/movimentacoes");
  await expect(page.getByRole("cell", { name: reference, exact: true })).toHaveCount(2);
  await page.screenshot({ path: "/tmp/oi-receiving-e2e.png", fullPage: true });
  const stock = (await (await page.request.get("/api/v1/inventory/stock")).json()).data as {
    id: string;
    lotId: string;
    productId: string;
    lot: string;
    location: string;
    quantity: number;
  }[];
  const source = stock.find(
    (position) => position.lot === `E2E-${suffix}` && position.location === "Allik Fortaleza",
  )!;
  const transferReference = `TR-TRACE-${suffix}`;
  const applicationReference = `AP-TRACE-${suffix}`;
  const countReference = `CT-TRACE-${suffix}`;
  await page
    .getByRole("combobox", { name: "Posição de origem", exact: true })
    .selectOption(source.id);
  await page
    .getByRole("combobox", { name: "Local de destino", exact: true })
    .selectOption({ label: "Sala de Procedimentos" });
  await page.getByLabel("Quantidade a transferir", { exact: true }).fill("4");
  await page.getByLabel("Referência da transferência", { exact: true }).fill(transferReference);
  await page
    .getByLabel("Motivo da transferência", { exact: true })
    .fill("Reposição sintética para procedimento");
  await page.getByRole("button", { name: "Confirmar transferência", exact: true }).click();
  await expect(
    page.getByText("Transferência registrada. Os saldos e o histórico foram atualizados.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/aplicacoes/nova");
  await page
    .getByRole("combobox", { name: "Paciente sintético", exact: true })
    .selectOption("demo-patient-b");
  await page.getByLabel("Referência da aplicação", { exact: true }).fill(applicationReference);
  await page
    .getByLabel("Serviço / procedimento", { exact: true })
    .fill("Procedimento sintético de rastreio");
  await page
    .getByLabel("Profissional executor", { exact: true })
    .fill("Executor sintético de rastreio");
  await page
    .getByRole("combobox", { name: "Local do consumo", exact: true })
    .selectOption({ label: "Sala de Procedimentos" });
  await page
    .getByRole("combobox", { name: "Produto consumido 1", exact: true })
    .selectOption(source.productId);
  await page
    .getByRole("combobox", { name: "Lote consumido 1", exact: true })
    .selectOption(source.lotId);
  await page.getByLabel("Quantidade consumida 1", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Confirmar aplicação", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    `Aplicação ${applicationReference} concluída`,
  );
  const updated = (await (await page.request.get("/api/v1/inventory/stock")).json())
    .data as typeof stock;
  const destination = updated.find(
    (position) => position.lotId === source.lotId && position.location === "Sala de Procedimentos",
  )!;
  await page.goto("/estoque/movimentacoes");
  await page
    .getByRole("combobox", { name: "Posição para contagem", exact: true })
    .selectOption(destination.id);
  await page.getByLabel("Quantidade contada", { exact: true }).fill("2.875");
  await page.getByLabel("Referência da contagem", { exact: true }).fill(countReference);
  await page
    .getByLabel("Motivo do ajuste", { exact: true })
    .fill("Diferença sintética de contagem");
  await page.getByRole("button", { name: "Confirmar ajuste", exact: true }).click();
  await expect(
    page.getByText("Ajuste registrado. O saldo e o histórico foram atualizados.", { exact: true }),
  ).toBeVisible();
  await page.goto("/aplicacoes");
  await page.getByLabel("Buscar aplicações", { exact: true }).fill(applicationReference);
  await page.getByRole("link", { name: `Rastrear lote E2E-${suffix}`, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: `Rastreabilidade do lote E2E-${suffix}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("6 movimentações · 6 registros de auditoria", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(`Recebimento: ${reference}`, { exact: true })).toHaveCount(2);
  await expect(
    page.getByText(`Pedido: ${reference} · Fornecedor: ${supplier}`, { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByText(`Aplicação: ${applicationReference} · Paciente B.`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Transferência: Allik Fortaleza → Sala de Procedimentos", { exact: true }),
  ).toHaveCount(2);
  await expect(page.getByText("8.875 un", { exact: true })).toBeVisible();
  await page.getByText("Auditoria do movimento (1)", { exact: true }).first().click();
  await expect(page.locator("details[open]")).toContainText("preview-operator");
  await page.reload();
  await expect(
    page.getByText("Saldos conferidos com as movimentações registradas.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/oi-lot-trace-e2e.png", fullPage: true });
  await page.goto(`/estoque/produtos/${source.productId}`);
  await expect(
    page.getByRole("link", { name: `Rastrear lote E2E-${suffix}`, exact: true }),
  ).toHaveCount(2);
  expect(errors).toEqual([]);
});
