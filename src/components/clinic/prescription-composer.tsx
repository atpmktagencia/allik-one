import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { withSelectedUnit } from "@/data/unit-context";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import {
  composePrescription,
  prescriptionFormulaSchema,
  type PrescriptionComposition,
  type PrescriptionFormula,
  type PrescriptionProtocol,
} from "@/data/prescription-composer";
import { prescriptionReferenceIngredients } from "@/data/prescription-reference";
import { PrescriptionChoiceField } from "./prescription-choice-field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PrescriptionModelForm, type ModelFields } from "./prescription-model-form";
import { ComposerQuotePanel } from "./composer-quote-panel";
import { InventoryState } from "./inventory-state";

const emptyIngredient = () => ({
  medicationName: "",
  dose: "",
  doseUnit: "",
  individualCapsule: false,
});
const emptyPhase = () => ({
  doseUnits: NaN,
  frequencyPerDay: NaN,
  durationDays: NaN,
  maintenance: false,
});
const emptyFormula = (): PrescriptionFormula => ({
  ingredients: [emptyIngredient()],
  route: "",
  presentation: "",
  instructions: "",
  dispenseQuantity: "",
  dispenseUnit: "",
  phases: [emptyPhase()],
});

/** Produces reviewed text only. Saving/finalizing the clinical document remains explicit. */
export function PrescriptionComposer({
  appointmentId,
  documentId,
  onInsert,
  onDraftStateChange,
}: {
  appointmentId: string;
  documentId: string;
  onInsert: (text: string, instanceId?: string) => boolean | void;
  onDraftStateChange?: (state: { dirty: boolean; pending: boolean }) => void;
}) {
  const query = useInventory<{
    templates: PrescriptionProtocol[];
    canCompose: boolean;
    units?: { id: string; name: string }[];
    eligibleGrantees?: { id: string; name: string }[];
    canCreateShared?: boolean;
    canCreateInstitutional?: boolean;
  }>(`prescription-composer?appointmentId=${encodeURIComponent(appointmentId)}`);
  const unitListId = useId();
  const dispenseListId = useId();
  const [dirty, setDirty] = useState(false);
  const [formula, setFormula] = useState<PrescriptionFormula>(emptyFormula);
  const [activeTab, setActiveTab] = useState<"prescription" | "quote">("prescription");
  const [quoteOpened, setQuoteOpened] = useState(false);
  const composerTabsId = useId();
  const [title, setTitle] = useState("");
  const [protocol, setProtocol] = useState<PrescriptionProtocol | null>(null);
  const [editingSource, setEditingSource] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [grantee, setGrantee] = useState("");
  const librarySelectId = useId();
  const grantSelectId = useId();
  const insertion = useRef<{ key: string; id: string } | null>(null);
  const scopeRevision = useRef(0);
  useEffect(() => {
    function reset() {
      scopeRevision.current += 1;
      setFormula(emptyFormula());
      setDirty(false);
      setActiveTab("prescription");
      setQuoteOpened(false);
      setProtocol(null);
      setEditingSource(false);
      setModelOpen(false);
      setGrantee("");
      setTitle("");
      setPreview(null);
      setReviewed(false);
      setExcluded(new Set());
      insertion.current = null;
    }
    reset();
    window.addEventListener("inventory-unit-change", reset);
    return () => {
      window.removeEventListener("inventory-unit-change", reset);
      scopeRevision.current += 1;
    };
  }, [appointmentId, documentId]);
  const [preview, setPreview] = useState<PrescriptionComposition | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    onDraftStateChange?.({ dirty, pending });
  }, [dirty, pending, onDraftStateChange]);
  useEffect(() => {
    function guardUnload(event: BeforeUnloadEvent) {
      if (!dirty && !pending) return;
      event.preventDefault();
      event.returnValue = "";
    }
    function guardUnit(event: Event) {
      if (dirty || pending) event.preventDefault();
    }
    window.addEventListener("beforeunload", guardUnload);
    window.addEventListener("allik:before-unit-change", guardUnit);
    return () => {
      window.removeEventListener("beforeunload", guardUnload);
      window.removeEventListener("allik:before-unit-change", guardUnit);
    };
  }, [dirty, pending]);
  const lock = useRef(false);
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());
  const [search, setSearch] = useState("");
  const drag = useRef<{ pointerId: number; selected: boolean } | null>(null);
  const pointerClick = useRef(false);
  const suppressionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function selectIngredient(index: number, selected: boolean) {
    setDirty(true);
    setExcluded((previous) => {
      const next = new Set(previous);
      if (selected) next.delete(index);
      else next.add(index);
      return next;
    });
    setPreview(null);
    setReviewed(false);
    setError("");
    setMessage("");
  }
  useEffect(() => {
    function move(event: PointerEvent) {
      if (!drag.current || event.pointerId !== drag.current.pointerId) return;
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-composer-selector]");
      if (target?.dataset["composerSelector"] !== undefined)
        selectIngredient(Number(target.dataset["composerSelector"]), drag.current.selected);
    }
    function stop() {
      drag.current = null;
      if (suppressionTimer.current) clearTimeout(suppressionTimer.current);
      suppressionTimer.current = setTimeout(() => {
        pointerClick.current = false;
      }, 0);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      drag.current = null;
      pointerClick.current = false;
      if (suppressionTimer.current) clearTimeout(suppressionTimer.current);
    };
  }, []);
  useEffect(() => {
    if (pending) {
      drag.current = null;
      pointerClick.current = false;
    }
  }, [pending]);
  const selectedFormula = {
    ...formula,
    ingredients: formula.ingredients.filter((_, index) => !excluded.has(index)),
  };
  const validComposition = prescriptionFormulaSchema.safeParse(selectedFormula).success;
  const livePreview = validComposition ? composePrescription(selectedFormula) : null;
  function loadProtocol(item: PrescriptionProtocol | null) {
    if (dirty && !window.confirm("Substituir a composição local ainda não inserida na receita?"))
      return;
    setProtocol(item);
    setEditingSource(false);
    setModelOpen(false);
    setGrantee("");
    setTitle(item?.title ?? "");
    setExcluded(new Set());
    change(item ? structuredClone(item.formula) : emptyFormula());
  }
  function change(value: PrescriptionFormula) {
    setDirty(true);
    setFormula(value);
    setPreview(null);
    setReviewed(false);
    setError("");
    setMessage("");
  }
  async function submit(action: "PREVIEW" | "SAVE" | "ARCHIVE", fields?: ModelFields) {
    if (lock.current) return;
    if (action !== "ARCHIVE") {
      const parsed = prescriptionFormulaSchema.safeParse(selectedFormula);
      if (!parsed.success) {
        setError(
          "Preencha os componentes, a via, a apresentação e as etapas com valores válidos. Use números inteiros para unidades, frequência e dias.",
        );
        return;
      }
    }
    if (action === "SAVE" && (!fields?.confirmedNoPatientData || fields.title.trim().length < 2)) {
      setError("Informe um nome para o protocolo pessoal.");
      return;
    }
    if (
      action === "ARCHIVE" &&
      (!protocol ||
        !window.confirm(
          "Arquivar este protocolo pessoal? Receitas já elaboradas serão preservadas.",
        ))
    )
      return;
    const scope = scopeRevision.current;
    lock.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(withSelectedUnit("/api/v1/inventory/prescription-composer"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          appointmentId,
          ...(action === "PREVIEW"
            ? { formula: selectedFormula }
            : action === "SAVE"
              ? {
                  ...fields,
                  formula: selectedFormula,
                  ...(editingSource && protocol?.canEdit
                    ? { id: protocol.id, version: protocol.version }
                    : {}),
                }
              : { id: protocol!.id, version: protocol!.version }),
        }),
      });
      const result = await readInventoryResponse<
        PrescriptionComposition & { id: string; version: number }
      >(response, "Não foi possível processar a composição.");
      if (scope !== scopeRevision.current) return;
      if (!result.data) throw new Error("Não foi possível confirmar a operação.");
      if (action === "PREVIEW") {
        setPreview(result.data);
        setReviewed(false);
      } else {
        const refreshed = await query.refetch();
        if (scope !== scopeRevision.current) return;
        setProtocol(
          action === "SAVE"
            ? (refreshed?.data?.templates.find(
                (entry) => entry.id === result.data!.id && entry.version === result.data!.version,
              ) ?? null)
            : null,
        );
        setPreview(null);
        setReviewed(false);
        insertion.current = null;
        setEditingSource(false);
        setModelOpen(false);
        if (action === "SAVE") setTitle(fields?.title ?? "");
        else setTitle("");
        setMessage(action === "SAVE" ? "Protocolo pessoal salvo." : "Protocolo arquivado.");
      }
    } catch (cause) {
      if (scope !== scopeRevision.current) return;
      setError(cause instanceof Error ? cause.message : "Não foi possível processar a composição.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function protocolAction(
    action: "SUBMIT" | "APPROVE" | "REJECT" | "GRANT_ACCESS" | "REVOKE_ACCESS",
  ) {
    if (!protocol || lock.current) return;
    if (
      !window.confirm(
        "Confirmar esta alteração de governança do modelo? A composição do atendimento não será alterada.",
      )
    )
      return;
    const scope = scopeRevision.current;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(withSelectedUnit("/api/v1/inventory/prescription-composer"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          appointmentId,
          id: protocol.id,
          version: protocol.version,
          ...(action === "GRANT_ACCESS" || action === "REVOKE_ACCESS"
            ? { granteeUserId: grantee }
            : {}),
        }),
      });
      const result = await readInventoryResponse<{ id: string; version: number }>(
        response,
        "Não foi possível atualizar o modelo.",
      );
      if (scope !== scopeRevision.current) return;
      const refreshed = await query.refetch();
      setProtocol(
        refreshed?.data?.templates.find((entry) => entry.id === protocol.id) ??
          (result.data ? { ...protocol, version: result.data.version } : null),
      );
      setEditingSource(false);
      setMessage("Governança do modelo atualizada. A composição do atendimento foi preservada.");
    } catch (cause) {
      if (scope !== scopeRevision.current) return;
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o modelo.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function insertReviewed() {
    if (!preview || !reviewed || lock.current) return;
    const body = {
      action: "INSTANTIATE",
      appointmentId,
      documentId,
      formula: selectedFormula,
      ...(protocol ? { sourceId: protocol.id, sourceVersion: protocol.version } : {}),
    };
    const key = JSON.stringify(body);
    if (insertion.current?.key !== key) insertion.current = { key, id: crypto.randomUUID() };
    const scope = scopeRevision.current;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(withSelectedUnit("/api/v1/inventory/prescription-composer"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, id: insertion.current.id }),
      });
      const result = await readInventoryResponse<PrescriptionComposition & { instanceId: string }>(
        response,
        "Não foi possível registrar a cópia do modelo.",
      );
      if (scope !== scopeRevision.current) return;
      if (!result.data?.instanceId)
        throw new Error("O servidor não confirmou o registro da composição.");
      if (onInsert(result.data.text, result.data.instanceId) !== false) setDirty(false);
    } catch (cause) {
      if (scope !== scopeRevision.current) return;
      setError(cause instanceof Error ? cause.message : "Não foi possível inserir a composição.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  if (!query.data?.canCompose)
    return <p>A composição exige o profissional responsável pelo atendimento.</p>;
  return (
    <div className="space-y-4 text-sm">
      <p role="status" className="text-xs text-muted-foreground">
        {pending
          ? "Processando composição…"
          : dirty
            ? "Composição local não inserida na receita. Insira no rascunho ou confirme o descarte ao fechar."
            : "Composição sem alterações locais pendentes."}
      </p>
      <datalist id={unitListId}>
        {["mg", "g", "mcg", "µg", "UI", "mL", "%"].map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>
      <datalist id={dispenseListId}>
        {["cápsulas", "comprimidos", "mL", "g", "gotas", "sachês", "unidades"].map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>
      <p className="rounded-xl bg-amber-50 p-3">
        Informe a composição por unidade de administração e confira cada etapa. Este recurso calcula
        quantidades; não recomenda doses, avalia compatibilidade ou define o tipo de receituário.
      </p>
      <a
        href="/catalogo-clinico"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-sm font-medium text-teal-800 underline underline-offset-4"
      >
        Consultar catálogo clínico (nova aba)
      </a>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(220px,.8fr)_minmax(360px,1.5fr)_minmax(280px,1fr)]">
        {" "}
        <fieldset
          disabled={pending}
          className="min-w-0 space-y-4 rounded-2xl border bg-teal-50/40 p-4 xl:max-h-[76dvh] xl:overflow-y-auto"
        >
          <h3 className="font-semibold">Protocolos pessoais / padrão</h3>
          <p className="text-xs text-muted-foreground">
            Seu padrão é definido pelos protocolos que você salvar. Nenhum esquema clínico vem
            pré-selecionado.
          </p>
          <label className="block">
            Buscar protocolos
            <Input value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <div>
            <label htmlFor={librarySelectId}>Protocolo pessoal</label>
            <select
              id={librarySelectId}
              className="mt-1 w-full rounded-xl border bg-white p-2"
              value={protocol?.id ?? ""}
              onChange={(event) =>
                loadProtocol(
                  query.data?.templates.find((entry) => entry.id === event.target.value) ?? null,
                )
              }
            >
              <option value="">Nova composição</option>
              {query.data.templates.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title} · v{entry.version}
                </option>
              ))}
            </select>
          </div>
          <Popover
            open={modelOpen}
            onOpenChange={(open) => {
              setModelOpen(open);
              if (!open) setEditingSource(false);
            }}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setEditingSource(false)}
              >
                Transformar em modelo
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="right"
              align="start"
              className="max-h-[80dvh] w-[min(360px,90vw)] overflow-y-auto"
            >
              <h4 className="mb-3 font-semibold">
                {editingSource ? "Editar modelo de origem" : "Salvar nova cópia como modelo"}
              </h4>
              <PrescriptionModelForm
                key={`${protocol?.id ?? "new"}:${editingSource}`}
                initial={{
                  title,
                  category: editingSource ? (protocol?.category ?? "") : "",
                  description: editingSource ? (protocol?.description ?? "") : "",
                  visibility: editingSource ? (protocol?.visibility ?? "PRIVATE") : "PRIVATE",
                  unitIds: editingSource ? (protocol?.unitIds ?? []) : [],
                  confirmedNoPatientData: false,
                }}
                units={query.data.units ?? []}
                canCreateShared={query.data.canCreateShared === true}
                canCreateInstitutional={query.data.canCreateInstitutional === true}
                pending={pending}
                onSave={(fields) => void submit("SAVE", fields)}
              />
            </PopoverContent>
          </Popover>
          {protocol && (
            <section
              className="space-y-2 rounded-lg border p-3 text-xs"
              aria-label="Governança do modelo selecionado"
            >
              <p>
                {
                  {
                    PRIVATE: "Privado",
                    ORGANIZATION: "Organização",
                    INSTITUTIONAL: "Institucional",
                  }[protocol.visibility ?? "PRIVATE"]
                }{" "}
                ·{" "}
                {
                  { DRAFT: "Rascunho", PENDING: "Aguardando aprovação", APPROVED: "Aprovado" }[
                    protocol.status ?? "DRAFT"
                  ]
                }{" "}
                · versão {protocol.version}
              </p>
              <p>Autor: {protocol.authorName ?? "Autor não informado"}</p>
              <p>
                A composição é uma cópia para este atendimento; alterações locais não editam o
                modelo de origem.
              </p>
              {protocol.canEdit === true && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingSource(true);
                    setModelOpen(true);
                  }}
                >
                  Editar este modelo
                </Button>
              )}
              {protocol.canArchive === true && (
                <Button type="button" variant="outline" onClick={() => void submit("ARCHIVE")}>
                  Arquivar protocolo
                </Button>
              )}
              {protocol.canSubmit === true && (
                <Button type="button" onClick={() => void protocolAction("SUBMIT")}>
                  Submeter para aprovação
                </Button>
              )}
              {protocol.canApprove === true && (
                <>
                  <Button type="button" onClick={() => void protocolAction("APPROVE")}>
                    Aprovar modelo institucional
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void protocolAction("REJECT")}
                  >
                    Rejeitar modelo institucional
                  </Button>
                </>
              )}
              {protocol.canGrantAccess === true && (
                <div className="space-y-2">
                  <label htmlFor={grantSelectId}>Administrador com acesso privado</label>
                  <select
                    id={grantSelectId}
                    className="w-full rounded-lg border bg-white p-2"
                    value={grantee}
                    onChange={(event) => setGrantee(event.target.value)}
                  >
                    <option value="">Selecionar administrador</option>
                    {(query.data.eligibleGrantees ?? []).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!grantee}
                    onClick={() => void protocolAction("GRANT_ACCESS")}
                  >
                    Conceder leitura privada
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!grantee}
                    onClick={() => void protocolAction("REVOKE_ACCESS")}
                  >
                    Revogar leitura privada
                  </Button>
                </div>
              )}
            </section>
          )}
          <p className="text-xs text-muted-foreground">
            Exibindo até os 100 modelos visíveis atualizados mais recentemente. Modelos privados não
            são expostos automaticamente a administradores. Não inclua dados pessoais de pacientes.
          </p>
          <div
            className="max-h-64 space-y-2 overflow-y-auto"
            aria-label="Lista de protocolos pessoais"
          >
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() => loadProtocol(null)}
            >
              Nova composição
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full justify-start whitespace-normal border-teal-300 bg-teal-50 py-3 text-left text-teal-900"
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm("Substituir a composição local ainda não inserida na receita?")
                )
                  return;
                const next = {
                  ...emptyFormula(),
                  phases: [
                    {
                      doseUnits: NaN,
                      frequencyPerDay: NaN,
                      durationDays: NaN,
                      maintenance: false,
                    },
                  ],
                  ingredients: prescriptionReferenceIngredients.map((medicationName) => ({
                    ...emptyIngredient(),
                    medicationName,
                  })),
                };
                setProtocol(null);
                setTitle("Modelo da foto — conferência");
                setExcluded(new Set(next.ingredients.map((_, index) => index)));
                change(next);
              }}
            >
              Modelo da foto · conferir
            </Button>
            <p className="text-xs text-muted-foreground">
              Referência transcrita de foto com trechos pouco legíveis; confirme cada nome.
              Selecione os componentes e informe quantidades e unidades; nada será prescrito ou
              salvo automaticamente.
            </p>
            {query.data.templates
              .filter((item) =>
                item.title.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")),
              )
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={protocol?.id === item.id}
                  className="block w-full rounded-xl border bg-white p-3 text-left hover:border-teal-400 aria-pressed:border-teal-600"
                  onClick={() => loadProtocol(item)}
                >
                  <span className="block font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {
                      {
                        PRIVATE: "Privado",
                        ORGANIZATION: "Organização",
                        INSTITUTIONAL: "Institucional",
                      }[item.visibility ?? "PRIVATE"]
                    }{" "}
                    ·{" "}
                    {
                      {
                        DRAFT: "Rascunho",
                        PENDING: "Aguardando aprovação",
                        APPROVED: "Aprovado",
                      }[item.status ?? "DRAFT"]
                    }{" "}
                    · v{item.version} · {item.authorName ?? "Autor não informado"}
                  </span>
                </button>
              ))}
          </div>
        </fieldset>
        <fieldset
          disabled={pending}
          className="min-w-0 space-y-4 rounded-2xl border p-4 xl:max-h-[76dvh] xl:overflow-y-auto"
        >
          <h3 className="font-semibold">Montar composição</h3>
          <p className="text-xs text-muted-foreground">
            Marque componentes para incluir. Com mouse ou caneta, arraste a partir do seletor sobre
            outros seletores para aplicar a mesma seleção.
          </p>
          <div className="space-y-0">
            <h3 className="mb-2 font-medium">Componentes por unidade de administração</h3>
            <div
              className="sticky top-0 z-10 grid grid-cols-[24px_minmax(0,1fr)_78px_60px_24px] gap-1 border-b border-teal-200 bg-teal-50 px-2 py-2 text-xs font-semibold text-teal-950"
              aria-label="Colunas dos componentes"
            >
              <span aria-hidden="true" />
              <span>Nome do componente</span>
              <span>Quantidade</span>
              <span>Unidade</span>
              <span aria-hidden="true" />
            </div>
            {formula.ingredients.map((ingredient, index) => (
              <fieldset
                key={index}
                className={`grid min-w-0 grid-cols-[24px_minmax(0,1fr)_78px_60px_24px] items-center gap-1 border-b px-2 py-1 ${excluded.has(index) ? "bg-white" : "bg-teal-50/70"}`}
              >
                <legend className="sr-only">Componente {index + 1}</legend>
                <label
                  className="flex h-8 cursor-pointer items-center justify-center"
                  data-composer-selector={index}
                  title={
                    excluded.has(index)
                      ? "Excluído · valores preservados"
                      : "Incluído na composição"
                  }
                >
                  <input
                    type="checkbox"
                    aria-label={`Incluir componente ${index + 1}`}
                    checked={!excluded.has(index)}
                    onPointerDown={(event) => {
                      if (pending || event.button !== 0 || event.pointerType === "touch") return;
                      event.preventDefault();
                      if (suppressionTimer.current) clearTimeout(suppressionTimer.current);
                      pointerClick.current = true;
                      drag.current = {
                        pointerId: event.pointerId,
                        selected: excluded.has(index),
                      };
                      selectIngredient(index, excluded.has(index));
                    }}
                    onClick={(event) => {
                      if (pointerClick.current) {
                        event.preventDefault();
                        queueMicrotask(() => {
                          pointerClick.current = false;
                        });
                      }
                    }}
                    onChange={(event) => {
                      if (!pointerClick.current) selectIngredient(index, event.target.checked);
                    }}
                  />
                  <span className="sr-only">
                    {excluded.has(index)
                      ? "Excluído desta composição · valores preservados"
                      : "Incluir nesta composição"}
                  </span>
                </label>
                {(
                  [
                    ["medicationName", "Nome do componente", 160],
                    ["dose", "Quantidade por unidade", 20],
                    ["doseUnit", "Unidade da quantidade (ex.: mg)", 40],
                  ] as const
                ).map(([key, label, max]) => (
                  <label key={key} className="min-w-0">
                    <span className="sr-only">{label}</span>
                    <Input
                      className="h-8 min-w-0 rounded-md border-slate-200 bg-white px-2 text-xs"
                      placeholder={
                        key === "medicationName" ? "Componente" : key === "dose" ? "Qtd." : "Un."
                      }
                      title={label}
                      value={ingredient[key]}
                      maxLength={max}
                      inputMode={key === "dose" ? "decimal" : undefined}
                      list={key === "doseUnit" ? unitListId : undefined}
                      onChange={(event) =>
                        change({
                          ...formula,
                          ingredients: formula.ingredients.map((value, i) =>
                            i === index ? { ...value, [key]: event.target.value } : value,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <details className="relative text-xs">
                  <summary
                    className="cursor-pointer list-none py-1 text-center text-teal-900"
                    aria-label={`Opções do componente ${index + 1}`}
                  >
                    ⋯
                  </summary>
                  <div className="absolute right-0 z-20 w-64 space-y-2 rounded-lg border bg-white p-3 shadow-lg">
                    <label className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={ingredient.individualCapsule}
                        onChange={(e) =>
                          change({
                            ...formula,
                            ingredients: formula.ingredients.map((v, i) =>
                              i === index ? { ...v, individualCapsule: e.target.checked } : v,
                            ),
                          })
                        }
                      />
                      Componente em cápsula individual (quantidade exige conferência separada)
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={formula.ingredients.length === 1}
                      onClick={() => {
                        setExcluded(
                          new Set(
                            [...excluded]
                              .filter((i) => i !== index)
                              .map((i) => (i > index ? i - 1 : i)),
                          ),
                        );
                        change({
                          ...formula,
                          ingredients: formula.ingredients.filter((_, i) => i !== index),
                        });
                      }}
                    >
                      Remover componente {index + 1}
                    </Button>
                  </div>
                </details>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={formula.ingredients.length >= 100}
              onClick={() =>
                change({ ...formula, ingredients: [...formula.ingredients, emptyIngredient()] })
              }
            >
              Adicionar componente
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <PrescriptionChoiceField
              label="Via de administração"
              value={formula.route}
              options={[
                "oral",
                "tópica",
                "sublingual",
                "bucal",
                "nasal",
                "oftálmica",
                "otológica",
                "retal",
                "vaginal",
              ]}
              onChange={(route) => change({ ...formula, route })}
            />
            <PrescriptionChoiceField
              label="Forma farmacêutica"
              value={formula.pharmaceuticalForm ?? ""}
              options={[
                "cápsula",
                "comprimido",
                "solução",
                "suspensão",
                "creme",
                "gel",
                "pomada",
                "pó",
              ]}
              onChange={(pharmaceuticalForm) => change({ ...formula, pharmaceuticalForm })}
            />
            <PrescriptionChoiceField
              label="Tipo de cápsula"
              value={formula.capsuleType ?? ""}
              options={["gelatinosa", "vegetal", "gastrorresistente", "liberação prolongada"]}
              onChange={(capsuleType) => change({ ...formula, capsuleType })}
            />
            <PrescriptionChoiceField
              label="Base / excipiente"
              value={formula.excipient ?? ""}
              options={[]}
              onChange={(excipient) => change({ ...formula, excipient })}
            />
            <PrescriptionChoiceField
              label="Apresentação (unidade de administração)"
              value={formula.presentation}
              options={["cápsula", "comprimido", "mL", "g", "gota", "sachê", "unidade"]}
              onChange={(presentation) => change({ ...formula, presentation })}
            />
            <PrescriptionChoiceField
              label="Embalagem"
              value={formula.packaging ?? ""}
              options={["frasco", "blíster", "pote", "sachê"]}
              onChange={(packaging) => change({ ...formula, packaging })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Selecione uma opção ou escolha Personalizar… para digitar outro valor. Forma
            farmacêutica, tipo de cápsula, base e embalagem são opcionais.
          </p>
          <div className="space-y-3">
            <h3 className="font-medium">Posologia e progressão de dose</h3>
            <p className="text-xs text-muted-foreground">
              Defina a posologia inicial e, se necessário, uma segunda posologia para aumento ou
              ajuste. As etapas serão aplicadas em sequência, sem alterar a quantidade de cada ativo
              por unidade de administração.
            </p>
            {formula.phases.map((phase, index) => (
              <fieldset key={index} className="space-y-2 rounded-xl border p-3">
                <legend>Etapa {index + 1}</legend>
                <h4 className="font-medium text-teal-950">
                  {index === 0
                    ? "Posologia inicial"
                    : index === 1
                      ? "Segunda posologia · aumento ou ajuste"
                      : "Continuação da posologia"}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {index === 0
                    ? "Primeiro período do tratamento."
                    : "Iniciar somente após concluir a etapa anterior, conforme orientação do prescritor."}
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      ["doseUnits", "Unidades por administração", 100],
                      ["frequencyPerDay", "Administrações por dia", 24],
                      ["durationDays", "Duração em dias", 365],
                    ] as const
                  ).map(([key, label, max]) => (
                    <label key={key}>
                      {label}
                      <Input
                        type="number"
                        min={1}
                        max={max}
                        step={1}
                        disabled={key === "durationDays" && phase.maintenance}
                        value={Number.isNaN(phase[key]) ? "" : phase[key]}
                        onChange={(e) =>
                          change({
                            ...formula,
                            phases: formula.phases.map((v, i) =>
                              i === index
                                ? {
                                    ...v,
                                    [key]: e.target.value === "" ? NaN : Number(e.target.value),
                                  }
                                : v,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                {index === formula.phases.length - 1 && (
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={phase.maintenance}
                      onChange={(e) =>
                        change({
                          ...formula,
                          phases: formula.phases.map((v, i) =>
                            i === index
                              ? {
                                  ...v,
                                  maintenance: e.target.checked,
                                  durationDays: Number.isNaN(v.durationDays) ? 1 : v.durationDays,
                                }
                              : v,
                          ),
                        })
                      }
                    />
                    Manutenção sem prazo definido (total indeterminado)
                  </label>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={formula.phases.length === 1}
                  onClick={() =>
                    change({ ...formula, phases: formula.phases.filter((_, i) => i !== index) })
                  }
                >
                  Remover etapa {index + 1}
                </Button>
              </fieldset>
            ))}
            {formula.phases.length === 1 && (
              <Button
                type="button"
                variant="outline"
                disabled={formula.phases[0]?.maintenance}
                className="border-teal-300 text-teal-950"
                onClick={() =>
                  change({
                    ...formula,
                    phases: [
                      ...formula.phases,
                      {
                        doseUnits: NaN,
                        frequencyPerDay: NaN,
                        durationDays: NaN,
                        maintenance: false,
                      },
                    ],
                  })
                }
              >
                Adicionar aumento de dose
              </Button>
            )}
            {formula.phases.length > 1 && (
              <Button
                type="button"
                variant="outline"
                disabled={formula.phases.length >= 12 || formula.phases.some((p) => p.maintenance)}
                onClick={() =>
                  change({
                    ...formula,
                    phases: [
                      ...formula.phases,
                      {
                        doseUnits: NaN,
                        frequencyPerDay: NaN,
                        durationDays: NaN,
                        maintenance: false,
                      },
                    ],
                  })
                }
              >
                Adicionar etapa
              </Button>
            )}
          </div>
          <label className="block">
            Orientações adicionais
            <textarea
              className="mt-1 min-h-24 w-full rounded-xl border p-2"
              maxLength={2000}
              value={formula.instructions}
              onChange={(e) => change({ ...formula, instructions: e.target.value })}
            />
          </label>
          <Button
            type="button"
            disabled={!validComposition}
            onClick={() => {
              setActiveTab("prescription");
              void submit("PREVIEW");
            }}
          >
            Calcular e revisar composição
          </Button>
        </fieldset>
        <aside
          className="min-w-0 space-y-4 rounded-2xl border bg-teal-50/40 p-4 xl:max-h-[76dvh] xl:overflow-y-auto"
          aria-label="Prévia do documento"
        >
          <div
            role="tablist"
            aria-label="Receita e orçamento"
            className="sticky top-0 z-20 flex gap-2 border-b border-teal-100 bg-white pb-3"
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "prescription"
                  : event.key === "End"
                    ? "quote"
                    : activeTab === "prescription"
                      ? "quote"
                      : "prescription";
              if (next === "quote") setQuoteOpened(true);
              setActiveTab(next);
              document.getElementById(`${composerTabsId}-${next}-tab`)?.focus();
            }}
          >
            <Button
              type="button"
              id={`${composerTabsId}-prescription-tab`}
              role="tab"
              aria-selected={activeTab === "prescription"}
              aria-controls={`${composerTabsId}-prescription-panel`}
              tabIndex={activeTab === "prescription" ? 0 : -1}
              variant={activeTab === "prescription" ? "default" : "outline"}
              onClick={() => setActiveTab("prescription")}
            >
              Receita
            </Button>
            <Button
              type="button"
              id={`${composerTabsId}-quote-tab`}
              role="tab"
              aria-selected={activeTab === "quote"}
              aria-controls={`${composerTabsId}-quote-panel`}
              tabIndex={activeTab === "quote" ? 0 : -1}
              variant={activeTab === "quote" ? "default" : "outline"}
              onClick={() => {
                setQuoteOpened(true);
                setActiveTab("quote");
              }}
            >
              Orçamento
            </Button>
          </div>
          <div
            role="tabpanel"
            id={`${composerTabsId}-prescription-panel`}
            aria-labelledby={`${composerTabsId}-prescription-tab`}
            hidden={activeTab !== "prescription"}
            className="space-y-4"
          >
            <h3 className="border-b border-teal-200 pb-2 font-semibold text-teal-950">
              Prescrição · prévia não finalizada
            </h3>
            <fieldset
              disabled={pending}
              className="grid min-w-0 grid-cols-2 gap-2 rounded-lg border border-teal-200 bg-teal-50 p-3"
            >
              <label className="min-w-0 text-xs">
                Quantidade a dispensar
                <Input
                  className="mt-1 min-w-0 bg-white"
                  inputMode="decimal"
                  maxLength={20}
                  value={formula.dispenseQuantity ?? ""}
                  onChange={(event) => change({ ...formula, dispenseQuantity: event.target.value })}
                />
              </label>
              <label className="min-w-0 text-xs">
                Unidade de dispensação
                <Input
                  className="mt-1 min-w-0 bg-white"
                  maxLength={60}
                  list={dispenseListId}
                  value={formula.dispenseUnit ?? ""}
                  onChange={(event) => change({ ...formula, dispenseUnit: event.target.value })}
                />
              </label>
              <p className="col-span-2 text-xs text-teal-900">
                Preenchimento manual opcional. Não converte doses nem substitui a conferência da
                quantidade calculada.
              </p>
            </fieldset>
            <p className="text-xs text-muted-foreground">
              Atualização local ilustrativa. Calcule e revise no servidor antes de inserir no
              rascunho.
            </p>
            {livePreview ? (
              <>
                <pre className="whitespace-pre-wrap break-words min-h-72 whitespace-pre-wrap rounded-none border border-slate-200 bg-white p-5 font-sans text-sm shadow-sm">
                  {livePreview.text}
                </pre>
                {livePreview.warnings.map((warning) => (
                  <p key={warning} className="text-xs text-amber-900">
                    {warning}
                  </p>
                ))}
              </>
            ) : (
              <p className="rounded-xl bg-white p-4 text-muted-foreground">
                Selecione ao menos um componente e preencha a composição para visualizar o
                documento.
              </p>
            )}
            {pending && <p role="status">Processando…</p>}
            {error && (
              <p role="alert" className="text-red-700">
                {error}
              </p>
            )}
            {message && <p role="status">{message}</p>}
            {preview && (
              <section
                className="space-y-3 rounded-xl border p-3"
                aria-label="Revisão da composição"
              >
                <h3 className="font-medium">Quantidade: {preview.quantityLabel}</h3>
                {preview.warnings.map((warning) => (
                  <p key={warning} className="text-amber-900">
                    {warning}
                  </p>
                ))}
                <pre className="whitespace-pre-wrap break-words font-sans">{preview.text}</pre>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    disabled={pending}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  Conferi composição, posologia, quantidade e adequação para este paciente.
                </label>
                <Button
                  type="button"
                  disabled={pending || !reviewed}
                  onClick={() => void insertReviewed()}
                >
                  Inserir no rascunho da receita
                </Button>
                <p className="text-xs text-muted-foreground">
                  O texto será acrescentado ao rascunho selecionado. Salvar, finalizar e imprimir
                  continuam sendo ações separadas.
                </p>
              </section>
            )}
          </div>
          <div
            role="tabpanel"
            id={`${composerTabsId}-quote-panel`}
            aria-labelledby={`${composerTabsId}-quote-tab`}
            hidden={activeTab !== "quote"}
          >
            {quoteOpened && (
              <ComposerQuotePanel appointmentId={appointmentId} documentId={documentId} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
