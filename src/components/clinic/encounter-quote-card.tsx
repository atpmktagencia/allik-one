import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";

type PrescriptionItem = {
  id: string;
  productId: string | null;
  medicationName?: string | undefined;
  doseQuantity?: number | undefined;
  doseUnit?: string | undefined;
  plannedAdministrations: number | null;
  presentationName?: string;
};

type PricingOption = {
  id: string;
  presentationId: string;
  name: string;
  doseQuantity: string;
  salePrice: string;
  materialCost?: string;
  productId: string | null;
  presentationName: string;
  baseUnit: string;
  totalBaseQuantity?: string;
  acquisitionCost?: string;
  additionalPresentationCost?: string;
  technicalLossPercent?: string;
};

type QuoteItem = {
  prescriptionItemId: string;
  productId: string | null;
  medicationName?: string | undefined;
  doseQuantity?: number | undefined;
  doseUnit?: string | undefined;
  pricingDoseId: string;
  pricingDoseName?: string;
  presentationName: string;
  quantity: number;
  unitSalePrice: number;
  unitEstimatedCost?: number;
  subtotalSale: number;
  subtotalEstimatedCost?: number;
};

type Activation = {
  quoteId: string;
  patientId: string;
  unitId: string;
  firstScheduledOn: string;
  activated: boolean;
  items: {
    prescriptionItemId: string;
    medicationName: string;
    doseQuantity: number;
    doseUnit: string;
    route: string;
    quantity: number;
    dates: string[];
  }[];
};

type Payload = {
  prescription: null | { id: string; items: PrescriptionItem[]; status: "DRAFT" | "FINAL" };
  quote: null | {
    id: string;
    items: QuoteItem[];
    commercialNotes: string;
    totalSale: string;
    estimatedCost?: string;
    grossResult?: string;
    status: "DRAFT" | "ISSUED" | "APPROVED" | "DECLINED" | "PAID";
    version: number;
    issuedAt: string | null;
    approvedAt: string | null;
    declinedAt: string | null;
    paidAt: string | null;
    paymentMethod: string | null;
    paymentReference: string | null;
  };
  pricingOptions: PricingOption[];
  canReadCosts?: boolean;
  canReadClinical?: boolean;
  canManage: boolean;
  canApprove: boolean;
  canDecline: boolean;
  canRegisterPayment: boolean;
  canActivate?: boolean;
  activation?: Activation | null;
};

type Selection = { prescriptionItemId: string; pricingDoseId: string; quantity: number };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const statusLabels = {
  DRAFT: "Rascunho",
  ISSUED: "Emitido · aguardando decisão",
  APPROVED: "Aprovado · aguardando pagamento",
  DECLINED: "Recusado",
  PAID: "Pago",
};
const paymentMethods = {
  PIX: "Pix",
  CASH: "Dinheiro",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  BANK_TRANSFER: "Transferência bancária",
  OTHER: "Outro",
};

function matches(item: PrescriptionItem, option: PricingOption) {
  return (
    Boolean(item.productId) &&
    item.productId === option.productId &&
    item.doseUnit?.toUpperCase() === option.baseUnit &&
    Math.abs(Number(item.doseQuantity) - Number(option.doseQuantity)) < 0.0000001
  );
}

function estimate(option: PricingOption, quantity: number): number | null {
  if (
    [
      option.totalBaseQuantity,
      option.technicalLossPercent,
      option.acquisitionCost,
      option.additionalPresentationCost,
      option.materialCost,
    ].some((value) => value === undefined || !Number.isFinite(Number(value)))
  )
    return null;
  const usable = Number(option.totalBaseQuantity) * (1 - Number(option.technicalLossPercent) / 100);
  const medication =
    usable > 0
      ? ((Number(option.acquisitionCost) + Number(option.additionalPresentationCost)) / usable) *
        Number(option.doseQuantity)
      : 0;
  const unitCost = medication + Number(option.materialCost);
  return unitCost * quantity;
}

