import {
  laboratoryRowEvidenceIdentity,
  laboratoryEvidenceIssueLabels,
  type LaboratorySourceChecks,
} from "@/lib/laboratory-review-checks";
import { LABORATORY_EXTRACTION_POLICY } from "@/lib/laboratory-extraction-policy";
import { laboratoryFailureMessages } from "@/lib/laboratory-results";
import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidatePatientLaboratoryQueries } from "@/data/patient-laboratory-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { withSelectedUnit } from "@/data/unit-context";
import { InventoryError, readInventoryResponse } from "@/data/inventory-api";
import {
  emptyLaboratoryDraft,
  emptyLaboratoryRow,
  laboratoryValidationProblem,
  type LaboratoryDraft,
  type LaboratoryRow,
} from "@/lib/laboratory-results";
import { PrivateDocumentPreview } from "./private-document-preview";

type HistoricalReview = { id: string; version: number; snapshot: LaboratoryDraft };
type Data = {
  historicalReview?: HistoricalReview | null;
  evidenceChecks?: Omit<LaboratorySourceChecks, "rows"> & {
    rows: (LaboratorySourceChecks["rows"][number] | null)[];
  };
  source: { id: string; title: string; sha256: string; previewUrl: string };
  import: {
    id: string;
    status: string;
    version: number;
    draft: LaboratoryDraft;
    processing_started_at: string | null;
    failure_code: string | null;
  } | null;
  versions: { id: string; version: number; reviewer_name: string; created_at: string }[];
  events: { action: string; actor_name: string; created_at: string }[];
  extractionAvailable: boolean;
  extractionMessage: string | null;
};
const statuses: Record<string, string> = {
  WAITING: "Aguardando processamento",
  PROCESSING: "Processando",
  READY_REVIEW: "Pronto para revisão",
  VALIDATED: "Validado",
  FAILED: "Falha no processamento",
};
const eventNames: Record<string, string> = {
  OPENED: "Conferência iniciada",
  DRAFT_SAVED: "Rascunho salvo",
  PROCESSING_STARTED: "Extração iniciada",
  EXTRACTION_READY: "Extração pronta para revisão",
  EXTRACTION_FAILED: "Extração não concluída",
  VALIDATED: "Resultados confirmados",
  REOPENED: "Correção iniciada",
};
export function LaboratoryReview({
  patientId,
  documentId,
  unitId,
  onChanged,
}: {
  patientId: string;
  documentId: string;
  unitId?: string | undefined;
  onChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const editorId = useId();
  const [open, setOpen] = useState(false),
    [data, setData] = useState<Data | null>(null),
    [draft, setDraft] = useState<LaboratoryDraft>(emptyLaboratoryDraft);
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState("results");
  const [rowFilter, setRowFilter] = useState<"all" | "attention" | "unverified">("all");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [historical, setHistorical] = useState<HistoricalReview | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const currentData = useRef(data);
  currentData.current = data;
  const currentDirty = useRef(dirty);
  currentDirty.current = dirty;
  const lock = useRef(false),
    generation = useRef(0),
    requests = useRef(new Set<AbortController>()),
    operation = useRef<{ key: string; id: string } | null>(null);
  const unitQuery = unitId !== undefined ? "unitId=" + encodeURIComponent(unitId) : "";
  const endpoint = withSelectedUnit(
    "/api/v1/inventory/laboratory-results" + (unitQuery ? "?" + unitQuery : ""),
  );
  const send = useCallback(
    async (body?: Record<string, unknown>, reviewId?: string) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(
        () => controller.abort(),
        body?.["action"] === "EXTRACT" ? LABORATORY_EXTRACTION_POLICY.requestMilliseconds : 15000,
      );
      requests.current.add(controller);
      try {
        const response = await fetch(
          body
            ? endpoint
            : withSelectedUnit(
                "/api/v1/inventory/laboratory-results?patientId=" +
                  patientId +
                  "&documentId=" +
                  documentId +
                  (reviewId ? "&reviewId=" + reviewId : "") +
                  (unitQuery ? "&" + unitQuery : ""),
              ),
          {
            method: body ? "POST" : "GET",
            credentials: "same-origin",
            signal: controller.signal,
            ...(body
              ? {
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ patientId, documentId, ...body }),
                }
              : {}),
          },
        );
        const result = await readInventoryResponse<Data>(
          response,
          "Não foi possível carregar a conferência.",
        );
        if (!result.data) throw new Error("Resposta de conferência inválida.");
        return result.data;
      } finally {
        window.clearTimeout(timeout);
        requests.current.delete(controller);
      }
    },
    [endpoint, patientId, documentId, unitQuery],
  );
  const apply = useCallback((next: Data) => {
    currentData.current = next;
    currentDirty.current = false;
    setData(next);
    setDraft(next.import?.draft ?? emptyLaboratoryDraft());
    setDirty(false);
    setHistorical(null);
  }, []);
  useEffect(() => {
    if (!open) return;
    const generationRef = generation;
    const activeRequests = requests.current;
    const current = ++generationRef.current;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    void send({ action: "OPEN" })
      .then((next) => {
        if (generation.current === current) apply(next);
      })
      .catch((e) => {
        if (generation.current === current)
          setError(e instanceof Error ? e.message : "Não foi possível abrir.");
      })
      .finally(() => {
        if (generation.current === current) {
          lock.current = false;
          setBusy(false);
        }
      });
    return () => {
      generationRef.current++;
      for (const controller of activeRequests) controller.abort();
      activeRequests.clear();
      lock.current = false;
    };
  }, [open, patientId, documentId, send, apply]);
  useEffect(() => {
    if (!open || (data?.import?.status !== "PROCESSING" && pendingAction !== "EXTRACT")) return;
    const current = generation.current;
    const timer = window.setInterval(() => {
      void send()
        .then((next) => {
          if (current !== generation.current || currentDirty.current) return;
          const previous = currentData.current?.import;
          if (previous && next.import) {
            if (next.import.version < previous.version) return;
            if (next.import.version === previous.version) {
              // Refresh the processing clock without resetting the editor. Late,
              // unchanged polls must never replace a terminal or edited draft.
              if (previous.status === "PROCESSING") setData(next);
              return;
            }
          }
          apply(next);
          if (next.import?.status !== "PROCESSING") {
            setError("");
            setMessage(
              next.import?.status === "READY_REVIEW"
                ? "Extração concluída. Confira os resultados antes de confirmar."
                : "Processamento encerrado. Consulte o estado da extração.",
            );
            void invalidatePatientLaboratoryQueries(queryClient, patientId);
            changed.current?.();
          }
        })
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [open, data?.import?.status, pendingAction, patientId, documentId, send, apply, queryClient]);
  async function run(action: string) {
    if (lock.current || !data?.import) return;
    const current = generation.current;
    lock.current = true;
    setBusy(true);
    setPendingAction(action);
    setError("");
    setMessage("");
    try {
      let latest = data;
      if (action === "VALIDATE" && dirty) {
        latest = await send({ action: "SAVE", version: latest.import!.version, draft });
        if (current !== generation.current) return;
        apply(latest);
      }
      const key = action + ":" + latest.import!.version;
      if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
      const next = await send({
        action,
        version: latest.import!.version,
        ...(action === "SAVE" ? { draft } : {}),
        ...(["VALIDATE", "EXTRACT"].includes(action) ? { operationId: operation.current.id } : {}),
      });
      if (current !== generation.current) return;
      apply(next);
      void invalidatePatientLaboratoryQueries(queryClient, patientId);
      changed.current?.();
      setMessage(
        action === "VALIDATE"
          ? "Resultados confirmados. A versão anterior permanece preservada."
          : action === "SAVE"
            ? "Rascunho salvo. Ainda não foi incorporado ao histórico clínico."
            : action === "REOPEN"
              ? "Correção aberta. Confira novamente o paciente e as linhas."
              : "Processamento atualizado.",
      );
    } catch (e) {
      if (
        action === "EXTRACT" &&
        current === generation.current &&
        (!(e instanceof InventoryError) || e.status >= 500 || e.status < 400)
      ) {
        // A lost HTTP response is not permission to launch a second paid call.
        // Reconcile against the versioned job and continue polling if necessary.
        try {
          const recovered = await send();
          if (current !== generation.current) return;
          if (
            recovered.import &&
            recovered.import.version > data.import.version &&
            ["PROCESSING", "READY_REVIEW", "FAILED"].includes(recovered.import.status)
          ) {
            apply(recovered);
            setError("");
            setMessage(
              recovered.import.status === "PROCESSING"
                ? "A extração continua no servidor. Acompanhando o processamento sem repetir o envio."
                : recovered.import.status === "READY_REVIEW"
                  ? "Extração concluída. Confira os resultados antes de confirmar."
                  : "Processamento encerrado. Consulte o estado da extração.",
            );
            void invalidatePatientLaboratoryQueries(queryClient, patientId);
            changed.current?.();
            return;
          }
        } catch {
          // Keep the original error and draft if status recovery also fails.
        }
      }
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      if (current === generation.current) {
        lock.current = false;
        setBusy(false);
        setPendingAction(null);
      }
    }
  }
  function edit(index: number, patch: Partial<LaboratoryRow>) {
    setDraft((previous) => ({
      ...previous,
      rows: previous.rows.map((row, i) =>
        i === index
          ? { ...row, ...patch, ...("verified" in patch ? {} : { verified: false }) }
          : row,
      ),
    }));
    currentDirty.current = true;
    setDirty(true);
  }
  const status = data?.import?.status,
    validated = status === "VALIDATED",
    processing = status === "PROCESSING";
  const stale =
    processing &&
    data?.import?.processing_started_at &&
    Date.now() - new Date(data.import.processing_started_at).getTime() >
      LABORATORY_EXTRACTION_POLICY.staleMilliseconds;
  const editable = !!data?.import && !busy && !validated && !processing && !historical;
  useEffect(() => {
    const publish = (dirty: boolean, pending: boolean) =>
      window.dispatchEvent(
        new CustomEvent("allik:clinical-file-draft-state", {
          detail: { editorId, patientId, dirty, pending },
        }),
      );
    publish(open && dirty, open && busy);
    return () => {
      publish(false, false);
    };
  }, [editorId, patientId, open, dirty, busy]);
  useEffect(() => {
    if (!open || (!dirty && !busy)) return;
    const preventClose = (event: Event) => {
      const detail = (event as CustomEvent<{ patientId?: string }>).detail;
      if (detail?.patientId && detail.patientId !== patientId) return;
      event.preventDefault();
      setError("Salve ou descarte explicitamente a conferência antes de sair.");
    };
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("allik:before-clinical-file-close", preventClose);
    window.addEventListener("allik:before-unit-change", preventClose);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("allik:before-clinical-file-close", preventClose);
      window.removeEventListener("allik:before-unit-change", preventClose);
      window.removeEventListener("beforeunload", unload);
    };
  }, [open, dirty, busy, patientId]);
  const shownDraft = historical?.snapshot ?? draft;
  const problem = laboratoryValidationProblem(draft);
  const rowCheck = (row: LaboratoryRow, index: number) => {
    if (historical) return null;
    const saved = data?.import?.draft.rows[index];
    return saved && laboratoryRowEvidenceIdentity(saved) === laboratoryRowEvidenceIdentity(row)
      ? (data?.evidenceChecks?.rows[index] ?? null)
      : null;
  };
  const eligible = (row: LaboratoryRow, index: number) => {
    const check = rowCheck(row, index);
    return (
      !!row.name.trim() &&
      !!row.result.trim() &&
      !row.uncertainty?.trim() &&
      check?.basis === "source_text" &&
      check.status === "literal_match"
    );
  };
  const bulkCount = shownDraft.rows.filter(
    (row, index) => !row.verified && eligible(row, index),
  ).length;
  const needsAttention = (row: LaboratoryRow, index: number) =>
    !!row.uncertainty?.trim() ||
    !row.name.trim() ||
    !row.result.trim() ||
    (!row.verified && !eligible(row, index));
  const attentionCount = shownDraft.rows.filter(needsAttention).length;
  const visibleRows = shownDraft.rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row, index }) =>
        rowFilter === "all" ||
        (rowFilter === "unverified" ? !row.verified : needsAttention(row, index)),
    );

  const field = (
    row: LaboratoryRow,
    index: number,
    key: keyof LaboratoryRow,
    label: string,
    type = "text",
  ) => (
    <label className="space-y-1 text-xs" key={key}>
      {label}
      <Input
        type={type}
        aria-label={label + " da linha " + (index + 1)}
        value={String(row[key] ?? "")}
        disabled={!editable}
        onChange={(e) =>
          edit(index, {
            [key]:
              key === "sourcePage"
                ? e.target.value
                  ? Number(e.target.value)
                  : null
                : e.target.value || null,
          })
        }
      />
    </label>
  );
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Conferir resultados laboratoriais
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (
            !value &&
            dirty &&
            !window.confirm("Descartar alterações que ainda não foram salvas?")
          )
            return;
          setOpen(value);
        }}
      >
        <DialogContent className="flex h-[94dvh] w-[96vw] max-w-[96vw] flex-col overflow-hidden p-4 sm:max-w-[96vw]">
          <DialogHeader>
            <DialogTitle>Conferência de exames laboratoriais</DialogTitle>
            <DialogDescription>
              Confira o PDF e cada resultado antes de confirmar. A extração não é diagnóstico nem
              validação clínica.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-teal-50 px-3 py-1 text-sm text-teal-900">
              {status ? statuses[status] : "Abrindo…"}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">{data?.source.title}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || dirty}
              onClick={async () => {
                try {
                  apply(await send());
                  setError("");
                } catch {
                  setError("Não foi possível atualizar.");
                }
              }}
            >
              Atualizar
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="text-sm text-teal-800">
              {message}
            </p>
          )}
          {!!data?.versions.length && (
            <label className="flex items-center gap-2 text-sm">
              Versão da conferência
              <select
                aria-label="Versão da conferência"
                className="max-w-full rounded border p-1"
                disabled={busy}
                value={historical?.id ?? ""}
                onChange={async (e) => {
                  const id = e.target.value;
                  if (!id) {
                    setHistorical(null);
                    return;
                  }
                  const current = generation.current;
                  try {
                    const next = await send(undefined, id);
                    if (current === generation.current)
                      setHistorical(next.historicalReview ?? null);
                  } catch {
                    setError("Não foi possível abrir a versão anterior.");
                  }
                }}
              >
                <option value="">Conferência atual</option>
                {data.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    Versão {v.version} — somente leitura
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex gap-2 lg:hidden" role="tablist" aria-label="Original e resultados">
            <Button
              role="tab"
              aria-selected={tab === "pdf"}
              variant={tab === "pdf" ? "default" : "outline"}
              onClick={() => setTab("pdf")}
            >
              PDF original
            </Button>
            <Button
              role="tab"
              aria-selected={tab === "results"}
              variant={tab === "results" ? "default" : "outline"}
              onClick={() => setTab("results")}
            >
              Resultados
            </Button>
          </div>
          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(260px,.8fr)_minmax(0,1.5fr)]">
            <aside
              aria-label="PDF original do exame"
              className={
                (tab === "pdf" ? "block " : "hidden ") +
                "min-w-0 overflow-auto rounded-lg border p-2 lg:block"
              }
            >
              {data && (
                <>
                  <PrivateDocumentPreview
                    document={{
                      title: data.source.title,
                      contentType: "application/pdf",
                      previewUrl: data.source.previewUrl,
                    }}
                  />
                  <a
                    className="text-sm text-teal-800 underline"
                    href={withSelectedUnit(data.source.previewUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir original em outra aba
                  </a>
                </>
              )}
            </aside>
            <section
              aria-label="Resultados em conferência"
              className={
                (tab === "results" ? "block " : "hidden ") +
                "min-w-0 space-y-3 overflow-auto lg:block"
              }
            >
              {data?.extractionMessage && (
                <p className="text-sm text-muted-foreground">{data.extractionMessage}</p>
              )}
              {status === "FAILED" && (
                <p role="alert" className="text-sm text-amber-900">
                  {laboratoryFailureMessages[data?.import?.failure_code ?? ""] ??
                    "A extração não foi concluída."}{" "}
                  O original está preservado e a conferência manual continua disponível.
                </p>
              )}
              {pendingAction === "EXTRACT" && !processing && (
                <p role="status" className="text-sm">
                  Iniciando extração do PDF…
                </p>
              )}
              {processing && (
                <p role="status" className="text-sm">
                  {stale
                    ? "A tentativa anterior não terminou. Você pode tentar novamente."
                    : "Processando as páginas do PDF. Pode levar até 3 minutos. Os resultados ainda não fazem parte do histórico clínico."}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {data?.extractionAvailable &&
                  !draft.rows.length &&
                  (!processing || stale) &&
                  !validated && (
                    <Button disabled={busy} onClick={() => void run("EXTRACT")}>
                      Extrair resultados com IA
                    </Button>
                  )}
                {validated ? (
                  <Button
                    disabled={busy || !!historical}
                    variant="outline"
                    onClick={() => void run("REOPEN")}
                  >
                    Corrigir resultados
                  </Button>
                ) : (
                  <Button
                    disabled={!editable || draft.rows.length >= 200}
                    variant="outline"
                    onClick={() => {
                      setDraft((p) => ({ ...p, rows: [...p.rows, emptyLaboratoryRow()] }));
                      currentDirty.current = true;
                      setDirty(true);
                    }}
                  >
                    Adicionar resultado
                  </Button>
                )}
                {!validated && (
                  <Button
                    disabled={!editable || !bulkCount}
                    variant="outline"
                    onClick={() => {
                      setDraft((p) => ({
                        ...p,
                        rows: p.rows.map((r, index) => ({
                          ...r,
                          verified: r.verified || eligible(r, index),
                        })),
                      }));
                      currentDirty.current = true;
                      setDirty(true);
                    }}
                  >
                    Conferi as {bulkCount} linhas sem pendências
                  </Button>
                )}
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={shownDraft.patientConfirmed}
                  disabled={!editable}
                  onChange={(e) => {
                    setDraft((p) => ({ ...p, patientConfirmed: e.target.checked }));
                    currentDirty.current = true;
                    setDirty(true);
                  }}
                />
                Confirmei que o PDF corresponde ao paciente selecionado.
              </label>
              {!shownDraft.rows.length && (
                <p className="py-6 text-sm text-muted-foreground">
                  Nenhum resultado estruturado ainda. Extraia do PDF ou adicione as linhas para
                  conferência.
                </p>
              )}
              {!!shownDraft.rows.length && (
                <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                  <p className="text-sm" role="status">
                    {shownDraft.rows.length} resultados ·{" "}
                    {shownDraft.rows.filter((row) => row.verified).length} conferidos ·{" "}
                    {attentionCount} para atenção individual
                  </p>
                  <div
                    className="flex flex-wrap gap-2"
                    aria-label="Filtrar resultados da conferência"
                  >
                    {(
                      [
                        ["all", "Todos"],
                        ["attention", "Atenção individual"],
                        ["unverified", "Não conferidos"],
                      ] as const
                    ).map(([value, label]) => (
                      <Button
                        key={value}
                        size="sm"
                        variant={rowFilter === value ? "secondary" : "ghost"}
                        aria-pressed={rowFilter === value}
                        onClick={() => setRowFilter(value)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A checagem compara trechos literais ao texto do PDF; não comprova completude nem
                    interpretação clínica. Confira o original antes de confirmar em lote.
                    {data?.evidenceChecks?.parserStatus !== "available" &&
                      " Sem texto independente disponível: faça a conferência individual pelo original."}
                  </p>
                </div>
              )}
              {!!shownDraft.rows.length && !visibleRows.length && (
                <p className="text-sm">Nenhum resultado neste filtro.</p>
              )}
              <div className="max-w-full overflow-auto">
                <table
                  className="w-full text-left text-sm"
                  aria-label="Tabela de conferência de resultados"
                >
                  <thead className="sticky top-0 bg-white [&_th]:px-2 [&_th]:py-2">
                    <tr>
                      <th>Conferido</th>
                      <th>Exame</th>
                      <th>Resultado literal</th>
                      <th>Unidade</th>
                      <th>Referência</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(({ row, index }) => (
                      <Fragment key={index}>
                        <tr className="border-t align-top">
                          <td className="p-1">
                            <input
                              type="checkbox"
                              aria-label={"Conferir linha " + (index + 1)}
                              disabled={!editable}
                              checked={row.verified}
                              onChange={(e) => edit(index, { verified: e.target.checked })}
                            />
                          </td>
                          <td className="min-w-36 p-1">
                            <Input
                              aria-label={"Exame da linha " + (index + 1)}
                              value={row.name}
                              disabled={!editable}
                              onChange={(e) => edit(index, { name: e.target.value })}
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                              {row.verified && !needsAttention(row, index)
                                ? "Conferido pelo profissional"
                                : eligible(row, index)
                                  ? "Trecho localizado no PDF"
                                  : "Conferência individual"}
                              {row.sourcePage ? " · pág. " + row.sourcePage : ""}
                            </p>
                            {needsAttention(row, index) && (
                              <p className="mt-1 text-xs text-amber-800">
                                {rowCheck(row, index)
                                  ?.issues.map(
                                    (issue) =>
                                      laboratoryEvidenceIssueLabels[issue] ?? "Verifique a origem",
                                  )
                                  .join(" · ") ||
                                  "Origem não localizada automaticamente ou linha editada"}
                              </p>
                            )}
                          </td>
                          <td className="min-w-32 p-1">
                            <Input
                              aria-label={"Resultado da linha " + (index + 1)}
                              value={row.result}
                              disabled={!editable}
                              onChange={(e) => edit(index, { result: e.target.value })}
                            />
                          </td>
                          <td className="min-w-24 p-1">
                            <Input
                              aria-label={"Unidade da linha " + (index + 1)}
                              value={row.unit ?? ""}
                              disabled={!editable}
                              onChange={(e) => edit(index, { unit: e.target.value || null })}
                            />
                          </td>
                          <td className="min-w-40 p-1">
                            <Input
                              aria-label={"Referência da linha " + (index + 1)}
                              value={row.reference ?? ""}
                              disabled={!editable}
                              onChange={(e) => edit(index, { reference: e.target.value || null })}
                            />
                          </td>
                          <td className="p-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!editable}
                              onClick={() => {
                                setDraft((p) => ({
                                  ...p,
                                  rows: p.rows.filter((_, i) => i !== index),
                                }));
                                currentDirty.current = true;
                                setDirty(true);
                              }}
                            >
                              Excluir
                            </Button>
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={6} className="pb-3">
                            <details className="rounded bg-slate-50 p-2">
                              <summary className="cursor-pointer text-xs">
                                Datas, método, laboratório e origem
                                {row.uncertainty ? " · Pendência para resolver" : ""}
                              </summary>
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                {field(row, index, "collectedOn", "Coleta", "date")}
                                {field(row, index, "reportedOn", "Resultado em", "date")}
                                {field(row, index, "laboratory", "Laboratório")}
                                {field(row, index, "method", "Método")}
                                {field(row, index, "material", "Material")}
                                {field(row, index, "sourcePage", "Página", "number")}
                                {field(row, index, "evidence", "Trecho de origem")}
                                {field(
                                  row,
                                  index,
                                  "uncertainty",
                                  "Pendência (limpe após resolver)",
                                )}
                              </div>
                            </details>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="block space-y-1 text-sm">
                Observações da conferência
                <textarea
                  className="w-full rounded-md border p-2"
                  maxLength={2000}
                  disabled={!editable}
                  value={shownDraft.notes}
                  onChange={(e) => {
                    setDraft((p) => ({ ...p, notes: e.target.value }));
                    currentDirty.current = true;
                    setDirty(true);
                  }}
                />
              </label>
              {data?.versions.length ? (
                <details className="text-sm">
                  <summary>Histórico de versões ({data.versions.length})</summary>
                  <ul>
                    {data.versions.map((v) => (
                      <li key={v.id}>
                        Versão {v.version} · {v.reviewer_name} ·{" "}
                        {new Date(v.created_at).toLocaleString("pt-BR")}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {data?.events.length ? (
                <details className="text-xs text-muted-foreground">
                  <summary>Atividade recente</summary>
                  <ul>
                    {data.events.map((e, i) => (
                      <li key={i}>
                        {eventNames[e.action] ?? e.action} · {e.actor_name} ·{" "}
                        {new Date(e.created_at).toLocaleString("pt-BR")}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          </div>
          {!validated && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
              <span className="min-w-0 basis-full text-xs text-muted-foreground sm:flex-1 sm:basis-0">
                {problem ?? "Conferência completa. Confirme para incorporar os resultados."}
              </span>
              <Button
                variant="outline"
                disabled={!editable || !dirty}
                onClick={() => void run("SAVE")}
              >
                Salvar rascunho
              </Button>
              <Button disabled={!editable || !!problem} onClick={() => void run("VALIDATE")}>
                {busy ? "Salvando…" : "Confirmar resultados"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
