import { DocumentClassification } from "./document-classification";
import { classificationLabel, type ClassificationView } from "@/lib/document-classification-view";
import { useQueryClient } from "@tanstack/react-query";
import { LaboratoryHistory, type LaboratoryHistoryViewState } from "./laboratory-history";
import { PrivateDocumentPreview } from "./private-document-preview";
import { LaboratoryReview } from "./laboratory-review";
import { useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Files } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import { selectedUnitId, withSelectedUnit } from "@/data/unit-context";
import { PatientDocumentUpload, type DocumentUploadState } from "./patient-document-upload";
import { InventoryState } from "./inventory-state";

type Category = { id: string; name: string; builtin: boolean };
export type PatientDocument = {
  id: string;
  sourceKind: string;
  sourceId: string;
  revision: number | null;
  title: string;
  categories: string[];
  occurredAt: string;
  receivedAt?: string | null;
  classificationPending?: boolean;
  classification?: ClassificationView | null;
  classificationAvailable?: boolean;
  professionalId: string | null;
  professionalName: string;
  unitId?: string;
  unitName: string;
  status: string;
  laboratoryStatus?: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  previewUrl: string | null;
  downloadUrl: string | null;
  originUrl: string | null;
};
export type PatientDocumentsPayload = {
  documents: PatientDocument[];
  categories: Category[];
  professionals: { id: string; name: string }[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  canUpload: boolean;
  canManageCategories: boolean;
};
const initialFilters = {
  search: "",
  category: "",
  dateFrom: "",
  dateTo: "",
  professionalId: "",
  sort: "date",
};
export type PatientDocumentCenterViewState = {
  scope: string;
  filters: typeof initialFilters;
  search: string;
  offset: number;
  mode: "list" | "table";
  selected: PatientDocument | null;
  examPane: "files" | "history";
  laboratoryHistory: MutableRefObject<LaboratoryHistoryViewState | null>;
  uploadState?: MutableRefObject<DocumentUploadState>;
};
const sourceNames: Record<string, string> = {
  CLINICAL_DOCUMENT: "Documento do atendimento",
  STRUCTURED_PRESCRIPTION: "Prescrição estruturada",
  UPLOADED_PRESCRIPTION: "Prescrição anexada",
  PLAN_QUOTE: "Estimativa de plano",
  LEGACY_QUOTE: "Orçamento do atendimento",
  CLINICAL_PLAN: "Plano clínico",
  PRECONSULTATION_RESPONSE: "Resposta de pré-consulta",
  GENERAL_DOCUMENT: "Arquivo anexado",
};
const statusNames: Record<string, string> = {
  FINAL: "Finalizado",
  AVAILABLE: "Original disponível",
  SUPERSEDED: "Substituído",
  REVOKED: "Revogado",
  COMPLETED: "Concluído",
  DRAFT: "Rascunho",
  ACTIVE: "Ativo",
  ARCHIVED: "Arquivado",
  SUBMITTED: "Respondido",
  UPLOADED: "Original recebido",
  STORED: "Armazenado",
  WAITING: "Aguardando",
  PROCESSING: "Processando",
  READY_REVIEW: "Pronto para revisão",
  VALIDATED: "Validado",
  FAILED: "Falhou",
};
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "America/Fortaleza" }).format(
    new Date(value),
  );
function safeUrl(value: string | null) {
  if (!value || !value.startsWith("/api/v1/inventory/") || value.startsWith("//")) return null;
  return withSelectedUnit(value);
}

