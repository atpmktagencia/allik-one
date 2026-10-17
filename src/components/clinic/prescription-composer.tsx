import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import {
  composePrescription,
  prescriptionFormulaSchema,
  type PrescriptionComposition,
  type PrescriptionFormula,
  type PrescriptionProtocol,
} from "@/data/prescription-composer";
import { InventoryState } from "./inventory-state";

const emptyIngredient = () => ({
  medicationName: "",
  dose: "",
  doseUnit: "",
  individualCapsule: false,
});
const emptyPhase = () => ({
  doseUnits: 1,
  frequencyPerDay: 1,
  durationDays: 1,
  maintenance: false,
});
const emptyFormula = (): PrescriptionFormula => ({
  ingredients: [emptyIngredient()],
  route: "",
  presentation: "",
  instructions: "",
  phases: [emptyPhase()],
});

/** Produces reviewed text only. Saving/finalizing the clinical document remains explicit. */
export function PrescriptionComposer({
  appointmentId,
  onInsert,
}: {
  appointmentId: string;
  onInsert: (text: string) => void;
}) {
  const query = useInventory<{ templates: PrescriptionProtocol[]; canCompose: boolean }>(
    `prescription-composer?appointmentId=${encodeURIComponent(appointmentId)}`,
  );
  const [formula, setFormula] = useState<PrescriptionFormula>(emptyFormula);
  const [title, setTitle] = useState("");
  const [protocol, setProtocol] = useState<PrescriptionProtocol | null>(null);
  const [preview, setPreview] = useState<PrescriptionComposition | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());
  const [search, setSearch] = useState("");
  const drag = useRef<{ pointerId: number; selected: boolean } | null>(null);
  const pointerClick = useRef(false);
  const suppressionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function selectIngredient(index: number, selected: boolean) {
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
    setProtocol(item);
    setTitle(item?.title ?? "");
    setExcluded(new Set());
    change(item ? structuredClone(item.formula) : emptyFormula());
  }
  function change(value: PrescriptionFormula) {
    setFormula(value);
    setPreview(null);
    setReviewed(false);
    setError("");
    setMessage("");
  }
  async function submit(action: "PREVIEW" | "SAVE" | "ARCHIVE") {
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
    if (action === "SAVE" && !title.trim()) {
      setError("Informe um nome para o protocolo pessoal.");
      return;
    }
    if (
      action === "SAVE" &&
      !window.confirm(
        "O protocolo é reutilizável. Confirme que não contém nomes nem dados pessoais do paciente.",
      )
    )
      return;
    if (
      action === "ARCHIVE" &&
      (!protocol ||
        !window.confirm(
          "Arquivar este protocolo pessoal? Receitas já elaboradas serão preservadas.",
        ))
    )
      return;
    lock.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/inventory/prescription-composer", {
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
                  title,
                  formula: selectedFormula,
                  ...(protocol ? { id: protocol.id, version: protocol.version } : {}),
                }
              : { id: protocol!.id, version: protocol!.version }),
        }),
      });
      const result = await readInventoryResponse<
        PrescriptionComposition & { id: string; version: number }
      >(response, "Não foi possível processar a composição.");
      if (!result.data) throw new Error("Não foi possível confirmar a operação.");
      if (action === "PREVIEW") {
        setPreview(result.data);
        setReviewed(false);
      } else {
        await query.refetch();
        if (action === "SAVE")
          setProtocol({
            id: result.data.id,
            version: result.data.version,
            title,
            formula: selectedFormula,
          });
        else {
          setProtocol(null);
          setTitle("");
        }
        setMessage(action === "SAVE" ? "Protocolo pessoal salvo." : "Protocolo arquivado.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível processar a composição.");
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
      <p className="rounded-xl bg-amber-50 p-3">
        Informe a composição por unidade de administração e confira cada etapa. Este recurso calcula
        quantidades; não recomenda doses, avalia compatibilidade ou define o tipo de receituário.
      </p>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(220px,.8fr)_minmax(360px,1.5fr)_minmax(280px,1fr)]">
        {" "}
        <fieldset
          disabled={pending}
          className="min-w-0 space-y-4 rounded-2xl border bg-slate-50/60 p-4 xl:max-h-[76dvh] xl:overflow-y-auto"
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
          <label className="block">
            Protocolo pessoal
            <select
              className="mt-1 w-full rounded-xl border bg-white p-2"
              value={protocol?.id ?? ""}
              onChange={(event) => {
                const item = query.data?.templates.find((t) => t.id === event.target.value);
                loadProtocol(item ?? null);
              }}
            >
              <option value="">Nova composição</option>
              {query.data.templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · v{item.version}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-48 flex-1">
              Nome do protocolo pessoal
              <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <Button type="button" variant="outline" onClick={() => void submit("SAVE")}>
              Salvar protocolo
            </Button>
            {protocol && (
              <Button type="button" variant="outline" onClick={() => void submit("ARCHIVE")}>
                Arquivar protocolo
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Exibindo até os 100 protocolos pessoais atualizados mais recentemente. Protocolos são
            pessoais. Não inclua dados que identifiquem o paciente.
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
            {query.data.templates
              .filter((item) =>
                item.title.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")),
              )
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={protocol?.id === item.id}
                  className="block w-full rounded-xl border bg-white p-3 text-left hover:border-blue-400 aria-pressed:border-blue-500"
                  onClick={() => loadProtocol(item)}
                >
                  <span className="block font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground">
                    Versão {item.version} · {item.formula.ingredients.length} componente(s)
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
          <div className="space-y-3">
            <h3 className="font-medium">Componentes por unidade de administração</h3>
            {formula.ingredients.map((ingredient, index) => (
              <fieldset key={index} className="space-y-1 rounded-xl border p-2">
                <legend>Componente {index + 1}</legend>
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 p-2"
                  data-composer-selector={index}
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
                      drag.current = { pointerId: event.pointerId, selected: excluded.has(index) };
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
                  {excluded.has(index)
                    ? "Excluído desta composição · valores preservados"
                    : "Incluir nesta composição"}
                </label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      ["medicationName", "Nome do componente", 160],
                      ["dose", "Quantidade por unidade", 20],
                      ["doseUnit", "Unidade da quantidade (ex.: mg)", 40],
                    ] as const
                  ).map(([key, label, max]) => (
                    <label key={key} className="min-w-0 text-xs">
                      <span className="sr-only">{label}</span>
                      <Input
                        className="h-8 min-w-0 text-sm"
                        placeholder={label}
                        value={ingredient[key]}
                        maxLength={max}
                        inputMode={key === "dose" ? "decimal" : undefined}
                        onChange={(e) =>
                          change({
                            ...formula,
                            ingredients: formula.ingredients.map((v, i) =>
                              i === index ? { ...v, [key]: e.target.value } : v,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer py-1 text-muted-foreground">
                    Opções do componente
                  </summary>
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
                </details>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={formula.ingredients.length >= 30}
              onClick={() =>
                change({ ...formula, ingredients: [...formula.ingredients, emptyIngredient()] })
              }
            >
              Adicionar componente
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              Apresentação (unidade de administração)
              <Input
                maxLength={100}
                value={formula.presentation}
                onChange={(e) => change({ ...formula, presentation: e.target.value })}
              />
            </label>
            <label>
              Via de administração
              <Input
                maxLength={100}
                value={formula.route}
                onChange={(e) => change({ ...formula, route: e.target.value })}
              />
            </label>
          </div>
          <div className="space-y-3">
            <h3 className="font-medium">Etapas em sequência</h3>
            {formula.phases.map((phase, index) => (
              <fieldset key={index} className="space-y-2 rounded-xl border p-3">
                <legend>Etapa {index + 1}</legend>
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
            <Button
              type="button"
              variant="outline"
              disabled={formula.phases.length >= 12 || formula.phases.some((p) => p.maintenance)}
              onClick={() => change({ ...formula, phases: [...formula.phases, emptyPhase()] })}
            >
              Adicionar etapa
            </Button>
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
          <Button type="button" disabled={!validComposition} onClick={() => void submit("PREVIEW")}>
            Calcular e revisar composição
          </Button>
        </fieldset>
        <aside
          className="min-w-0 space-y-4 rounded-2xl border bg-slate-50 p-4 xl:max-h-[76dvh] xl:overflow-y-auto"
          aria-label="Prévia do documento"
        >
          <h3 className="font-semibold">Prévia — não finalizado</h3>
          <p className="text-xs text-muted-foreground">
            Atualização local ilustrativa. Calcule e revise no servidor antes de inserir no
            rascunho.
          </p>
          {livePreview ? (
            <>
              <pre className="whitespace-pre-wrap break-words rounded-xl border bg-white p-4 font-sans text-sm">
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
              Selecione ao menos um componente e preencha a composição para visualizar o documento.
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
            <section className="space-y-3 rounded-xl border p-3" aria-label="Revisão da composição">
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
                onClick={() => onInsert(preview.text)}
              >
                Inserir no rascunho da receita
              </Button>
              <p className="text-xs text-muted-foreground">
                O texto será acrescentado ao rascunho selecionado. Salvar, finalizar e imprimir
                continuam sendo ações separadas.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
