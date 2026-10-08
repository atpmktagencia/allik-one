import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { PageHeader } from "./page-kit";

type Calculation = {
  dosesPerPresentation: number;
  probableRemainder: string;
  doseVolumeMl: string | null;
  measurable: boolean | null;
  costPerDose: string;
  marginPerDose: string;
};
type Dose = {
  id: string;
  name: string;
  doseQuantity: string;
  salePrice: string;
  calculation: Calculation;
};
type Presentation = {
  id: string;
  name: string;
  baseUnit: string;
  totalBaseQuantity: string;
  totalVolumeMl: string | null;
  concentrationPerMl: string | null;
  acquisitionCost: string;
  technicalLossPercent: string;
  minimumMeasurableVolumeMl: string | null;
  beyondUseHours: number | null;
  doses: Dose[];
};
type Payload = {
  presentations: Presentation[];
  products: Array<{ id: string; name: string; sku: string }>;
  legacyPrices: Array<{ id: string; name: string; route: string; supplier: string; price: string }>;
  canManage: boolean;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = (value: string) => Number(value.replace(",", "."));
const presentationBlank = {
  productId: "",
  name: "",
  baseUnit: "MG",
  totalBaseQuantity: "",
  totalVolumeMl: "",
  acquisitionCost: "",
  technicalLossPercent: "0",
  additionalPresentationCost: "0",
  minimumMeasurableVolumeMl: "",
  beyondUseHours: "",
  reason: "Cadastro inicial da apresentação comercial.",
};
const doseBlank = {
  presentationId: "",
  name: "",
  doseQuantity: "",
  salePrice: "",
  materialCost: "0",
  reason: "Cadastro inicial da dose comercializada.",
};

function usePricingWrite(refetch: () => Promise<unknown>) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function write(body: unknown) {
    setPending(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/v1/inventory/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar.");
      setMessage("Precificação salva e auditada.");
      await refetch();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
      return false;
    } finally {
      setPending(false);
    }
  }
  return { pending, message, error, write };
}

