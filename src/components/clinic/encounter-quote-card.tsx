import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";

type PrescriptionItem = {
  id: string;
  productId: string | null;
  medicationName: string;
  doseQuantity: number;
  doseUnit: string;
  plannedAdministrations: number | null;
};

type PricingOption = {
  id: string;
  presentationId: string;
  name: string;
  doseQuantity: string;
  salePrice: string;
  materialCost: string;
  productId: string | null;
  presentationName: string;
  baseUnit: string;
  totalBaseQuantity: string;
  acquisitionCost: string;
  additionalPresentationCost: string;
  technicalLossPercent: string;
};

type QuoteItem = {
  prescriptionItemId: string;
  pricingDoseId: string;
  pricingDoseName: string;
  presentationName: string;
  quantity: number;
  unitSalePrice: number;
  unitEstimatedCost: number;
  subtotalSale: number;
  subtotalEstimatedCost: number;
};

type Payload = {
  prescription: null | { id: string; items: PrescriptionItem[]; status: "DRAFT" | "FINAL" };
  quote: null | {
    id: string;
    items: QuoteItem[];
    commercialNotes: string;
    totalSale: string;
    estimatedCost: string;
    grossResult: string;
    status: "DRAFT" | "ISSUED";
    version: number;
    issuedAt: string | null;
  };
  pricingOptions: PricingOption[];
  canManage: boolean;
};

type Selection = { prescriptionItemId: string; pricingDoseId: string; quantity: number };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function matches(item: PrescriptionItem, option: PricingOption) {
  return (
    Boolean(item.productId) &&
    item.productId === option.productId &&
    item.doseUnit.toUpperCase() === option.baseUnit &&
    Math.abs(Number(item.doseQuantity) - Number(option.doseQuantity)) < 0.0000001
  );
}

function estimate(option: PricingOption, quantity: number) {
  const usable = Number(option.totalBaseQuantity) * (1 - Number(option.technicalLossPercent) / 100);
  const medication =
    usable > 0
      ? ((Number(option.acquisitionCost) + Number(option.additionalPresentationCost)) / usable) *
        Number(option.doseQuantity)
      : 0;
  const unitCost = medication + Number(option.materialCost);
  return {
    sale: Number(option.salePrice) * quantity,
    cost: unitCost * quantity,
  };
}

