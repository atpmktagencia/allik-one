import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readInventoryResponse } from "@/data/inventory-api";
import {
  classificationLabel,
  classificationNames,
  type ClassificationView,
} from "@/lib/document-classification-view";
type EventRow = Omit<ClassificationView, "createdAt" | "attemptId"> & {
  created_at: string;
  attempt_id: string | null;
  actor_kind: string;
};
export function DocumentClassification({
  patientId,
  documentId,
  unitId,
  onChanged,
}: {
  patientId: string;
  documentId: string;
  unitId: string;
  onChanged: () => void;
}) {
  const [checked, setChecked] = useState(false),
    [chosen, setChosen] = useState<string[]>([]),
    [reason, setReason] = useState("Classificação ajustada após conferência do documento original"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const path = `/api/v1/inventory/document-classifications?${new URLSearchParams({ patientId, documentId, unitId })}`;
  const query = useQuery({
    queryKey: ["inventory", path],
    queryFn: async () => {
      const result = await readInventoryResponse<{ events: EventRow[] }>(await fetch(path));
      return result.data!;
    },
    retry: false,
    refetchInterval: (q) =>
      ["RECEIVED", "STARTED", "RETRY_REQUESTED"].includes(q.state.data?.events.at(-1)?.action ?? "")
        ? 2000
        : false,
  });
  const latest = query.data?.events.at(-1);
  async function action(kind: string, categories = chosen) {
    setBusy(true);
    setError("");
    try {
      const base = { documentId, patientId, unitId, expectedRevision: latest?.revision ?? 0 };
      const body = ["RESUME", "RECOVER"].includes(kind)
        ? { ...base, action: kind }
        : {
            ...base,
            operationId: crypto.randomUUID(),
            attemptId: null,
            command: {
              action: kind,
              payload:
                kind === "RETRY_REQUESTED"
                  ? { schemaVersion: 1, reason: "Nova tentativa solicitada pelo profissional" }
                  : {
                      schemaVersion: 1,
                      categories,
                      reason,
                      originalReviewed: checked,
                      identityConfirmed: checked,
                      ...(kind === "CONFIRMED" ? { resultEventId: latest?.id } : {}),
                    },
            },
          };
      await readInventoryResponse(
        await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      await query.refetch();
      onChanged();
      setChecked(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível alterar a classificação.");
    } finally {
      setBusy(false);
    }
  }
  const result = latest?.payload.result;
  return (
    <section
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-3"
      aria-label="Classificação do documento"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">Organização do documento</h4>
        <span className="rounded-md bg-teal-50 px-2 py-1 text-xs text-teal-800">
          {classificationLabel(latest)}
        </span>
      </div>
      {query.isError && (
        <p role="alert" className="text-xs text-rose-700">
          Não foi possível consultar a classificação.
        </p>
      )}
      {latest?.action === "NEEDS_REVIEW" && (
        <p className="text-xs text-amber-800">
          {latest.payload.evidenceStatus === "IDENTITY_MISMATCH"
            ? "Identificação divergente. Confira o paciente no original; o vínculo não foi alterado."
            : latest.payload.evidenceStatus === "UNAVAILABLE"
              ? "Sem evidência textual independente. Confira o original."
              : "Categoria ou evidência ambígua. Confira o original antes de classificar."}
        </p>
      )}
      {result?.categories.map((c) => (
        <div key={c.category} className="text-xs">
          <strong>{classificationNames[c.category]}</strong>
          {c.evidence.map((e, i) => (
            <p key={i} className="mt-1 text-slate-600">
              Pág. {e.page}: “{e.quote}”
            </p>
          ))}
        </div>
      ))}
      {!!latest?.payload.categories?.length && (
        <p className="text-xs">
          {latest.payload.categories.map((c) => classificationNames[c]).join(" · ")}
        </p>
      )}
      {latest?.action === "FAILED" && (
        <div className="space-y-2 text-xs">
          <p>O original está preservado. A classificação não foi concluída.</p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void action("RETRY_REQUESTED")}
          >
            Solicitar nova tentativa
          </Button>
        </div>
      )}
      {["RECEIVED", "RETRY_REQUESTED"].includes(latest?.action ?? "") && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void action("RESUME")}>
          Continuar processamento
        </Button>
      )}
      {latest?.action === "STARTED" &&
        Date.now() - new Date(latest.created_at).getTime() > 180000 && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void action("RECOVER")}
          >
            Encerrar tentativa interrompida
          </Button>
        )}
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        Conferi o original e confirmei que pertence a este paciente.
      </label>
      {latest?.action === "SUGGESTED" && (
        <Button
          size="sm"
          disabled={!checked || busy}
          onClick={() =>
            void action(
              "CONFIRMED",
              result?.categories.map((c) => c.category),
            )
          }
        >
          Aceitar sugestão
        </Button>
      )}
      <details>
        <summary className="cursor-pointer text-xs font-medium text-teal-800">
          {latest ? "Corrigir categoria" : "Classificar manualmente"}
        </summary>
        <div className="mt-2 space-y-2">
          <fieldset className="grid gap-1">
            {Object.entries(classificationNames).map(([id, name]) => (
              <label key={id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={chosen.includes(id)}
                  onChange={(e) =>
                    setChosen((old) =>
                      e.target.checked ? [...old, id] : old.filter((c) => c !== id),
                    )
                  }
                />
                {name}
              </label>
            ))}
          </fieldset>
          <Input
            aria-label="Motivo da classificação"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            disabled={!checked || !chosen.length || reason.trim().length < 10 || busy}
            onClick={() =>
              void action(
                [
                  "SUGGESTED",
                  "NEEDS_REVIEW",
                  "CONFIRMED",
                  "CORRECTED",
                  "MANUAL_CLASSIFIED",
                ].includes(latest?.action ?? "")
                  ? "CORRECTED"
                  : "MANUAL_CLASSIFIED",
              )
            }
          >
            Salvar categoria
          </Button>
        </div>
      </details>
      {!!query.data?.events.length && (
        <details>
          <summary className="cursor-pointer text-xs text-slate-500">
            Histórico da classificação
          </summary>
          <ul className="mt-1 space-y-1 text-xs text-slate-600">
            {query.data.events.map((e) => (
              <li key={e.id}>
                {classificationLabel(e)} · {e.actor_kind === "SYSTEM" ? "Sistema" : "Profissional"}{" "}
                · {new Date(e.created_at).toLocaleString("pt-BR")}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <p role="alert" className="text-xs text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}