export function EncounterQuoteCard({ appointmentId }: { appointmentId: string }) {
  const query = useInventory<Payload>(`encounter-quotes?appointmentId=${appointmentId}`);
  const [loadedId, setLoadedId] = useState<string | null | undefined>(undefined);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [commercialNotes, setCommercialNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("PIX");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentReason, setPaymentReason] = useState("");
  const [firstScheduledOn, setFirstScheduledOn] = useState("");
  const [activationReason, setActivationReason] = useState("");
  const [activationPreview, setActivationPreview] = useState<{
    activation: Activation;
    version: number;
  } | null>(null);
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
          const cost =
            query.data?.canReadCosts === true ? estimate(option, selection.quantity) : null;
          return {
            sale: total.sale + Number(option.salePrice) * selection.quantity,
            cost: total.cost === null || cost === null ? null : total.cost + cost,
          };
        },
        { sale: 0, cost: query.data?.canReadCosts === true ? (0 as number | null) : null },
      ),
    [query.data?.pricingOptions, query.data?.canReadCosts, selections],
  );

  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  const canReadCosts = data.canReadCosts === true;
  const canReadClinical = data.canReadClinical === true;
  if (!data.quote && (!data.prescription || data.prescription.status !== "FINAL"))
    return (
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Orçamento do tratamento</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {canReadClinical
            ? "Finalize a prescrição para montar o orçamento com valores validados."
            : "Nenhum orçamento comercial disponível para este atendimento."}
        </p>
      </section>
    );

  const issued = Boolean(data.quote && data.quote.status !== "DRAFT");
  const displayedItems: PrescriptionItem[] =
    issued || !data.prescription || !canReadClinical
      ? (data.quote?.items ?? []).map((item) => ({
          id: item.prescriptionItemId,
          productId: item.productId,
          medicationName: item.medicationName,
          doseQuantity: item.doseQuantity,
          doseUnit: item.doseUnit,
          plannedAdministrations: item.quantity,
          presentationName: item.presentationName,
        }))
      : data.prescription.items;
  const complete =
    canReadClinical &&
    Boolean(data.prescription?.items.length) &&
    displayedItems.every((item) => {
      const selection = selections.find(({ prescriptionItemId }) => prescriptionItemId === item.id);
      return Boolean(
        selection &&
        Number.isInteger(selection.quantity) &&
        selection.quantity >= 1 &&
        selection.quantity <= 1000 &&
        data.pricingOptions.some(
          (option) => option.id === selection.pricingDoseId && matches(item, option),
        ),
      );
    });

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
    if (!data.canManage || !canReadClinical || pending) return;
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
      await readInventoryResponse(response, "Não foi possível salvar o orçamento.");
      await query.refetch();
      setMessage(action === "ISSUE" ? "Orçamento emitido." : "Rascunho do orçamento salvo.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }

  async function transition(action: "APPROVE" | "DECLINE" | "REGISTER_PAYMENT") {
    if (
      !data.quote ||
      pending ||
      (action === "APPROVE" && !data.canApprove) ||
      (action === "DECLINE" && !data.canDecline) ||
      (action === "REGISTER_PAYMENT" && !data.canRegisterPayment)
    )
      return;
    if (action === "REGISTER_PAYMENT" && (!paymentDate || !paymentReason.trim())) {
      setError("Informe a data do pagamento e o motivo do registro manual.");
      return;
    }
    const confirmation =
      action === "APPROVE"
        ? "Registrar a aprovação do paciente para este orçamento?"
        : action === "DECLINE"
          ? "Registrar a recusa deste orçamento?"
          : "Confirmar o pagamento integral informado? Este registro é manual e não verifica a transação bancária.";
    if (!window.confirm(confirmation)) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/inventory/encounter-quotes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          appointmentId,
          version: data.quote.version,
          ...(action === "REGISTER_PAYMENT"
            ? {
                payment: {
                  method: paymentMethod,
                  paidAt: new Date(paymentDate).toISOString(),
                  reference: paymentReference.trim(),
                  reason: paymentReason.trim(),
                },
              }
            : {}),
        }),
      });
      await readInventoryResponse(response, "Não foi possível atualizar o orçamento.");
      await query.refetch();
      setMessage(
        action === "APPROVE"
          ? "Aprovação do paciente registrada."
          : action === "DECLINE"
            ? "Recusa do orçamento registrada."
            : "Pagamento registrado. Nenhuma aplicação foi agendada automaticamente.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }

  async function activate(action: "PREVIEW_ACTIVATION" | "ACTIVATE_PLAN") {
    if (!data.quote || pending || !data.canActivate || !canReadClinical) return;
    if (!firstScheduledOn || activationReason.trim().length < 10) {
      setError("Informe a primeira data e um motivo com pelo menos 10 caracteres.");
      return;
    }
    if (action === "ACTIVATE_PLAN") {
      if (!activationPreview || activationPreview.version !== data.quote.version) {
        setActivationPreview(null);
        setError("Confira novamente as datas antes de ativar o plano.");
        return;
      }
      if (
        !window.confirm(
          "Ativar o plano terapêutico com as datas conferidas? As aplicações ficarão previstas; confirme os horários com a equipe.",
        )
      )
        return;
    }
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/inventory/encounter-quotes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          appointmentId,
          version: data.quote.version,
          firstScheduledOn,
          reason: activationReason.trim(),
        }),
      });
      const result = await readInventoryResponse<{ activation: Activation }>(
        response,
        "Não foi possível preparar o plano terapêutico.",
      );
      if (!result.data?.activation)
        throw new Error("O servidor não retornou as datas do plano. Tente novamente.");
      if (action === "PREVIEW_ACTIVATION") {
        setActivationPreview({ activation: result.data.activation, version: data.quote.version });
        setMessage("Datas previstas geradas. Confira cada aplicação antes de confirmar.");
      } else {
        setActivationPreview(null);
        await query.refetch();
        setMessage(
          "Plano terapêutico ativado. As aplicações estão previstas para conferência da equipe.",
        );
      }
    } catch (cause) {
      setActivationPreview(null);
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
        <Badge variant="outline">{data.quote ? statusLabels[data.quote.status] : "Novo"}</Badge>
      </div>
      {(message || error) && (
        <div role={error ? "alert" : "status"} className="rounded-lg border px-4 py-3 text-sm">
          {error || message}
        </div>
      )}
      {pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Atualizando orçamento…
        </p>
      ) : null}
      {data.quote?.approvedAt || data.quote?.declinedAt ? (
        <p className="text-sm text-muted-foreground">
          {data.quote.declinedAt ? "Recusa registrada" : "Aprovação registrada"} em{" "}
          {new Date(data.quote.declinedAt ?? data.quote.approvedAt!).toLocaleString("pt-BR")}
        </p>
      ) : null}
      <div className="space-y-3">
        {displayedItems.map((item) => {
          const options = canReadClinical
            ? data.pricingOptions.filter((option) => matches(item, option))
            : [];
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
                <p className="font-medium">
                  {canReadClinical
                    ? (item.medicationName ?? item.presentationName ?? "Item do orçamento")
                    : (item.presentationName ?? "Item do orçamento")}
                </p>
                {canReadClinical ? (
                  <p className="text-xs text-muted-foreground">
                    {item.doseQuantity} {item.doseUnit} ·{" "}
                    {item.plannedAdministrations ?? "quantidade a definir"} aplicação(ões)
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {item.plannedAdministrations ?? "Quantidade não informada"} unidade(s) orçada(s)
                  </p>
                )}
              </div>
              {issued || !canReadClinical ? (
                <div className="text-sm">
                  <p>
                    {saved?.presentationName}
                    {canReadClinical && saved?.pricingDoseName ? ` · ${saved.pricingDoseName}` : ""}
                  </p>
                  <p className="text-muted-foreground">
                    {money.format(saved?.unitSalePrice ?? 0)}{" "}
                    {canReadClinical ? "por aplicação" : "por unidade"}
                  </p>
                </div>
              ) : options.length ? (
                <label className="space-y-1 text-xs font-medium">
                  Precificação validada
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
                    disabled={pending || !data.canManage}
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
                  disabled={
                    pending || issued || !data.canManage || !canReadClinical || !options.length
                  }
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
            {money.format(
              issued || !canReadClinical ? Number(data.quote?.totalSale ?? 0) : preview.sale,
            )}
          </p>
        </div>
        {canReadCosts && (
          <>
            <div>
              <p className="text-xs text-muted-foreground">Custo estimado</p>
              <p className="text-lg font-semibold">
                {issued
                  ? data.quote?.estimatedCost !== undefined
                    ? money.format(Number(data.quote.estimatedCost))
                    : "Indisponível"
                  : preview.cost !== null
                    ? money.format(preview.cost)
                    : "Indisponível"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Resultado bruto estimado</p>
              <p className="text-lg font-semibold">
                {issued
                  ? data.quote?.grossResult !== undefined
                    ? money.format(Number(data.quote.grossResult))
                    : "Indisponível"
                  : preview.cost !== null
                    ? money.format(preview.sale - preview.cost)
                    : "Indisponível"}
              </p>
            </div>
          </>
        )}
      </div>
      <label className="block space-y-1 text-sm font-medium">
        Observações comerciais
        <Textarea
          rows={3}
          maxLength={3000}
          disabled={pending || issued || !data.canManage}
          value={commercialNotes}
          onChange={(event) => setCommercialNotes(event.target.value)}
        />
      </label>
      {!issued && data.canManage && canReadClinical ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending} onClick={() => save("SAVE_DRAFT")}>
            {pending ? "Salvando…" : "Salvar rascunho"}
          </Button>
          <Button disabled={pending || !complete} onClick={() => save("ISSUE")}>
            {pending ? "Emitindo…" : "Emitir orçamento"}
          </Button>
          {!complete ? (
            <p className="w-full text-xs text-muted-foreground">
              Para emitir, todos os itens precisam de uma precificação validada com produto, unidade
              e dose correspondentes.
            </p>
          ) : null}
        </div>
      ) : null}
      {data.quote?.status === "ISSUED" && (data.canApprove || data.canDecline) ? (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            Registre a decisão após a confirmação do paciente.
          </p>
          <div className="flex flex-wrap gap-2">
            {data.canApprove && (
              <Button disabled={pending} onClick={() => transition("APPROVE")}>
                Registrar aprovação
              </Button>
            )}
            {data.canDecline && (
              <Button variant="outline" disabled={pending} onClick={() => transition("DECLINE")}>
                Registrar recusa
              </Button>
            )}
          </div>
        </div>
      ) : null}
      {data.quote?.status === "APPROVED" && data.canRegisterPayment ? (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Registrar pagamento integral</h3>
          <p className="text-xs text-muted-foreground">
            Valor: {money.format(Number(data.quote.totalSale))}. Confirme o recebimento antes de
            registrar.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              Forma de pagamento
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                disabled={pending}
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
              >
                {Object.entries(paymentMethods).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              Data e hora do pagamento
              <Input
                type="datetime-local"
                required
                disabled={pending}
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              Referência ou comprovante (opcional)
              <Input
                maxLength={200}
                disabled={pending}
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              Motivo do registro manual
              <Input
                required
                maxLength={1000}
                disabled={pending}
                value={paymentReason}
                onChange={(event) => setPaymentReason(event.target.value)}
                placeholder="Ex.: recebimento confirmado pela recepção"
              />
            </label>
          </div>
          <Button
            disabled={pending || !paymentDate || !paymentReason.trim()}
            onClick={() => transition("REGISTER_PAYMENT")}
          >
            {pending ? "Registrando…" : "Confirmar pagamento"}
          </Button>
        </div>
      ) : null}
      {data.quote?.paidAt ? (
        <p className="text-sm text-muted-foreground">
          Pagamento registrado em {new Date(data.quote.paidAt).toLocaleString("pt-BR")} ·{" "}
          {paymentMethods[data.quote.paymentMethod as keyof typeof paymentMethods] ??
            data.quote.paymentMethod}
          {data.quote.paymentReference ? ` · Referência: ${data.quote.paymentReference}` : ""}
        </p>
      ) : null}
      {canReadClinical && data.activation?.activated ? (
        <div className="space-y-2 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Plano terapêutico ativo</h3>
          <p className="text-sm text-muted-foreground">
            {data.activation.items.reduce((total, item) => total + item.dates.length, 0)} aplicações
            previstas a partir de{" "}
            {new Date(`${data.activation.firstScheduledOn}T12:00:00`).toLocaleDateString("pt-BR")}.
          </p>
          <a
            className="inline-block text-sm font-medium underline underline-offset-4"
            href={`/pacientes/${data.activation.patientId}`}
          >
            Abrir plano terapêutico do paciente
          </a>
        </div>
      ) : canReadClinical && data.quote?.status === "PAID" && data.canActivate ? (
        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <h3 className="text-sm font-semibold">Programar plano terapêutico</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Escolha a primeira data para calcular a cadência prescrita. As datas são previstas;
              horário, profissional e disponibilidade serão conferidos pela equipe. Não reserva nem
              baixa estoque.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              Data da primeira aplicação
              <Input
                type="date"
                required
                disabled={pending}
                value={firstScheduledOn}
                onChange={(event) => {
                  setFirstScheduledOn(event.target.value);
                  setActivationPreview(null);
                  setMessage("");
                }}
              />
            </label>
            <label className="space-y-1 text-sm">
              Motivo da programação
              <Input
                required
                minLength={10}
                maxLength={500}
                disabled={pending}
                value={activationReason}
                placeholder="Ex.: datas acordadas com o paciente"
                onChange={(event) => {
                  setActivationReason(event.target.value);
                  setActivationPreview(null);
                  setMessage("");
                }}
              />
            </label>
          </div>
          <Button
            variant="outline"
            disabled={pending || !firstScheduledOn || activationReason.trim().length < 10}
            onClick={() => activate("PREVIEW_ACTIVATION")}
          >
            {pending ? "Processando…" : "Conferir datas previstas"}
          </Button>
          {activationPreview && activationPreview.version === data.quote.version ? (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Confira a programação antes de ativar</h4>
              {activationPreview.activation.items.map((item) => (
                <div key={item.prescriptionItemId} className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm font-medium">
                    {item.medicationName} · {item.doseQuantity} {item.doseUnit} · {item.route}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.dates.length} aplicações previstas
                  </p>
                  <ol
                    aria-label={`Datas previstas para ${item.medicationName}`}
                    className="flex max-h-48 flex-wrap gap-2 overflow-y-auto text-xs"
                  >
                    {item.dates.map((date, index) => (
                      <li key={`${date}-${index}`} className="rounded-md bg-muted px-2 py-1">
                        {index + 1}. {new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR")}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
              <Button disabled={pending} onClick={() => activate("ACTIVATE_PLAN")}>
                {pending ? "Ativando…" : "Confirmar e ativar plano"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
