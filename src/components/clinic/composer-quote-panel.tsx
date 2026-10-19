import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { PlanQuotePanel } from "./plan-quote-panel";
type PlanOption = {
  id: string;
  title: string;
  version: number;
  status: string;
  unitId: string;
  unitName: string;
  canEstimate: boolean;
  linkedToDocument: boolean;
};
type Options = {
  patientId: string;
  unitId: string;
  unitName: string;
  plans: PlanOption[];
  canReadPlans: boolean;
};
function PlanSelection({
  data,
  selected,
  onSelect,
  refresh,
}: {
  data: Options;
  selected: string;
  onSelect: (id: string) => void;
  refresh: () => void;
}) {
  const id = useId();
  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-teal-950">Planos clínicos salvos</h4>
      <label htmlFor={id} className="block text-sm">
        Plano clínico salvo para estimativa
      </label>
      <select
        id={id}
        className="h-10 w-full min-w-0 rounded-lg border bg-white px-2 text-sm"
        value={selected}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">Selecionar explicitamente um plano</option>
        {data.plans.map((plan) => (
          <option key={plan.id} value={plan.id}>
            {plan.title} · v{plan.version} ·{" "}
            {plan.canEstimate ? "Estimativa permitida" : "Consulta de estimativas"}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        {data.unitName}. Até 25 planos autorizados deste paciente e unidade. A seleção não cria
        vínculo com o documento.
      </p>
      <Button type="button" variant="outline" onClick={refresh}>
        Atualizar planos salvos
      </Button>
      <a
        className="block text-xs text-teal-800 underline underline-offset-4"
        href={`/pacientes/${encodeURIComponent(data.patientId)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Abrir planos do paciente em outra aba
      </a>
    </div>
  );
}
/** Quote context is resolved by the server from the individual appointment/document owner. */
export function ComposerQuotePanel({
  appointmentId,
  documentId,
}: {
  appointmentId: string;
  documentId: string;
}) {
  const query = useInventory<Options>(
    `composer-plan-options?appointmentId=${encodeURIComponent(appointmentId)}&documentId=${encodeURIComponent(documentId)}`,
  );
  const [selected, setSelected] = useState("");
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    function reset() {
      setSelected("");
      setOpened(new Set());
    }
    reset();
    window.addEventListener("inventory-unit-change", reset);
    return () => window.removeEventListener("inventory-unit-change", reset);
  }, [appointmentId, documentId]);
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  if (data.canReadPlans !== true)
    return (
      <p className="rounded-lg border p-4 text-sm">
        Nenhum contexto autorizado para consultar planos salvos deste atendimento.
      </p>
    );
  const choose = (id: string) => {
    setSelected(id);
    if (id) setOpened((previous) => new Set([...previous, id]));
  };
  const selection = (
    <PlanSelection
      data={data}
      selected={selected}
      onSelect={choose}
      refresh={() => void query.refetch()}
    />
  );
  return (
    <section aria-label="Orçamento do plano salvo" className="space-y-4">
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        O orçamento refere-se exclusivamente ao plano clínico salvo que você selecionar. Não utiliza
        a fórmula atual ou alterações não salvas da aba Receita. Não associa o orçamento
        automaticamente ao documento.
      </p>
      <div className="min-w-0 rounded-xl border bg-teal-50/40 p-3">{selection}</div>
      {(!selected || !data.plans.some((plan) => plan.id === selected)) && (
        <p className="rounded-lg border bg-white p-3 text-sm text-muted-foreground">
          Selecione um plano salvo para consultar estimativas ou calcular preços. Nenhum valor é
          inferido da fórmula em edição.
        </p>
      )}
      {data.plans
        .filter((plan) => opened.has(plan.id))
        .map((plan) => (
          <div key={`${plan.id}:${plan.version}`} hidden={selected !== plan.id}>
            <p className="mb-3 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm">
              {plan.linkedToDocument
                ? "Este plano possui uma referência clínica salva a este documento. A referência não inclui alterações atuais da fórmula."
                : "Este plano é independente do documento em edição e não possui referência clínica salva a ele."}{" "}
              O orçamento utiliza apenas a versão salva selecionada.
            </p>
            <PlanQuotePanel
              patientId={data.patientId}
              planId={plan.id}
              expectedPlanVersion={plan.version}
            />
          </div>
        ))}
    </section>
  );
}