export function EncounterQuoteCard({ appointmentId }: { appointmentId: string }) {
  const query = useInventory<Payload>(`encounter-quotes?appointmentId=${appointmentId}`);
  const [loadedId, setLoadedId] = useState<string | null | undefined>(undefined);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [commercialNotes, setCommercialNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const loaded = query.data?.quote;

  useEffect(() => {
    if (!query.data || loadedId === (loaded?.id ?? null)) return;
    setLoadedId(loaded?.id ?? null);
    setCommercialNotes(loaded?.commercialNotes ?? "");
    if (loaded) {
      setSelections(
        loaded.items.map((item) => ({
          prescriptionItemId: item.prescriptionItemId,
          pricingDoseId: item.pricingDoseId,
          quantity: item.quantity,
        })),
      );
    } else {
      setSelections(
        (query.data.prescription?.items ?? []).flatMap((item) => {
          const option = query.data!.pricingOptions.find((candidate) => matches(item, candidate));
          return option
            ? [
                {
                  prescriptionItemId: item.id,
                  pricingDoseId: option.id,
                  quantity: item.plannedAdministrations ?? 1,
                },
              ]
            : [];
        }),
      );
    }
  }, [loaded, loadedId, query.data]);

  const preview = useMemo(
    () =>
      selections.reduce(
        (total, selection) => {
          const option = query.data?.pricingOptions.find(
            ({ id }) => id === selection.pricingDoseId,
          );
          if (!option) return total;
          const value = estimate(option, selection.quantity);
          return { sale: total.sale + value.sale, cost: total.cost + value.cost };
        },
        { sale: 0, cost: 0 },
      ),
    [query.data?.pricingOptions, selections],
  );

  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  if (!data.prescription || data.prescription.status !== "FINAL")
    return (
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Orçamento do tratamento</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Finalize a prescrição para montar o orçamento com valores validados.
        </p>
      </section>
    );

  const issued = data.quote?.status === "ISSUED";
  const complete = selections.length === data.prescription.items.length;

  function updateSelection(item: PrescriptionItem, values: Partial<Selection>) {
    setSelections((current) => {
      const found = current.find(({ prescriptionItemId }) => prescriptionItemId === item.id);
      return found
        ? current.map((selection) =>
            selection.prescriptionItemId === item.id ? { ...selection, ...values } : selection,
          )
        : [
            ...current,
            {
              prescriptionItemId: item.id,
              pricingDoseId: values.pricingDoseId ?? "",
              quantity: values.quantity ?? item.plannedAdministrations ?? 1,
            },
          ];
    });
  }

  async function save(action: "SAVE_DRAFT" | "ISSUE") {
    if (
      action === "ISSUE" &&
      !window.confirm("Emitir este orçamento? Depois disso ele será imutável.")
    )
      return;
    setPending(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/v1/inventory/encounter-quotes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          appointmentId,
          selections: selections.filter(({ pricingDoseId }) => pricingDoseId),
          commercialNotes,
          version: data.quote?.version ?? null,
        }),
      });
      const contentType = response.headers.get("content-type") ?? "";
      const result = contentType.includes("application/json")
        ? ((await response.json()) as { error?: string })
        : { error: "O servidor devolveu uma resposta inválida. Tente novamente." };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar o orçamento.");
      await query.refetch();
      setMessage(action === "ISSUE" ? "Orçamento emitido." : "Rascunho do orçamento salvo.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Orçamento do tratamento</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Registro comercial separado da prescrição. Não reserva nem baixa estoque.
          </p>
        </div>
        <Badge variant="outline">{issued ? "Emitido" : data.quote ? "Rascunho" : "Novo"}</Badge>
      </div>
      {(message || error) && (
        <div role={error ? "alert" : "status"} className="rounded-lg border px-4 py-3 text-sm">
          {error || message}
        </div>
      )}
      <div className="space-y-3">
        {data.prescription.items.map((item) => {
          const options = data.pricingOptions.filter((option) => matches(item, option));
          const selection = selections.find(
            ({ prescriptionItemId }) => prescriptionItemId === item.id,
          );
          const saved = data.quote?.items.find(
            ({ prescriptionItemId }) => prescriptionItemId === item.id,
          );
          return (
            <div
              key={item.id}
              className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1.4fr_1fr_8rem]"
            >
              <div>
                <p className="font-medium">{item.medicationName}</p>
                <p className="text-xs text-muted-foreground">
                  {item.doseQuantity} {item.doseUnit} ·{" "}
                  {item.plannedAdministrations ?? "quantidade a definir"} aplicação(ões)
                </p>
              </div>
              {issued ? (
                <div className="text-sm">
                  <p>
                    {saved?.presentationName} · {saved?.pricingDoseName}
                  </p>
                  <p className="text-muted-foreground">
                    {money.format(saved?.unitSalePrice ?? 0)} por aplicação
                  </p>
                </div>
              ) : options.length ? (
                <label className="space-y-1 text-xs font-medium">
                  Precificação validada
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
                    disabled={!data.canManage}
                    value={selection?.pricingDoseId ?? ""}
                    onChange={(event) =>
                      updateSelection(item, { pricingDoseId: event.target.value })
                    }
                  >
                    <option value="">Selecione</option>
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.presentationName} · {option.name} ·{" "}
                        {money.format(Number(option.salePrice))}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-sm text-destructive">
                  Sem precificação validada exatamente para esta dose.
                </p>
              )}
              <label className="space-y-1 text-xs font-medium">
                Quantidade
                <Input
                  type="number"
                  min="1"
                  max="1000"
                  disabled={issued || !data.canManage || !options.length}
                  value={selection?.quantity ?? item.plannedAdministrations ?? 1}
                  onChange={(event) =>
                    updateSelection(item, { quantity: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          );
        })}
      </div>
      <div className="grid gap-3 rounded-lg bg-muted p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Valor ao paciente</p>
          <p className="text-lg font-semibold">
            {money.format(issued ? Number(data.quote?.totalSale) : preview.sale)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Custo estimado</p>
          <p className="text-lg font-semibold">
            {money.format(issued ? Number(data.quote?.estimatedCost) : preview.cost)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Resultado bruto estimado</p>
          <p className="text-lg font-semibold">
            {money.format(issued ? Number(data.quote?.grossResult) : preview.sale - preview.cost)}
          </p>
        </div>
      </div>
      <label className="block space-y-1 text-sm font-medium">
        Observações comerciais
        <Textarea
          rows={3}
          maxLength={3000}
          disabled={issued || !data.canManage}
          value={commercialNotes}
          onChange={(event) => setCommercialNotes(event.target.value)}
        />
      </label>
      {!issued && data.canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending} onClick={() => save("SAVE_DRAFT")}>
            Salvar rascunho
          </Button>
          <Button disabled={pending || !complete} onClick={() => save("ISSUE")}>
            Emitir orçamento
          </Button>
          {!complete ? (
            <p className="w-full text-xs text-muted-foreground">
              Para emitir, todos os itens precisam de uma precificação validada com produto, unidade
              e dose correspondentes.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