export function SalePricesPage() {
  const query = useInventory<Payload>("pricing");
  const [presentation, setPresentation] = useState(presentationBlank);
  const [dose, setDose] = useState(doseBlank);
  const writer = usePricingWrite(() => query.refetch());
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  async function createPresentation(event: FormEvent) {
    event.preventDefault();
    const saved = await writer.write({
      action: "CREATE_PRESENTATION",
      id: crypto.randomUUID(),
      ...presentation,
      productId: presentation.productId || null,
      totalVolumeMl: presentation.totalVolumeMl || null,
      minimumMeasurableVolumeMl: presentation.minimumMeasurableVolumeMl || null,
      beyondUseHours: presentation.beyondUseHours ? Number(presentation.beyondUseHours) : null,
      active: true,
      version: 0,
    });
    if (saved) setPresentation(presentationBlank);
  }
  async function createDose(event: FormEvent) {
    event.preventDefault();
    const saved = await writer.write({
      action: "CREATE_DOSE",
      id: crypto.randomUUID(),
      ...dose,
      active: true,
      version: 0,
    });
    if (saved) setDose(doseBlank);
  }
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Comercial"
        title="Precificação por apresentação e dose"
        description="Calcule rendimento, volume, sobra, custo, margem e segurança de medição antes de oferecer uma dose."
      />
      {data.canManage && (
        <div className="grid gap-5 xl:grid-cols-2">
          <form onSubmit={createPresentation} className="space-y-4 rounded-xl border bg-card p-5">
            <div>
              <h2 className="font-semibold">Nova apresentação</h2>
              <p className="text-sm text-muted-foreground">Ex.: Tirzepatida 20 mg / 0,8 mL.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                aria-label="Nome da apresentação"
                placeholder="Nome da apresentação"
                required
                value={presentation.name}
                onChange={(event) => setPresentation({ ...presentation, name: event.target.value })}
              />
              <select
                aria-label="Produto vinculado"
                className="h-10 rounded-md border bg-background px-3"
                value={presentation.productId}
                onChange={(event) =>
                  setPresentation({ ...presentation, productId: event.target.value })
                }
              >
                <option value="">Sem vínculo com produto</option>
                {data.products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · {product.sku}
                  </option>
                ))}
              </select>
              <Input
                aria-label="Quantidade total"
                inputMode="decimal"
                placeholder="Quantidade total (ex.: 20)"
                required
                value={presentation.totalBaseQuantity}
                onChange={(event) =>
                  setPresentation({ ...presentation, totalBaseQuantity: event.target.value })
                }
              />
              <select
                aria-label="Unidade-base"
                className="h-10 rounded-md border bg-background px-3"
                value={presentation.baseUnit}
                onChange={(event) =>
                  setPresentation({ ...presentation, baseUnit: event.target.value })
                }
              >
                {["MG", "MCG", "G", "ML", "UI", "UNIT"].map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
              <Input
                aria-label="Volume total em mL"
                inputMode="decimal"
                placeholder="Volume total em mL"
                value={presentation.totalVolumeMl}
                onChange={(event) =>
                  setPresentation({ ...presentation, totalVolumeMl: event.target.value })
                }
              />
              <Input
                aria-label="Custo da apresentação"
                inputMode="decimal"
                placeholder="Custo da apresentação"
                required
                value={presentation.acquisitionCost}
                onChange={(event) =>
                  setPresentation({ ...presentation, acquisitionCost: event.target.value })
                }
              />
              <Input
                aria-label="Perda técnica percentual"
                inputMode="decimal"
                placeholder="Perda técnica %"
                required
                value={presentation.technicalLossPercent}
                onChange={(event) =>
                  setPresentation({ ...presentation, technicalLossPercent: event.target.value })
                }
              />
              <Input
                aria-label="Custos adicionais da apresentação"
                inputMode="decimal"
                placeholder="Custos adicionais"
                required
                value={presentation.additionalPresentationCost}
                onChange={(event) =>
                  setPresentation({
                    ...presentation,
                    additionalPresentationCost: event.target.value,
                  })
                }
              />
              <Input
                aria-label="Menor volume mensurável"
                inputMode="decimal"
                placeholder="Menor volume mensurável em mL"
                value={presentation.minimumMeasurableVolumeMl}
                onChange={(event) =>
                  setPresentation({
                    ...presentation,
                    minimumMeasurableVolumeMl: event.target.value,
                  })
                }
              />
              <Input
                aria-label="Uso após abertura em horas"
                inputMode="numeric"
                placeholder="Uso após abertura (horas)"
                value={presentation.beyondUseHours}
                onChange={(event) =>
                  setPresentation({ ...presentation, beyondUseHours: event.target.value })
                }
              />
            </div>
            <Input
              aria-label="Motivo do cadastro da apresentação"
              required
              minLength={10}
              value={presentation.reason}
              onChange={(event) => setPresentation({ ...presentation, reason: event.target.value })}
            />
            <Button disabled={writer.pending}>
              {writer.pending ? "Salvando…" : "Cadastrar apresentação"}
            </Button>
          </form>
          <form onSubmit={createDose} className="space-y-4 rounded-xl border bg-card p-5">
            <div>
              <h2 className="font-semibold">Nova dose comercializada</h2>
              <p className="text-sm text-muted-foreground">
                A unidade da dose é herdada da apresentação.
              </p>
            </div>
            <select
              required
              aria-label="Apresentação da dose"
              className="h-10 w-full rounded-md border bg-background px-3"
              value={dose.presentationId}
              onChange={(event) => setDose({ ...dose, presentationId: event.target.value })}
            >
              <option value="">Selecione a apresentação</option>
              {data.presentations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                aria-label="Nome da dose"
                placeholder="Ex.: Dose 2,5 mg"
                required
                value={dose.name}
                onChange={(event) => setDose({ ...dose, name: event.target.value })}
              />
              <Input
                aria-label="Quantidade da dose"
                inputMode="decimal"
                placeholder="Quantidade da dose"
                required
                value={dose.doseQuantity}
                onChange={(event) => setDose({ ...dose, doseQuantity: event.target.value })}
              />
              <Input
                aria-label="Preço de venda da dose"
                inputMode="decimal"
                placeholder="Preço de venda"
                required
                value={dose.salePrice}
                onChange={(event) => setDose({ ...dose, salePrice: event.target.value })}
              />
              <Input
                aria-label="Materiais por dose"
                inputMode="decimal"
                placeholder="Materiais por dose"
                required
                value={dose.materialCost}
                onChange={(event) => setDose({ ...dose, materialCost: event.target.value })}
              />
            </div>
            <Input
              aria-label="Motivo do cadastro da dose"
              required
              minLength={10}
              value={dose.reason}
              onChange={(event) => setDose({ ...dose, reason: event.target.value })}
            />
            <Button disabled={writer.pending || data.presentations.length === 0}>
              {writer.pending ? "Salvando…" : "Cadastrar dose"}
            </Button>
          </form>
        </div>
      )}
      {writer.message && (
        <p role="status" className="text-sm text-emerald-700">
          {writer.message}
        </p>
      )}
      {writer.error && (
        <p role="alert" className="text-sm text-destructive">
          {writer.error}
        </p>
      )}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Apresentações calculáveis</h2>
          <p className="text-sm text-muted-foreground">
            Nenhuma reserva ou paciente real é criado nesta etapa.
          </p>
        </div>
        {data.presentations.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{item.name}</CardTitle>
                  <CardDescription>
                    {item.totalBaseQuantity} {item.baseUnit}
                    {item.totalVolumeMl
                      ? ` em ${item.totalVolumeMl} mL · ${item.concentrationPerMl} ${item.baseUnit}/mL`
                      : ""}
                  </CardDescription>
                </div>
                <Badge variant="outline">Custo {money.format(number(item.acquisitionCost))}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 text-sm sm:grid-cols-3">
                <p>
                  <span className="text-muted-foreground">Perda técnica:</span>{" "}
                  {number(item.technicalLossPercent)}%
                </p>
                <p>
                  <span className="text-muted-foreground">Medição mínima:</span>{" "}
                  {item.minimumMeasurableVolumeMl
                    ? `${item.minimumMeasurableVolumeMl} mL`
                    : "não informada"}
                </p>
                <p>
                  <span className="text-muted-foreground">Uso após abertura:</span>{" "}
                  {item.beyondUseHours ? `${item.beyondUseHours} h` : "não informado"}
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="p-3">Dose</th>
                      <th className="p-3">Volume</th>
                      <th className="p-3">Rendimento / sobra</th>
                      <th className="p-3">Custo</th>
                      <th className="p-3">Venda</th>
                      <th className="p-3">Margem</th>
                      <th className="p-3">Medição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.doses.map((doseItem) => (
                      <tr key={doseItem.id} className="border-t">
                        <td className="p-3 font-medium">
                          {doseItem.name}
                          <br />
                          <span className="text-xs text-muted-foreground">
                            {doseItem.doseQuantity} {item.baseUnit}
                          </span>
                        </td>
                        <td className="p-3">
                          {doseItem.calculation.doseVolumeMl
                            ? `${doseItem.calculation.doseVolumeMl} mL`
                            : "—"}
                        </td>
                        <td className="p-3">
                          {doseItem.calculation.dosesPerPresentation} doses
                          <br />
                          <span className="text-xs text-muted-foreground">
                            sobra {doseItem.calculation.probableRemainder} {item.baseUnit}
                          </span>
                        </td>
                        <td className="p-3">
                          {money.format(number(doseItem.calculation.costPerDose))}
                        </td>
                        <td className="p-3">{money.format(number(doseItem.salePrice))}</td>
                        <td className="p-3 font-semibold">
                          {money.format(number(doseItem.calculation.marginPerDose))}
                        </td>
                        <td className="p-3">
                          {doseItem.calculation.measurable === null ? (
                            <Badge variant="outline">Não avaliada</Badge>
                          ) : doseItem.calculation.measurable ? (
                            <Badge>Mensurável</Badge>
                          ) : (
                            <Badge variant="destructive">Não mensurável</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                    {item.doses.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-5 text-center text-muted-foreground">
                          Cadastre uma dose para calcular.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))}
        {data.presentations.length === 0 && (
          <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
            Nenhuma apresentação calculável cadastrada.
          </p>
        )}
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Tabela anterior</CardTitle>
          <CardDescription>
            Valores importados que ainda não possuem apresentação e dose estruturadas.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Ativo / protocolo</th>
                  <th className="px-4 py-3">Via</th>
                  <th className="px-4 py-3">Fornecedor</th>
                  <th className="px-6 py-3 text-right">Venda</th>
                </tr>
              </thead>
              <tbody>
                {data.legacyPrices.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-6 py-3 font-medium">{item.name}</td>
                    <td className="px-4 py-3">{item.route}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.supplier}</td>
                    <td className="px-6 py-3 text-right font-semibold">
                      {money.format(number(item.price))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
