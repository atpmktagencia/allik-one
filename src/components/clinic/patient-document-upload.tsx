import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Upload, FileText, Check, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PATIENT_DOCUMENT_MAX_BYTES } from "@/data/patient-document-upload";
import { DocumentTransferError, transferPatientDocument } from "@/data/patient-document-transfer";

type Item = {
  id: string;
  file: File;
  categories: string[];
  status: "queued" | "sending" | "stored" | "failed" | "duplicate" | "interrupted";
  progress: number;
  error?: string | undefined;
  documentId?: string;
  duplicateId?: string | null | undefined;
  duplicateReason?: string;
};
export type DocumentUploadState = { items: Item[] };
const labels = {
  queued: "Na fila",
  sending: "Enviando",
  stored: "Original recebido",
  failed: "Falha no envio",
  duplicate: "Arquivo já recebido",
  interrupted: "Envio interrompido",
};
export function PatientDocumentUpload({
  patientId,
  url,
  state,
  categories,
  onStored,
  onOpen,
}: {
  patientId: string;
  url: string;
  state: MutableRefObject<DocumentUploadState>;
  categories: { id: string; name: string }[];
  onStored: () => void;
  onOpen: (id: string) => void;
}) {
  const [items, setItems] = useState(state.current.items);
  const [selectedCategories, setCategories] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const alive = useRef(true),
    running = useRef(false),
    controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Snapshot callbacks do not own the operation or trigger processing on rerender.
  const stored = useRef(onStored);
  stored.current = onStored;
  const change = (id: string, patch: Partial<Item>) => {
    state.current.items = state.current.items.map((x) => (x.id === id ? { ...x, ...patch } : x));
    if (alive.current) setItems([...state.current.items]);
  };
  useEffect(() => {
    alive.current = true;
    const snapshot = state.current;
    return () => {
      alive.current = false;
      snapshot.items = snapshot.items.map((x) =>
        x.status === "sending"
          ? {
              ...x,
              status: "interrupted" as const,
              error: "Envio interrompido. Confirme o recebimento com uma nova tentativa.",
            }
          : x,
      );
      controller.current?.abort();
    };
  }, [state]);
  async function process() {
    if (running.current) return;
    running.current = true;
    try {
      while (alive.current) {
        const item = state.current.items.find((x) => x.status === "queued");
        if (!item) break;
        change(item.id, { status: "sending", progress: 0, error: undefined });
        const body = new FormData();
        body.set("id", item.id);
        body.set("patientId", patientId);
        body.set("title", item.file.name.slice(0, 200).padEnd(2, "_"));
        body.set("file", item.file);
        body.set("intent", item.categories.length ? "DOCUMENT" : "RECEIPT");
        body.set(
          "categories",
          JSON.stringify(item.categories.length ? item.categories : ["OTHER"]),
        );
        if (item.duplicateId && item.duplicateReason) {
          body.set("duplicateOf", item.duplicateId);
          body.set("duplicateReason", item.duplicateReason);
        }
        controller.current = new AbortController();
        try {
          const documentId = await transferPatientDocument(
            url,
            body,
            controller.current.signal,
            (progress) => change(item.id, { progress }),
          );
          change(item.id, { status: "stored", progress: 100, documentId });
          if (alive.current) stored.current();
        } catch (error) {
          if (!alive.current) break;
          change(item.id, {
            status:
              error instanceof DocumentTransferError && error.code === "DUPLICATE_DOCUMENT"
                ? "duplicate"
                : error instanceof DOMException && error.name === "AbortError"
                  ? "interrupted"
                  : "failed",
            error: error instanceof Error ? error.message : "Envio não concluído.",
            duplicateId: error instanceof DocumentTransferError ? error.duplicateId : undefined,
          });
        } finally {
          controller.current = null;
        }
      }
    } finally {
      running.current = false;
    }
  }
  function receive(files: FileList | File[]) {
    const next = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      categories: [...selectedCategories],
      status:
        !file.size ||
        file.size > PATIENT_DOCUMENT_MAX_BYTES ||
        !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
          ? ("failed" as const)
          : ("queued" as const),
      progress: 0,
      ...(!file.size ||
      file.size > PATIENT_DOCUMENT_MAX_BYTES ||
      !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
        ? { error: "Selecione PDF, JPEG ou PNG de até 4 MB." }
        : {}),
    }));
    state.current.items = [...state.current.items, ...next];
    setItems([...state.current.items]);
    void process();
  }
  const busy = items.some((x) => x.status === "sending");
  return (
    <section
      aria-label="Recebimento de documentos"
      className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          receive(e.dataTransfer.files);
        }}
        className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4 ${dragging ? "border-teal-600 bg-teal-50" : "border-slate-300 bg-slate-50/60"}`}
      >
        <div className="flex items-center gap-3">
          <Upload className="size-5 text-teal-700" />
          <div>
            <p className="text-sm font-medium">Arraste os documentos para cá</p>
            <p className="text-xs text-slate-500">
              PDF, JPEG ou PNG · até 4 MB por arquivo · sem classificação obrigatória
            </p>
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
          Selecionar arquivos
        </Button>
        <input
          ref={input}
          aria-label="Selecionar documentos"
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png"
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) receive(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-slate-600">Categoria opcional</summary>
        <div className="mt-2 flex flex-wrap gap-3">
          {categories.map((c) => (
            <label key={c.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={selectedCategories.includes(c.id)}
                onChange={(e) =>
                  setCategories((v) =>
                    e.target.checked ? [...v, c.id].slice(0, 8) : v.filter((x) => x !== c.id),
                  )
                }
              />
              {c.name}
            </label>
          ))}
        </div>
      </details>
      {items.length > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span role="status">
              {items.filter((x) => x.status === "stored").length} de {items.length} originais
              recebidos
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                state.current.items = items.filter((x) => x.status !== "stored");
                setItems([...state.current.items]);
              }}
            >
              Limpar concluídos
            </Button>
          </div>
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="py-3" aria-label={item.file.name}>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-teal-700">
                    {item.status === "stored" ? (
                      <Check className="size-4" />
                    ) : (
                      <FileText className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{item.file.name}</p>
                    <p className="text-xs text-slate-500">
                      {labels[item.status]}
                      {item.status === "sending"
                        ? item.progress === 100
                          ? " · Confirmando armazenamento…"
                          : ` · ${item.progress}%`
                        : ""}
                    </p>
                    {!["sending", "stored"].includes(item.status) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Remover ${item.file.name} da fila`}
                        disabled={busy}
                        onClick={() => {
                          state.current.items = state.current.items.filter((x) => x.id !== item.id);
                          setItems([...state.current.items]);
                        }}
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                    {item.status === "sending" && (
                      <progress
                        aria-label={`Progresso de ${item.file.name}`}
                        max={100}
                        value={item.progress}
                        className="mt-1 h-1 w-full accent-teal-600"
                      />
                    )}
                    {item.error && (
                      <p role="alert" className="mt-1 text-xs text-amber-800">
                        {item.error}
                      </p>
                    )}
                  </div>
                  {item.documentId && (
                    <Button size="sm" variant="outline" onClick={() => onOpen(item.documentId!)}>
                      Abrir original
                    </Button>
                  )}
                  {item.status === "duplicate" && item.duplicateId && (
                    <Button size="sm" variant="outline" onClick={() => onOpen(item.duplicateId!)}>
                      Abrir existente
                    </Button>
                  )}
                  {["failed", "interrupted", "queued"].includes(item.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        busy ||
                        !item.file.size ||
                        item.file.size > PATIENT_DOCUMENT_MAX_BYTES ||
                        !["application/pdf", "image/jpeg", "image/png"].includes(item.file.type)
                      }
                      onClick={() => {
                        change(item.id, { status: "queued", error: undefined });
                        void process();
                      }}
                    >
                      <RotateCcw className="mr-1 size-3" />
                      {item.status === "queued" ? "Continuar" : "Tentar novamente"}
                    </Button>
                  )}
                  {item.status === "sending" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Interromper ${item.file.name}`}
                      onClick={() => controller.current?.abort()}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
                {item.status === "duplicate" && item.duplicateId && (
                  <details className="ml-6 mt-2 text-xs">
                    <summary className="cursor-pointer">Registrar repetição intencional</summary>
                    <label className="mt-2 block">
                      Justificativa
                      <input
                        className="ml-2 rounded border px-2 py-1"
                        aria-label={`Justificativa para ${item.file.name}`}
                        value={reasons[item.id] ?? ""}
                        maxLength={500}
                        onChange={(e) => setReasons((v) => ({ ...v, [item.id]: e.target.value }))}
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={busy || (reasons[item.id]?.trim().length ?? 0) < 10}
                      onClick={() => {
                        const next = {
                          ...item,
                          id: crypto.randomUUID(),
                          status: "queued" as const,
                          duplicateReason: reasons[item.id]!.trim(),
                        };
                        state.current.items = state.current.items
                          .filter((x) => x.id !== item.id)
                          .concat(next);
                        setItems([...state.current.items]);
                        void process();
                      }}
                    >
                      Confirmar repetição justificada
                    </Button>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-slate-500">
        O original fica disponível sem extração. Receber um arquivo não valida resultados clínicos.
      </p>
    </section>
  );
}
