import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import { withSelectedUnit } from "@/data/unit-context";
import {
  computeTreatmentPlan,
  treatmentPlanSchema,
  treatmentPlanKinds,
  treatmentPlanUnits,
  type TreatmentPlanInput,
  type TreatmentPlanItem,
  type TreatmentPlanStage,
  type ComputedTreatmentPlan,
} from "@/data/treatment-plan";
import { PlanQuotePanel } from "./plan-quote-panel";
import { InventoryState } from "./inventory-state";
type Unit = TreatmentPlanItem["administrationUnit"];
type FormItem = Omit<TreatmentPlanItem, "dispense" | "package"> & {
  dispense: { quantity: string; unit: Unit | "" } | null;
  package: { capacity: string; unit: Unit | "" } | null;
};
type PlanForm = Omit<TreatmentPlanInput, "items"> & { items: FormItem[] };
type Head = {
  id: string;
  patientId: string;
  appointmentId?: string | null;
  unitId: string;
  authorUserId: string;
  title: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  version: number;
  canEdit: boolean;
};
type Targets = {
  products: { id: string; name: string }[];
  catalogItems: { id: string; name: string; kind?: string }[];
  treatments: { id: string; label: string }[];
  appointments: { id: string; label: string }[];
  prescriptionInstances: { id: string; label: string }[];
};
type Payload = { plans: Head[]; canManage: boolean; targets: Targets };
type Editor = {
  id: string;
  version: number | null;
  title: string;
  status: Head["status"];
  plan: PlanForm;
};
const kindNames = {
  PRESCRIPTION: "Prescrição",
  PROCEDURE: "Procedimento",
  CONSULTATION: "Consulta",
  INJECTABLE_SESSION: "Sessão de injetável",
  SERVICE: "Serviço",
  RETURN: "Retorno",
};
const unitNames: Record<string, string> = {
  UNIT: "Unidade",
  CAPSULE: "Cápsula",
  TABLET: "Comprimido",
  ML: "mL",
  G: "g",
  DROP: "Gota",
  SACHET: "Sachê",
  SESSION: "Sessão",
  CONSULTATION: "Consulta",
  PROCEDURE: "Procedimento",
  PACK: "Embalagem",
  VIAL: "Frasco",
  AMPOULE: "Ampola",
  SYRINGE: "Seringa",
};
const statusNames = { DRAFT: "Rascunho", ACTIVE: "Ativo", ARCHIVED: "Arquivado" };
const blankStage = (): TreatmentPlanStage => ({
  doseUnits: null,
  frequencyPerDay: null,
  everyDays: NaN,
  durationDays: NaN,
  weekdays: null,
  times: null,
});
const blankItem = (appointmentId?: string): FormItem => ({
  id: crypto.randomUUID(),
  kind: appointmentId ? "PROCEDURE" : "PRESCRIPTION",
  appointmentId: appointmentId ?? null,
  title: "",
  productId: null,
  catalogItemId: null,
  administrationUnit: null,
  optional: false,
  patientInstructions: "",
  stages: [blankStage()],
  dispense: null,
  package: null,
});
function Select({
  label,
  value,
  onChange,
  children,
  required = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <select
        id={id}
        className="mt-1 h-10 w-full min-w-0 rounded-lg border bg-white px-2 text-sm"
        value={value}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </div>
  );
}
function UnitSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const isCustom = custom || (value !== "" && !treatmentPlanUnits.some((unit) => unit === value));
  return (
    <div className="space-y-1">
      <Select
        label={label}
        value={isCustom ? "_CUSTOM" : value}
        onChange={(unit) => {
          setCustom(unit === "_CUSTOM");
          onChange(unit === "_CUSTOM" ? "" : unit);
        }}
      >
        <option value="">Não informada</option>
        {treatmentPlanUnits.map((unit) => (
          <option key={unit} value={unit}>
            {unitNames[unit] ?? unit}
          </option>
        ))}
        <option value="_CUSTOM">Personalizar unidade…</option>
      </Select>
      {isCustom && (
        <label className="block text-xs">
          {label} personalizada
          <Input maxLength={80} value={value} onChange={(e) => onChange(e.target.value)} />
        </label>
      )}
    </div>
  );
}
export function PatientClinicalPlans({
  patientId,
  appointmentId,
  onDraftStateChange,
}: {
  patientId: string;
  appointmentId?: string | undefined;
  onDraftStateChange?: ((state: { dirty: boolean; pending: boolean }) => void) | undefined;
}) {
  const [open, setOpen] = useState(Boolean(appointmentId));
  const heading = appointmentId ? "Procedimentos do atendimento" : "Plano clínico estruturado";
  return (
    <section
      className="space-y-3 rounded-xl border border-teal-200 bg-white p-5"
      aria-label={heading}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-teal-950">{heading}</h2>
        {!open && (
          <Button variant="outline" onClick={() => setOpen(true)}>
            {appointmentId ? "Abrir procedimentos" : "Abrir plano clínico"}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {appointmentId
          ? "Procedimentos vinculados exclusivamente a este atendimento, com etapas e quantidades informadas."
          : "Planejamento clínico independente, com etapas, calendário e quantidades informadas."}{" "}
        Não emite receita, cobra, reserva ou movimenta estoque.
      </p>
      {open && (
        <Plans
          key={`${patientId}:${appointmentId ?? "independent"}`}
          patientId={patientId}
          appointmentId={appointmentId}
          onDraftStateChange={onDraftStateChange}
        />
      )}
    </section>
  );
}
function Preview({ plan, preview }: { plan: TreatmentPlanInput; preview: ComputedTreatmentPlan }) {
  return (
    <section
      aria-label="Conferência do plano clínico"
      className="space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-4"
    >
      <h3 className="font-semibold">Calendário e quantidades para conferência</h3>
      <p className="text-sm">
        Prévia de {preview.startDate} até {preview.previewThrough}. As datas não são agendamentos.
      </p>
      {preview.warnings.map((warning) => (
        <p key={warning} className="text-xs text-amber-900">
          {warning}
        </p>
      ))}
      {preview.items.map((item) => (
        <div key={item.id} className="space-y-2 rounded-lg border bg-white p-3">
          <h4 className="font-medium">{plan.items.find((entry) => entry.id === item.id)?.title}</h4>
          <p className="text-sm">
            Quantidade prevista de administração: {item.administrationQuantity ?? "Indeterminada"}{" "}
            {plan.items.find((entry) => entry.id === item.id)?.administrationUnit ??
              "(unidade não informada)"}
          </p>
          <p className="text-sm">
            Quantidade a dispensar: {item.dispenseQuantity ?? "Não informada"}{" "}
            {plan.items.find((entry) => entry.id === item.id)?.dispense?.unit ?? ""} · Embalagens
            necessárias:{" "}
            {item.packagesRequired === null
              ? "Não calculadas"
              : `${item.packagesRequired} embalagem(ns)`}
          </p>
          {item.warnings.map((warning) => (
            <p key={warning} className="text-xs text-amber-900">
              {warning}
            </p>
          ))}
          <details>
            <summary className="cursor-pointer text-sm">Ver calendário informado</summary>
            <ol className="mt-2 max-h-52 space-y-1 overflow-y-auto text-xs">
              {item.schedule.map((entry) => (
                <li key={entry.date}>
                  {entry.date} · {entry.administrations ?? "Frequência não informada"}{" "}
                  administração(ões) · {entry.doseUnits ?? "Quantidade não informada"}{" "}
                  {plan.items.find((snapshot) => snapshot.id === item.id)?.administrationUnit ??
                    "(unidade não informada)"}{" "}
                  por administração · {entry.times?.join(", ") ?? "Horários não informados"}
                </li>
              ))}
            </ol>
          </details>
        </div>
      ))}
    </section>
  );
}
function Plans({
  patientId,
  appointmentId,
  onDraftStateChange,
}: {
  patientId: string;
  appointmentId?: string | undefined;
  onDraftStateChange?: ((state: { dirty: boolean; pending: boolean }) => void) | undefined;
}) {
  const query = useInventory<Payload>(
    `patient-treatment-plans?patientId=${encodeURIComponent(patientId)}${appointmentId ? `&appointmentId=${encodeURIComponent(appointmentId)}` : ""}`,
  );
  const [selected, setSelected] = useState<Head | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const operation = useRef<{ key: string; id: string } | null>(null);
  const lock = useRef(false);
  const scope = useRef(crypto.randomUUID());
  const baseline = useRef<string | null>(null);
  const draftCallback = useRef(onDraftStateChange);
  draftCallback.current = onDraftStateChange;
  const dirty = Boolean(editor && JSON.stringify(editor) !== baseline.current);
  useEffect(() => {
    draftCallback.current?.({ dirty, pending });
  }, [dirty, pending]);
  useEffect(
    () => () => {
      draftCallback.current?.({ dirty: false, pending: false });
    },
    [],
  );
  // The encounter owns its route prompt; standalone plans guard their own route.
  useBlocker({
    disabled: Boolean(appointmentId) || (!dirty && !pending),
    enableBeforeUnload: dirty || pending,
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      !window.confirm("Há alterações não salvas no plano clínico. Deseja sair e descartá-las?"),
  });
  useEffect(() => {
    const protectUnit = (event: Event) => {
      if (dirty || pending) event.preventDefault();
    };
    const protectUnload = (event: BeforeUnloadEvent) => {
      if (dirty || pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("allik:before-unit-change", protectUnit);
    window.addEventListener("beforeunload", protectUnload);
    return () => {
      window.removeEventListener("allik:before-unit-change", protectUnit);
      window.removeEventListener("beforeunload", protectUnload);
    };
  }, [dirty, pending]);
  const beginEditor = (next: Editor) => {
    baseline.current = JSON.stringify(next);
    setEditor(next);
  };

  useEffect(() => {
    function reset() {
      scope.current = crypto.randomUUID();
      setSelected(null);
      setEditor(null);
      setMessage("");
      setError("");
      operation.current = null;
    }
    window.addEventListener("inventory-unit-change", reset);
    return () => {
      scope.current = crypto.randomUUID();
      window.removeEventListener("inventory-unit-change", reset);
    };
  }, []);
  const { parsed, preview, previewError } = useMemo(() => {
    const parsed = editor?.plan ? treatmentPlanSchema.safeParse(editor.plan) : null;
    let preview: ComputedTreatmentPlan | null = null;
    let previewError = "";
    if (parsed?.success) {
      try {
        preview = computeTreatmentPlan(parsed.data);
      } catch (cause) {
        previewError =
          cause instanceof Error ? cause.message : "Não foi possível calcular o plano.";
      }
    }
    return { parsed, preview, previewError };
  }, [editor?.plan]);
  async function save() {
    if (!editor || !parsed?.success || !preview || !editor.title.trim() || lock.current) return;
    const body = {
      action: "SAVE_PLAN",
      id: editor.id,
      version: editor.version,
      patientId,
      ...(appointmentId ? { appointmentId } : {}),
      title: editor.title,
      status: editor.status,
      plan: {
        ...parsed.data,
        items: parsed.data.items.map((item) => (appointmentId ? { ...item, appointmentId } : item)),
      },
    };
    const key = JSON.stringify(body);
    if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
    const current = scope.current;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(withSelectedUnit("/api/v1/inventory/patient-treatment-plans"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, operationId: operation.current.id }),
      });
      const result = await readInventoryResponse<{ id: string; version: number }>(
        response,
        "Não foi possível salvar o plano clínico.",
      );
      if (scope.current !== current) return;
      if (!result.data) throw Error("O servidor não confirmou o plano.");
      const refreshed = await query.refetch();
      if (scope.current !== current) return;
      setEditor(null);
      setSelected(refreshed.data?.plans.find((entry) => entry.id === result.data!.id) ?? null);
      operation.current = null;
      setMessage("Plano clínico salvo. Nenhuma ação operacional foi criada.");
    } catch (cause) {
      if (scope.current === current)
        setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  function updatePlan(values: Partial<PlanForm>) {
    if (editor) setEditor({ ...editor, plan: { ...editor.plan, ...values } });
  }
  function updateItem(index: number, values: Partial<FormItem>) {
    if (editor)
      updatePlan({
        items: editor.plan.items.map((item, i) => (i === index ? { ...item, ...values } : item)),
      });
  }
  function updateStage(index: number, stageIndex: number, values: Partial<TreatmentPlanStage>) {
    const item = editor?.plan.items[index];
    if (item)
      updateItem(index, {
        stages: item.stages.map((stage, i) => (i === stageIndex ? { ...stage, ...values } : stage)),
      });
  }
  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {data.canManage === true && !editor && (
        <Button
          disabled={pending}
          onClick={() => {
            setSelected(null);
            setError("");
            setMessage("");
            beginEditor({
              id: crypto.randomUUID(),
              version: null,
              title: "",
              status: "DRAFT",
              plan: { startDate: "", previewDays: 30, items: [blankItem(appointmentId)] },
            });
          }}
        >
          {appointmentId ? "Novo plano de procedimentos" : "Novo plano clínico"}
        </Button>
      )}
      {appointmentId && (
        <p className="text-xs text-teal-800">
          Vínculo fixo com este atendimento. Todos os itens pertencem a esta consulta.
        </p>
      )}
      <ul className="flex flex-wrap gap-2" aria-label="Planos clínicos do paciente">
        {data.plans.map((entry) => (
          <li key={entry.id}>
            <Button
              variant="outline"
              disabled={pending || !!editor}
              aria-pressed={selected?.id === entry.id}
              onClick={() => setSelected(entry)}
            >
              {entry.title} · {statusNames[entry.status]} · v{entry.version}
            </Button>
          </li>
        ))}
      </ul>
      {!data.plans.length && !editor && (
        <p className="text-sm text-muted-foreground">Nenhum plano clínico cadastrado.</p>
      )}
      {selected && !editor && (
        <PlanDetail
          appointmentId={appointmentId}
          key={`${selected.id}:${selected.version}`}
          patientId={patientId}
          head={selected}
          canManage={data.canManage === true}
          onEdit={(plan, record) => {
            beginEditor({ ...(record ?? selected), plan: structuredClone(plan) });
            setError("");
            setMessage("");
          }}
        />
      )}
      {editor && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-4 rounded-xl border p-4"
        >
          <fieldset disabled={pending} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Nome do plano clínico
                <Input
                  required
                  maxLength={160}
                  value={editor.title}
                  onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                />
              </label>
              <Select
                label="Situação do plano clínico"
                value={editor.status}
                onChange={(status) => setEditor({ ...editor, status: status as Head["status"] })}
              >
                {Object.entries(statusNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <label>
                Data inicial do plano
                <Input
                  required
                  type="date"
                  value={editor.plan.startDate}
                  onChange={(e) => updatePlan({ startDate: e.target.value })}
                />
              </label>
              <label>
                Horizonte da prévia (dias)
                <Input
                  type="number"
                  min={1}
                  max={366}
                  value={Number.isNaN(editor.plan.previewDays) ? "" : editor.plan.previewDays}
                  onChange={(e) =>
                    updatePlan({ previewDays: e.target.value ? Number(e.target.value) : NaN })
                  }
                />
              </label>
            </div>
            {editor.plan.items.map((item, index) => (
              <fieldset key={item.id} className="space-y-3 rounded-xl border border-teal-200 p-3">
                <legend className="font-medium">Item clínico {index + 1}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label="Tipo do item clínico"
                    value={item.kind}
                    onChange={(kind) => updateItem(index, { kind: kind as FormItem["kind"] })}
                  >
                    {treatmentPlanKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {kindNames[kind]}
                      </option>
                    ))}
                  </Select>
                  <label>
                    Nome do item clínico
                    <Input
                      required
                      maxLength={200}
                      value={item.title}
                      onChange={(e) => updateItem(index, { title: e.target.value })}
                    />
                  </label>
                  <Select
                    label="Referência de catálogo (opcional)"
                    value={
                      item.productId
                        ? `SKU:${item.productId}`
                        : item.catalogItemId
                          ? `ITEM:${item.catalogItemId}`
                          : ""
                    }
                    onChange={(value) => {
                      const [kind, id] = value.split(":");
                      updateItem(index, {
                        productId: kind === "SKU" ? (id ?? null) : null,
                        catalogItemId: kind === "ITEM" ? (id ?? null) : null,
                      });
                    }}
                  >
                    <option value="">Sem vínculo de catálogo</option>
                    <optgroup label="SKU">
                      {data.targets.products.map((target) => (
                        <option key={target.id} value={`SKU:${target.id}`}>
                          {target.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Catálogo clínico">
                      {data.targets.catalogItems.map((target) => (
                        <option key={target.id} value={`ITEM:${target.id}`}>
                          {target.name}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                  <UnitSelect
                    label="Unidade por administração"
                    value={item.administrationUnit ?? ""}
                    onChange={(unit) => updateItem(index, { administrationUnit: unit || null })}
                  />
                </div>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={item.optional}
                    onChange={(e) => updateItem(index, { optional: e.target.checked })}
                  />
                  Item opcional, conforme orientação clínica
                </label>
                <label className="block text-sm">
                  Orientações ao paciente
                  <textarea
                    className="mt-1 min-h-20 w-full rounded-lg border p-2"
                    maxLength={4000}
                    value={item.patientInstructions}
                    onChange={(e) => updateItem(index, { patientInstructions: e.target.value })}
                  />
                </label>
                <details>
                  <summary className="cursor-pointer text-sm">
                    Vínculos clínicos existentes (opcionais)
                  </summary>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {(
                      [
                        ["existingTreatmentId", "Tratamento existente", data.targets.treatments],
                        ["appointmentId", "Atendimento existente", data.targets.appointments],
                        [
                          "prescriptionInstanceId",
                          "Composição registrada existente",
                          data.targets.prescriptionInstances,
                        ],
                      ] as const
                    ).map(([key, label, targets]) => (
                      <Select
                        key={key}
                        disabled={Boolean(appointmentId && key === "appointmentId")}
                        label={
                          key === "appointmentId" && appointmentId
                            ? "Atendimento vinculado (fixo)"
                            : label
                        }
                        value={
                          key === "appointmentId" && appointmentId
                            ? appointmentId
                            : (item[key] ?? "")
                        }
                        onChange={(value) => updateItem(index, { [key]: value || null })}
                      >
                        <option value="">Sem vínculo</option>
                        {key === "appointmentId" &&
                          appointmentId &&
                          !targets.some((target) => target.id === appointmentId) && (
                            <option value={appointmentId}>Este atendimento</option>
                          )}
                        {targets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.label}
                          </option>
                        ))}
                      </Select>
                    ))}
                  </div>
                </details>
                {item.stages.map((stage, stageIndex) => (
                  <fieldset
                    key={stageIndex}
                    className="space-y-3 rounded-lg border bg-slate-50 p-3"
                  >
                    <legend>Etapa clínica {stageIndex + 1}</legend>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label>
                        Quantidade por administração
                        <Input
                          inputMode="decimal"
                          value={stage.doseUnits ?? ""}
                          onChange={(e) =>
                            updateStage(index, stageIndex, { doseUnits: e.target.value || null })
                          }
                        />
                      </label>
                      <label>
                        Administrações por dia
                        <Input
                          type="number"
                          min={1}
                          max={24}
                          value={stage.frequencyPerDay ?? ""}
                          onChange={(e) =>
                            updateStage(index, stageIndex, {
                              frequencyPerDay: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                        />
                      </label>
                      <label>
                        Intervalo em dias
                        <Input
                          required
                          type="number"
                          min={1}
                          max={365}
                          value={Number.isNaN(stage.everyDays) ? "" : stage.everyDays}
                          onChange={(e) =>
                            updateStage(index, stageIndex, {
                              everyDays: e.target.value ? Number(e.target.value) : NaN,
                            })
                          }
                        />
                      </label>
                      <Select
                        label="Prazo da etapa"
                        value={stage.durationDays === null ? "INDEFINITE" : "FINITE"}
                        onChange={(value) =>
                          updateStage(index, stageIndex, {
                            durationDays: value === "INDEFINITE" ? null : NaN,
                          })
                        }
                      >
                        <option value="FINITE">Duração definida</option>
                        <option value="INDEFINITE">Sem prazo definido</option>
                      </Select>
                      {stage.durationDays !== null && (
                        <label>
                          Duração da etapa (dias)
                          <Input
                            required
                            type="number"
                            min={1}
                            max={3650}
                            value={Number.isNaN(stage.durationDays) ? "" : stage.durationDays}
                            onChange={(e) =>
                              updateStage(index, stageIndex, {
                                durationDays: e.target.value ? Number(e.target.value) : NaN,
                              })
                            }
                          />
                        </label>
                      )}
                      <label>
                        Horários (HH:mm separados por vírgula)
                        <Input
                          placeholder="Informe apenas horários definidos"
                          value={stage.times?.join(", ") ?? ""}
                          onChange={(e) =>
                            updateStage(index, stageIndex, {
                              times: e.target.value.trim()
                                ? e.target.value.split(",").map((value) => value.trim())
                                : null,
                            })
                          }
                        />
                      </label>
                    </div>
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={stage.weekdays !== null}
                        onChange={(e) =>
                          updateStage(index, stageIndex, { weekdays: e.target.checked ? [] : null })
                        }
                      />
                      Selecionar dias da semana
                    </label>
                    {stage.weekdays !== null && (
                      <div className="flex flex-wrap gap-3">
                        {[
                          "Domingo",
                          "Segunda-feira",
                          "Terça-feira",
                          "Quarta-feira",
                          "Quinta-feira",
                          "Sexta-feira",
                          "Sábado",
                        ].map((label, day) => (
                          <label key={day} className="flex gap-1 text-sm">
                            <input
                              type="checkbox"
                              checked={stage.weekdays!.includes(day)}
                              onChange={(e) =>
                                updateStage(index, stageIndex, {
                                  weekdays: e.target.checked
                                    ? [...stage.weekdays!, day].sort()
                                    : stage.weekdays!.filter((entry) => entry !== day),
                                })
                              }
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Com a seleção de dias da semana desligada, o intervalo usa dias corridos.
                      Frequência, quantidade e horários vazios permanecem não informados. Horários
                      preenchidos devem corresponder à frequência explícita.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={item.stages.length === 1}
                      onClick={() =>
                        updateItem(index, {
                          stages: item.stages.filter((_, i) => i !== stageIndex),
                        })
                      }
                    >
                      Remover etapa clínica {stageIndex + 1}
                    </Button>
                  </fieldset>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    item.stages.length >= 12 ||
                    item.stages.some((stage) => stage.durationDays === null)
                  }
                  onClick={() => updateItem(index, { stages: [...item.stages, blankStage()] })}
                >
                  Adicionar etapa clínica
                </Button>
                <div className="grid gap-3 sm:grid-cols-2">
                  <fieldset className="space-y-2 rounded-lg border p-3">
                    <legend>Dispensação manual</legend>
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={item.dispense !== null}
                        onChange={(e) =>
                          updateItem(index, {
                            dispense: e.target.checked ? { quantity: "", unit: "" } : null,
                            package: null,
                          })
                        }
                      />
                      Informar quantidade a dispensar
                    </label>
                    {item.dispense && (
                      <>
                        <label>
                          Quantidade a dispensar
                          <Input
                            inputMode="decimal"
                            value={item.dispense.quantity}
                            onChange={(e) =>
                              updateItem(index, {
                                dispense: { ...item.dispense!, quantity: e.target.value },
                              })
                            }
                          />
                        </label>
                        <UnitSelect
                          label="Unidade de dispensação"
                          value={item.dispense.unit ?? ""}
                          onChange={(unit) =>
                            updateItem(index, { dispense: { ...item.dispense!, unit } })
                          }
                        />
                      </>
                    )}
                  </fieldset>
                  <fieldset className="space-y-2 rounded-lg border p-3">
                    <legend>Capacidade informada da embalagem</legend>
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={!item.dispense}
                        checked={item.package !== null}
                        onChange={(e) =>
                          updateItem(index, {
                            package: e.target.checked ? { capacity: "", unit: "" } : null,
                          })
                        }
                      />
                      Informar capacidade da embalagem
                    </label>
                    {item.package && (
                      <>
                        <label>
                          Capacidade por embalagem
                          <Input
                            inputMode="decimal"
                            value={item.package.capacity}
                            onChange={(e) =>
                              updateItem(index, {
                                package: { ...item.package!, capacity: e.target.value },
                              })
                            }
                          />
                        </label>
                        <UnitSelect
                          label="Unidade da capacidade"
                          value={item.package.unit ?? ""}
                          onChange={(unit) =>
                            updateItem(index, { package: { ...item.package!, unit } })
                          }
                        />
                      </>
                    )}
                  </fieldset>
                </div>
                <p className="text-xs text-muted-foreground">
                  Embalagens são calculadas somente com capacidade fornecida e unidade idêntica à
                  dispensação. Não converte mg, cápsulas, gotas ou volumes. Não baixa estoque.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={editor.plan.items.length === 1}
                  onClick={() =>
                    updatePlan({ items: editor.plan.items.filter((_, i) => i !== index) })
                  }
                >
                  Remover item clínico {index + 1}
                </Button>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={editor.plan.items.length >= 50}
              onClick={() =>
                updatePlan({ items: [...editor.plan.items, blankItem(appointmentId)] })
              }
            >
              Adicionar item clínico
            </Button>
            {parsed && !parsed.success && (
              <p className="text-sm text-amber-900" role="status">
                Complete os campos:{" "}
                {parsed.error.issues
                  .slice(0, 3)
                  .map((issue) => issue.message)
                  .join(" · ")}
              </p>
            )}
            {previewError && <p role="alert">{previewError}</p>}
            {parsed?.success && preview && <Preview plan={parsed.data} preview={preview} />}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!parsed?.success || !preview || !editor.title.trim()}>
                {appointmentId ? "Salvar procedimentos" : "Salvar plano clínico"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditor(null)}>
                Cancelar plano clínico
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Salvar ou ativar este plano não finaliza documentos, envia mensagens ou cria
              cobranças, agendamentos, aplicações, reservas ou consumo de estoque.
            </p>
          </fieldset>
        </form>
      )}
    </div>
  );
}
function PlanDetail({
  patientId,
  appointmentId,
  head,
  canManage,
  onEdit,
}: {
  patientId: string;
  appointmentId?: string | undefined;
  head: Head;
  canManage: boolean;
  onEdit: (plan: TreatmentPlanInput, record?: Head) => void;
}) {
  const [tab, setTab] = useState<"clinical" | "quote">("clinical");
  const [quoteOpened, setQuoteOpened] = useState(false);
  const query = useInventory<{
    plan: TreatmentPlanInput;
    preview: ComputedTreatmentPlan;
    canEdit: boolean;
    record?: Head;
  }>(
    `patient-treatment-plans?patientId=${encodeURIComponent(patientId)}&planId=${encodeURIComponent(head.id)}${appointmentId ? `&appointmentId=${encodeURIComponent(appointmentId)}` : ""}`,
  );
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{data.record?.title ?? head.title}</h3>
      <p className="text-xs text-muted-foreground">
        {statusNames[data.record?.status ?? head.status]} · versão{" "}
        {data.record?.version ?? head.version} · snapshot clínico independente
      </p>
      {canManage && (data.record?.canEdit ?? head.canEdit) === true && data.canEdit === true && (
        <Button variant="outline" onClick={() => onEdit(data.plan, data.record)}>
          Editar plano clínico
        </Button>
      )}
      <div role="tablist" aria-label="Visões do plano clínico" className="flex flex-wrap gap-2">
        <Button
          type="button"
          role="tab"
          aria-selected={tab === "clinical"}
          variant={tab === "clinical" ? "default" : "outline"}
          onClick={() => setTab("clinical")}
        >
          Plano clínico
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={tab === "quote"}
          variant={tab === "quote" ? "default" : "outline"}
          onClick={() => {
            setQuoteOpened(true);
            setTab("quote");
          }}
        >
          Orçamento
        </Button>
      </div>
      <div hidden={tab !== "clinical"}>
        <Preview plan={data.plan} preview={data.preview} />
      </div>
      {quoteOpened && (
        <div hidden={tab !== "quote"}>
          <PlanQuotePanel
            patientId={patientId}
            planId={head.id}
            expectedPlanVersion={data.record?.version ?? head.version}
          />
        </div>
      )}
    </div>
  );
}