export function PatientDocumentCenter({
  patientId,
  examsOnly = false,
  unitId: requestedUnitId,
  active = true,
  viewState,
}: {
  patientId: string;
  examsOnly?: boolean;
  unitId?: string | undefined;
  active?: boolean;
  viewState?: MutableRefObject<PatientDocumentCenterViewState | null>;
}) {
  const client = useQueryClient();
  const uploadScope = `${patientId}:${requestedUnitId ?? selectedUnitId()}`;
  const scope = `${patientId}:${requestedUnitId ?? selectedUnitId()}:${examsOnly}`;
  const remembered = viewState?.current?.scope === scope ? viewState.current : null;
  const historyViewState = useRef<LaboratoryHistoryViewState | null>(
    remembered?.laboratoryHistory.current ?? null,
  );
  const [examPane, setExamPane] = useState<"files" | "history">(remembered?.examPane ?? "files");
  const [filters, setFilters] = useState(remembered?.filters ?? initialFilters);
  const [search, setSearch] = useState(remembered?.search ?? "");
  const [offset, setOffset] = useState(remembered?.offset ?? 0);
  const [mode, setMode] = useState<"list" | "table">(remembered?.mode ?? "list");
  const [selected, setSelected] = useState<PatientDocument | null>(remembered?.selected ?? null);
  const detailRef = useRef<HTMLElement>(null);
  const uploadState = useMemo(
    () => ({
      current: viewState?.current?.scope.startsWith(uploadScope + ":")
        ? (viewState.current.uploadState?.current ?? { items: [] })
        : { items: [] },
    }),
    [uploadScope, viewState],
  );
  const [categoryName, setCategoryName] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [unitId, setUnitId] = useState(selectedUnitId);
  const generation = useRef(0);
  const lock = useRef(false);
  const id = useId();
  const mountedScope = useRef(scope);
  useEffect(() => {
    if (viewState)
      viewState.current = {
        scope,
        filters,
        search,
        offset,
        mode,
        selected,
        examPane,
        laboratoryHistory: historyViewState,
        uploadState,
      };
  }, [viewState, scope, filters, search, offset, mode, selected, examPane, uploadState]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((previous) => (previous.search === search ? previous : { ...previous, search }));
      if (filters.search !== search) setOffset(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, filters.search]);
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
    };
    const reset = () => {
      invalidate();
      setUnitId(selectedUnitId());
      setSelected(null);
      setExamPane("files");
      setFilters(initialFilters);
      setSearch("");
      setOffset(0);
      setMessage("");
      setError("");
      setPending(false);
      lock.current = false;
      historyViewState.current = null;
    };
    if (mountedScope.current !== scope) reset();
    mountedScope.current = scope;
    window.addEventListener("inventory-unit-change", reset);
    return () => {
      invalidate();
      window.removeEventListener("inventory-unit-change", reset);
    };
  }, [patientId, requestedUnitId, scope]);
  const previousExamsOnly = useRef(examsOnly);
  useEffect(() => {
    if (previousExamsOnly.current === examsOnly) return;
    previousExamsOnly.current = examsOnly;
    setSelected(null);
    setOffset(0);
    setFilters(initialFilters);
    setSearch("");
    setMessage("");
    setError("");
    setExamPane("files");
  }, [examsOnly]);
  useEffect(() => {
    if (selected && window.innerWidth < 1280)
      detailRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [selected]);
  const params = new URLSearchParams({
    patientId,
    offset: String(offset),
    limit: "25",
    sort: filters.sort,
  });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (examsOnly) params.set("categoryGroup", "EXAMS");
  if (requestedUnitId !== undefined) params.set("unitId", requestedUnitId);
  const query = useInventory<PatientDocumentsPayload>(`patient-documents?${params}`, {
    enabled: active,
    refetchInterval: (q) =>
      active &&
      q.state.data?.documents.some((d) =>
        ["RECEIVED", "STARTED", "RETRY_REQUESTED"].includes(d.classification?.action ?? ""),
      )
        ? 2000
        : false,
  });
  const data = query.data;
  const selectedView = data?.documents.find((d) => d.id === selected?.id) ?? selected;
  const [reviewDocumentId, setReviewDocumentId] = useState<string | null>(null);
  function filter(key: keyof typeof filters, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setOffset(0);
  }
  async function openReceived(documentId: string) {
    const current = generation.current;
    try {
      const response = await fetch(
        withSelectedUnit(
          "/api/v1/inventory/patient-documents?patientId=" +
            encodeURIComponent(patientId) +
            "&documentId=" +
            encodeURIComponent(documentId) +
            (requestedUnitId !== undefined ? "&unitId=" + encodeURIComponent(requestedUnitId) : ""),
        ),
        { credentials: "same-origin" },
      );
      const result = await readInventoryResponse<PatientDocumentsPayload>(
        response,
        "Não foi possível abrir o documento.",
      );
      if (current === generation.current && result.data?.documents[0])
        setSelected(result.data.documents[0]);
      else if (current === generation.current) setError("Documento não disponível neste contexto.");
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : "Não foi possível abrir.");
    }
  }
  async function mutate(body: FormData | Record<string, unknown>, done: () => void) {
    if (lock.current) return;
    const current = generation.current;
    lock.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        withSelectedUnit(
          "/api/v1/inventory/patient-documents" +
            (requestedUnitId !== undefined ? "?unitId=" + encodeURIComponent(requestedUnitId) : ""),
        ),
        {
          method: "POST",
          credentials: "same-origin",
          ...(body instanceof FormData
            ? { body }
            : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        },
      );
      await readInventoryResponse(response, "Não foi possível salvar o documento.");
      if (current !== generation.current) return;
      done();
      await query.refetch();
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    } finally {
      if (current === generation.current) {
        lock.current = false;
        setPending(false);
      }
    }
  }
  if (!data)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const showHistory = examsOnly && data.canUpload === true && examPane === "history";
  const categories = new Map(data.categories.map((category) => [category.id, category.name]));
  return (
    <section
      aria-label={examsOnly ? "Documentos de exames" : "Documentos do paciente"}
      className="min-w-0"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold">{examsOnly ? "Exames" : "Documentos"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {examsOnly
              ? "Solicitações, arquivos, conferência e histórico comparativo dos resultados confirmados."
              : "Registros e arquivos deste paciente, preservados em suas fontes de origem."}
          </p>
        </div>
      </div>
      {examsOnly && data.canUpload === true && (
        <nav aria-label="Visualizações de exames" className="mb-4 flex flex-wrap gap-2">
          <Button
            variant={examPane === "files" ? "secondary" : "ghost"}
            aria-pressed={examPane === "files"}
            onClick={() => setExamPane("files")}
          >
            Pedidos e arquivos
          </Button>
          <Button
            variant={examPane === "history" ? "secondary" : "ghost"}
            aria-pressed={examPane === "history"}
            onClick={() => setExamPane("history")}
          >
            Histórico de resultados
          </Button>
        </nav>
      )}
      {showHistory && (
        <LaboratoryHistory
          key={patientId}
          patientId={patientId}
          unitId={requestedUnitId}
          active={active}
          viewState={historyViewState}
        />
      )}
      <div hidden={showHistory}>
        {message && (
          <p role="status" className="mb-3 text-sm text-teal-800">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {data.canUpload === true && (
          <PatientDocumentUpload
            key={uploadScope}
            patientId={patientId}
            state={uploadState}
            categories={data.categories}
            url={withSelectedUnit(
              "/api/v1/inventory/patient-documents" +
                (requestedUnitId !== undefined
                  ? "?unitId=" + encodeURIComponent(requestedUnitId)
                  : ""),
            )}
            onStored={() => {
              void client.invalidateQueries({
                predicate: (q) =>
                  q.queryKey[0] === "inventory" &&
                  typeof q.queryKey[1] === "string" &&
                  q.queryKey[1].includes("patient-documents?") &&
                  q.queryKey[1].includes("patientId=" + encodeURIComponent(patientId)),
              });
            }}
            onOpen={(id) => void openReceived(id)}
          />
        )}

        <div
          className={`grid min-w-0 items-start gap-5 ${selected ? "xl:grid-cols-[minmax(0,1fr)_minmax(280px,350px)]" : ""}`}
        >
          <div className="min-w-0 space-y-4">
            <div
              className="grid items-end gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(200px,1fr)_minmax(0,3fr)] [&_input]:h-8 [&_select]:h-8 [&_select]:min-h-8 [&_select]:py-1 [&_select]:text-xs [&_label]:text-xs"
              aria-label="Filtros de documentos"
            >
              <label className="block space-y-1 text-sm">
                Buscar documentos
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Nome do documento"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label htmlFor={`${id}-category`} className="mb-1 block text-sm">
                    Categoria
                  </label>
                  <select
                    id={`${id}-category`}
                    value={filters.category}
                    onChange={(event) => filter("category", event.target.value)}
                    className="min-h-10 w-full min-w-0 rounded-md border bg-white p-2 text-sm"
                  >
                    <option value="">Todas as categorias</option>
                    {data.categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${id}-professional`} className="mb-1 block text-sm">
                    Profissional
                  </label>
                  <select
                    id={`${id}-professional`}
                    value={filters.professionalId}
                    onChange={(event) => filter("professionalId", event.target.value)}
                    className="min-h-10 w-full min-w-0 rounded-md border bg-white p-2 text-sm"
                  >
                    <option value="">Todos os profissionais</option>
                    {data.professionals.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="space-y-1 text-sm">
                  De
                  <Input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(event) => filter("dateFrom", event.target.value)}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  Até
                  <Input
                    type="date"
                    value={filters.dateTo}
                    onChange={(event) => filter("dateTo", event.target.value)}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
                <div>
                  <label htmlFor={`${id}-sort`} className="mr-2 text-sm">
                    Ordenar por
                  </label>
                  <select
                    id={`${id}-sort`}
                    value={filters.sort}
                    onChange={(event) => filter("sort", event.target.value)}
                    className="min-h-10 rounded-md border bg-white p-2 text-sm"
                  >
                    <option value="date">Data mais recente</option>
                    <option value="relevance">Relevância da busca</option>
                  </select>
                </div>
                <div className="flex gap-1" role="group" aria-label="Visualização dos documentos">
                  <Button
                    type="button"
                    variant={mode === "list" ? "secondary" : "ghost"}
                    aria-pressed={mode === "list"}
                    onClick={() => setMode("list")}
                  >
                    Lista
                  </Button>
                  <Button
                    type="button"
                    variant={mode === "table" ? "secondary" : "ghost"}
                    aria-pressed={mode === "table"}
                    onClick={() => setMode("table")}
                  >
                    Tabela
                  </Button>
                </div>
              </div>
            </div>
            {query.error && <InventoryState error={query.error} retry={() => query.refetch()} />}
            <p className="text-xs text-muted-foreground">
              {data.total} documento(s) ·{" "}
              {data.documents.length
                ? `${offset + 1}–${offset + data.documents.length}`
                : "nenhum resultado"}
            </p>
            {!data.documents.length && (
              <div className="border-y py-8 text-center text-sm text-muted-foreground">
                <Files className="mx-auto mb-2 size-5" />
                Nenhum documento encontrado para estes filtros.
              </div>
            )}
            {mode === "list" ? (
              <ul className="divide-y border-y">
                {data.documents.map((document) => (
                  <li key={document.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(document)}
                      aria-pressed={selected?.id === document.id}
                      className={`w-full space-y-1 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${selected?.id === document.id ? "bg-teal-50" : "hover:bg-slate-50"}`}
                    >
                      <span className="block font-medium">{document.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {dateLabel(document.receivedAt ?? document.occurredAt)} ·{" "}
                        {document.professionalName || "Profissional não informado"}
                      </span>
                      <span className="block text-xs text-slate-600">
                        {document.classification
                          ? classificationLabel(document.classification) +
                            " · " +
                            document.categories.map((c) => categories.get(c) ?? c).join(" · ")
                          : document.classificationPending
                            ? "Sem classificação"
                            : document.categories
                                .map((category) => categories.get(category) ?? "Categoria")
                                .join(" · ")}{" "}
                        · {sourceNames[document.sourceKind]} ·{" "}
                        {statusNames[document.laboratoryStatus ?? document.status] ??
                          document.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Documentos do paciente</caption>
                  <thead>
                    <tr className="border-b">
                      <th scope="col" className="p-2">
                        Documento
                      </th>
                      <th scope="col" className="p-2">
                        Data
                      </th>
                      <th scope="col" className="p-2">
                        Profissional
                      </th>
                      <th scope="col" className="p-2">
                        Categoria
                      </th>
                      <th scope="col" className="p-2">
                        Origem
                      </th>
                      <th scope="col" className="p-2">
                        Situação
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.documents.map((document) => (
                      <tr
                        key={document.id}
                        className={selected?.id === document.id ? "bg-teal-50" : "border-b"}
                      >
                        <th scope="row" className="p-2 font-medium">
                          <button
                            type="button"
                            className="text-left underline decoration-teal-300 underline-offset-4"
                            onClick={() => setSelected(document)}
                          >
                            {document.title}
                          </button>
                        </th>
                        <td className="whitespace-nowrap p-2">
                          {dateLabel(document.receivedAt ?? document.occurredAt)}
                        </td>
                        <td className="p-2">{document.professionalName || "Não informado"}</td>
                        <td className="p-2">
                          {document.classification
                            ? classificationLabel(document.classification) +
                              " · " +
                              document.categories.map((c) => categories.get(c) ?? c).join(" · ")
                            : document.classificationPending
                              ? "Sem classificação"
                              : document.categories
                                  .map((category) => categories.get(category) ?? "Categoria")
                                  .join(" · ")}
                        </td>
                        <td className="p-2">
                          {sourceNames[document.sourceKind] ?? "Registro do paciente"}
                        </td>
                        <td className="p-2">
                          {statusNames[document.laboratoryStatus ?? document.status] ??
                            document.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={offset === 0 || query.isPending}
                onClick={() => setOffset((value) => Math.max(0, value - 25))}
              >
                Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!data.hasMore || query.isPending}
                onClick={() => setOffset((value) => value + 25)}
              >
                Próxima
              </Button>
            </div>
            {data.canManageCategories === true && (
              <form
                className="space-y-2 border-t pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (categoryName.trim())
                    void mutate({ action: "CREATE_CATEGORY", name: categoryName.trim() }, () => {
                      setCategoryName("");
                      setMessage("Categoria criada para a organização.");
                    });
                }}
              >
                <label className="block space-y-1 text-sm">
                  Nova categoria
                  <Input
                    value={categoryName}
                    onChange={(event) => setCategoryName(event.target.value)}
                    maxLength={100}
                    minLength={2}
                    required
                  />
                </label>
                <Button type="submit" variant="outline" disabled={pending}>
                  Criar categoria
                </Button>
              </form>
            )}
          </div>
          <aside
            ref={detailRef}
            hidden={!selected}
            aria-label="Prévia privada do documento"
            className="min-w-0 space-y-4 border-t border-slate-200 pt-4 xl:sticky xl:top-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0"
            key={`${patientId}:${unitId}`}
          >
            {selectedView ? (
              <>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(null)}>
                  Fechar prévia
                </Button>
                <div className="space-y-2">
                  <h3 className="break-words font-semibold">{selectedView.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    {sourceNames[selectedView.sourceKind] ?? "Registro do paciente"} ·{" "}
                    {statusNames[
                      data.documents.find((d) => d.id === selectedView.id)?.laboratoryStatus ??
                        selectedView.status
                    ] ?? selectedView.status}
                    {selectedView.revision !== null ? ` · versão ${selectedView.revision}` : ""}
                  </p>
                  <p className="text-sm">
                    {dateLabel(selectedView.occurredAt)} ·{" "}
                    {selectedView.professionalName || "Profissional não informado"}
                    <br />
                    {selectedView.unitName}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {selectedView.classificationPending ? (
                      <span className="rounded bg-slate-100 px-2 py-1 text-xs">
                        Sem classificação
                      </span>
                    ) : (
                      selectedView.categories.map((category) => (
                        <span key={category} className="rounded bg-slate-100 px-2 py-1 text-xs">
                          {categories.get(category) ?? "Categoria"}
                        </span>
                      ))
                    )}
                  </div>
                  {selectedView.sizeBytes !== null && (
                    <p className="text-xs text-muted-foreground">
                      Original · {Math.ceil(selectedView.sizeBytes / 1024)} KB
                    </p>
                  )}
                </div>
                <PrivateDocumentPreview key={selectedView.id} document={selectedView} />
                {data.canUpload &&
                  selectedView.sourceKind === "GENERAL_DOCUMENT" &&
                  selectedView.classificationAvailable && (
                    <DocumentClassification
                      key={selectedView.sourceId}
                      patientId={patientId}
                      documentId={selectedView.sourceId}
                      unitId={selectedView.unitId ?? requestedUnitId ?? ""}
                      onChanged={() => {
                        void query.refetch();
                      }}
                    />
                  )}
                {data.canUpload &&
                  selectedView.sourceKind === "GENERAL_DOCUMENT" &&
                  selectedView.contentType === "application/pdf" &&
                  selectedView.categories.includes("LAB_RESULT") &&
                  !selectedView.classificationPending &&
                  (!selectedView.classification ||
                    ["CONFIRMED", "CORRECTED", "MANUAL_CLASSIFIED"].includes(
                      selectedView.classification.action,
                    )) &&
                  (selectedView.classification && reviewDocumentId !== selectedView.id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReviewDocumentId(selectedView.id)}
                    >
                      Conferir resultados laboratoriais
                    </Button>
                  ) : (
                    <LaboratoryReview
                      key={patientId + selectedView.id}
                      patientId={patientId}
                      documentId={selectedView.sourceId}
                      unitId={selectedView.unitId ?? requestedUnitId}
                      onChanged={() => {
                        void query.refetch();
                      }}
                    />
                  ))}
                {safeUrl(selectedView.previewUrl) &&
                  !["application/pdf", "image/jpeg", "image/png"].includes(
                    selectedView.contentType ?? "",
                  ) && (
                    <Button asChild type="button" variant="outline">
                      <a
                        href={safeUrl(selectedView.previewUrl)!}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Abrir prévia em nova aba
                      </a>
                    </Button>
                  )}
                <div className="flex flex-wrap gap-2">
                  {safeUrl(selectedView.downloadUrl) && (
                    <Button asChild type="button" variant="outline">
                      <a
                        href={safeUrl(selectedView.downloadUrl)!}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Baixar original
                      </a>
                    </Button>
                  )}
                  {selectedView.originUrl?.startsWith("/") &&
                    !selectedView.originUrl.startsWith("//") && (
                      <Button asChild type="button" variant="outline">
                        <a href={selectedView.originUrl}>Abrir registro de origem</a>
                      </Button>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Acesso privado. O documento original permanece na fonte de origem.
                </p>
              </>
            ) : (
              <div className="py-8 text-sm text-muted-foreground">
                Selecione um documento para consultar a prévia, os detalhes e as ações disponíveis.
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
