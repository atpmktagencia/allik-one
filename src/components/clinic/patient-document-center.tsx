import { PrivateDocumentPreview } from "./private-document-preview";
import { LaboratoryReview } from "./laboratory-review";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Files, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import { selectedUnitId, withSelectedUnit } from "@/data/unit-context";
import { PATIENT_DOCUMENT_MAX_BYTES } from "@/data/patient-document-upload";
import { InventoryState } from "./inventory-state";

type Category = { id: string; name: string; builtin: boolean };
type PatientDocument = {
  id: string;
  sourceKind: string;
  sourceId: string;
  revision: number | null;
  title: string;
  categories: string[];
  occurredAt: string;
  professionalId: string | null;
  professionalName: string;
  unitName: string;
  status: string;
  laboratoryStatus?: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  previewUrl: string | null;
  downloadUrl: string | null;
  originUrl: string | null;
};
type Payload = {
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
}: {
  patientId: string;
  examsOnly?: boolean;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState<"list" | "table">("list");
  const [selected, setSelected] = useState<PatientDocument | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [unitId, setUnitId] = useState(selectedUnitId);
  const generation = useRef(0);
  const lock = useRef(false);
  const uploadOperation = useRef<{ key: string; id: string } | null>(null);
  const id = useId();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((previous) => ({ ...previous, search }));
      setOffset(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
    };
    const reset = () => {
      invalidate();
      setUnitId(selectedUnitId());
      setSelected(null);
      setFilters(initialFilters);
      setSearch("");
      setOffset(0);
      setUploadOpen(false);
      setMessage("");
      setError("");
      setPending(false);
      lock.current = false;
      uploadOperation.current = null;
    };
    reset();
    window.addEventListener("inventory-unit-change", reset);
    return () => {
      invalidate();
      window.removeEventListener("inventory-unit-change", reset);
    };
  }, [patientId]);
  useEffect(() => {
    setSelected(null);
    setOffset(0);
    setFilters(initialFilters);
    setSearch("");
    setMessage("");
    setError("");
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
  const query = useInventory<Payload>(`patient-documents?${params}`);
  const data = query.data;
  function filter(key: keyof typeof filters, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setOffset(0);
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || data?.canUpload !== true) return;
    const form = event.currentTarget;
    const body = new FormData(form);
    const categories = body.getAll("category").map(String);
    if (categories.length > 8) {
      setError("Selecione no máximo 8 categorias.");
      return;
    }
    if (!categories.length) {
      setError("Selecione pelo menos uma categoria.");
      return;
    }
    body.delete("category");
    body.set("categories", JSON.stringify(categories));
    body.set("patientId", patientId);
    const file = body.get("file");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > PATIENT_DOCUMENT_MAX_BYTES ||
      !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
    ) {
      setError("Selecione PDF, JPEG ou PNG de até 4 MB.");
      return;
    }
    const operationKey = JSON.stringify({
      title: body.get("title"),
      issuedOn: body.get("issuedOn"),
      categories,
      file: { name: file.name, size: file.size, type: file.type, lastModified: file.lastModified },
    });
    if (uploadOperation.current?.key !== operationKey)
      uploadOperation.current = { key: operationKey, id: crypto.randomUUID() };
    body.set("id", uploadOperation.current.id);
    await mutate(body, () => {
      uploadOperation.current = null;
      form.reset();
      setUploadOpen(false);
      setMessage("Original armazenado de forma privada.");
    });
  }
  async function mutate(body: FormData | Record<string, unknown>, done: () => void) {
    if (lock.current) return;
    const current = generation.current;
    lock.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(withSelectedUnit("/api/v1/inventory/patient-documents"), {
        method: "POST",
        credentials: "same-origin",
        ...(body instanceof FormData
          ? { body }
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
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
              ? "Solicitações, arquivos e conferência de resultados. A comparação longitudinal será a próxima etapa."
              : "Registros e arquivos deste paciente, preservados em suas fontes de origem."}
          </p>
        </div>
        {data.canUpload === true && (
          <Button type="button" disabled={pending} onClick={() => setUploadOpen((value) => !value)}>
            <Upload className="mr-2 size-4" />
            Anexar arquivo
          </Button>
        )}
      </div>
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
      {uploadOpen && data.canUpload === true && (
        <form
          onSubmit={(event) => void upload(event)}
          className="mb-5 space-y-4 rounded-lg border bg-slate-50 p-4"
          aria-label="Anexar documento do paciente"
        >
          <fieldset disabled={pending} className="space-y-4">
            <legend className="font-semibold">Preservar arquivo original</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                Nome do documento
                <Input name="title" required minLength={2} maxLength={200} />
              </label>
              <label className="space-y-1 text-sm">
                Data do documento
                <Input name="issuedOn" type="date" />
              </label>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Categorias do arquivo (até 8)</legend>
              <div className="flex max-h-40 flex-wrap gap-3 overflow-y-auto">
                {data.categories.map((category) => (
                  <label key={category.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="category" value={category.id} />
                    {category.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1 text-sm">
              <label htmlFor={`${id}-file`}>Arquivo original</label>
              <Input
                id={`${id}-file`}
                name="file"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                required
                aria-describedby={`${id}-file-help`}
              />
              <p id={`${id}-file-help`} className="text-xs text-muted-foreground">
                PDF, JPEG ou PNG de até 4 MB. Não substitui avaliação profissional.
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="submit">{pending ? "Enviando…" : "Guardar arquivo original"}</Button>
              <Button type="button" variant="outline" onClick={() => setUploadOpen(false)}>
                Cancelar anexo
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,350px)]">
        <div className="min-w-0 space-y-4">
          <div className="space-y-3" aria-label="Filtros de documentos">
            <label className="block space-y-1 text-sm">
              Buscar documentos
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nome do documento"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
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
            <div className="flex flex-wrap items-center justify-between gap-3">
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
                      {dateLabel(document.occurredAt)} ·{" "}
                      {document.professionalName || "Profissional não informado"}
                    </span>
                    <span className="block text-xs text-slate-600">
                      {document.categories
                        .map((category) => categories.get(category) ?? "Categoria")
                        .join(" · ")}{" "}
                      ·{" "}
                      {statusNames[document.laboratoryStatus ?? document.status] ?? document.status}
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
                      <td className="whitespace-nowrap p-2">{dateLabel(document.occurredAt)}</td>
                      <td className="p-2">{document.professionalName || "Não informado"}</td>
                      <td className="p-2">
                        {document.categories
                          .map((category) => categories.get(category) ?? "Categoria")
                          .join(" · ")}
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
          aria-label="Prévia privada do documento"
          className="min-w-0 space-y-4 border-t border-slate-200 pt-4 xl:sticky xl:top-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0"
          key={`${patientId}:${unitId}`}
        >
          {selected ? (
            <>
              <div className="space-y-2">
                <h3 className="break-words font-semibold">{selected.title}</h3>
                <p className="text-xs text-muted-foreground">
                  {sourceNames[selected.sourceKind] ?? "Registro do paciente"} ·{" "}
                  {statusNames[
                    data.documents.find((d) => d.id === selected.id)?.laboratoryStatus ??
                      selected.status
                  ] ?? selected.status}
                  {selected.revision !== null ? ` · versão ${selected.revision}` : ""}
                </p>
                <p className="text-sm">
                  {dateLabel(selected.occurredAt)} ·{" "}
                  {selected.professionalName || "Profissional não informado"}
                  <br />
                  {selected.unitName}
                </p>
                <div className="flex flex-wrap gap-1">
                  {selected.categories.map((category) => (
                    <span key={category} className="rounded bg-slate-100 px-2 py-1 text-xs">
                      {categories.get(category) ?? "Categoria"}
                    </span>
                  ))}
                </div>
                {selected.sizeBytes !== null && (
                  <p className="text-xs text-muted-foreground">
                    Original · {Math.ceil(selected.sizeBytes / 1024)} KB
                  </p>
                )}
              </div>
              <PrivateDocumentPreview key={selected.id} document={selected} />
              {data.canUpload &&
                selected.sourceKind === "GENERAL_DOCUMENT" &&
                selected.contentType === "application/pdf" && (
                  <LaboratoryReview
                    key={patientId + selected.id}
                    patientId={patientId}
                    documentId={selected.sourceId}
                    onChanged={() => {
                      void query.refetch();
                    }}
                  />
                )}
              {safeUrl(selected.previewUrl) &&
                !["application/pdf", "image/jpeg", "image/png"].includes(
                  selected.contentType ?? "",
                ) && (
                  <Button asChild type="button" variant="outline">
                    <a
                      href={safeUrl(selected.previewUrl)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir prévia em nova aba
                    </a>
                  </Button>
                )}
              <div className="flex flex-wrap gap-2">
                {safeUrl(selected.downloadUrl) && (
                  <Button asChild type="button" variant="outline">
                    <a
                      href={safeUrl(selected.downloadUrl)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Baixar original
                    </a>
                  </Button>
                )}
                {selected.originUrl?.startsWith("/") && !selected.originUrl.startsWith("//") && (
                  <Button asChild type="button" variant="outline">
                    <a href={selected.originUrl}>Abrir registro de origem</a>
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
    </section>
  );
}
