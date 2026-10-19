import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import { withSelectedUnit } from "@/data/unit-context";
import {
  clinicalRequestStatusNames,
  type ClinicalRequest,
  type ClinicalRequestsPayload,
} from "@/data/clinical-requests";
import { InventoryState } from "./inventory-state";
const actionNames = {
  ISSUED: "Registrar emissão",
  RETURNED: "Registrar retorno",
  REVIEWED: "Registrar revisão",
};
function RequestActions({
  request,
  appointmentId,
  onChanged,
}: {
  request: ClinicalRequest;
  appointmentId: string;
  onChanged: () => void;
}) {
  const [note, setNote] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const operation = useRef<{ key: string; id: string } | null>(null);
  async function record(action: keyof typeof actionNames) {
    if (lock.current) return;
    if (
      !window.confirm(
        action === "ISSUED"
          ? "Confirmo que a solicitação foi emitida ou disponibilizada ao paciente. Este registro não envia mensagens."
          : action === "RETURNED"
            ? "Confirmo o recebimento do retorno desta solicitação. Os resultados ainda precisam ser conferidos."
            : "Confirmo que revisei o retorno desta solicitação. Isto não publica resultados laboratoriais automaticamente.",
      )
    )
      return;
    const payload = {
      appointmentId,
      sourceKind: request.sourceKind,
      sourceId: request.sourceId,
      action,
      version: request.version,
      note,
    };
    const key = JSON.stringify(payload);
    if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(withSelectedUnit("/api/v1/inventory/clinical-requests"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, operationId: operation.current.id }),
      });
      await readInventoryResponse(response, "Não foi possível registrar a ação.");
      setNote("");
      operation.current = null;
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Falha de conexão. Tente novamente para reconciliar a mesma operação.",
      );
    } finally {
      setPending(false);
      lock.current = false;
    }
  }
  return (
    <div className="mt-2 space-y-2">
      {!!request.allowedActions.length && (
        <div className="flex flex-wrap gap-2">
          <Input
            className="h-8 max-w-sm text-xs"
            maxLength={1000}
            aria-label={`Observação sobre ${request.title}`}
            placeholder="Observação opcional"
            value={note}
            disabled={pending}
            onChange={(e) => setNote(e.target.value)}
          />
          {request.allowedActions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void record(action)}
            >
              {pending ? "Registrando…" : actionNames[action]}
            </Button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
export function ClinicalRequestTracker({ appointmentId }: { appointmentId: string }) {
  const query = useInventory<ClinicalRequestsPayload>(
    `clinical-requests?appointmentId=${encodeURIComponent(appointmentId)}`,
  );
  return (
    <section
      className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4"
      aria-label="Acompanhamento das solicitações"
    >
      <div>
        <h3 className="text-sm font-semibold">Acompanhamento das solicitações</h3>
        <p className="mt-1 text-xs text-slate-500">
          Registro de emissão, retorno e revisão. Finalizar um documento não registra sua entrega.
          Nenhuma ação envia mensagens, cobra ou movimenta estoque. Somente o profissional
          responsável habilitado pode registrar estas ações.
        </p>
      </div>
      {query.isPending || query.error ? (
        <InventoryState
          pending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : !(query.data?.requests ?? []).length ? (
        <p className="text-xs text-slate-500">
          Nenhuma solicitação de exame, encaminhamento ou plano de procedimentos vinculado a este
          atendimento.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {(query.data?.requests ?? []).map((request) => (
            <li className="py-3" key={`${request.sourceKind}:${request.sourceId}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{request.title}</span>
                <span className="rounded-full bg-teal-50 px-2 py-1 text-xs text-teal-800">
                  {request.recordStatus === "DRAFT"
                    ? "Rascunho — concluir antes da emissão"
                    : clinicalRequestStatusNames[request.status]}
                </span>
              </div>
              {request.sourceChanged && (
                <p className="mt-1 text-xs text-amber-800">
                  O plano foi alterado após a emissão. Registre a nova emissão antes de acompanhar
                  seu retorno.
                </p>
              )}
              <RequestActions
                key={`${appointmentId}:${request.sourceKind}:${request.sourceId}:${request.version}`}
                request={request}
                appointmentId={appointmentId}
                onChanged={() => void query.refetch()}
              />
            </li>
          ))}
        </ul>
      )}
      {query.data?.hasMore && (
        <p className="text-xs text-amber-800">
          Exibindo as primeiras 100 solicitações deste atendimento. Consulte os documentos e planos
          para os demais registros.
        </p>
      )}
    </section>
  );
}
