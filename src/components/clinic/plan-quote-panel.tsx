import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import { withSelectedUnit } from "@/data/unit-context";
import {
  planQuoteOverrideSchema,
  type ComputedPlanQuote,
  type PlanQuoteLine,
  type PlanQuoteOverride,
} from "@/data/plan-quote";
import { InventoryState } from "./inventory-state";

type Head = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  planId?: string;
  patientId?: string;
  patientName?: string;
  unitName?: string;
  unitId?: string;
  planVersion: number;
  version: number;
  status: string;
};
type Snapshot = ComputedPlanQuote & {
  referenceDate?: string;
  planVersion?: number;
  unitId?: string;
  discountBps: number;
  overrides?: PlanQuoteOverride[];
  previewHash?: string;
};
type Payload = {
  estimates: Head[];
  planVersion: number;
  unitId: string;
  unitName?: string;
  canPreview: boolean;
  canSave: boolean;
  canDiscount: boolean;
  canReadClinical: boolean;
};
const amount = (value: string | null) => {
  if (value === null) return "Pendente";
  if (!/^-?\d+\.\d{2}$/.test(value)) return "Valor indisponível";
  const [integer, fraction] = value.split(".");
  return `R$ ${BigInt(integer!).toLocaleString("pt-BR")},${fraction}`;
};
function QuoteValues({ snapshot, dirty = false }: { snapshot: Snapshot; dirty?: boolean }) {
  return (
    <div className="space-y-3" aria-label="Valores da estimativa">
      <div className="grid gap-3 rounded-xl bg-teal-50 p-4 sm:grid-cols-2">
        <p>
          Subtotal conhecido
          <br />
          <strong>{dirty ? "Recalcular" : amount(snapshot.knownSubtotal)}</strong>
        </p>
        <p>
          Total da estimativa
          <br />
          <strong>
            {dirty
              ? "Recalcular"
              : snapshot.total === null
                ? "Pendente — há itens sem valor confirmado"
                : amount(snapshot.total)}
          </strong>
        </p>
        <p>
          Desconto calculado
          <br />
          <strong>
            {dirty
              ? "Recalcular"
              : snapshot.discountAmount === null
                ? "Pendente"
                : amount(snapshot.discountAmount)}
          </strong>
        </p>
        <p className="text-sm">
          {dirty
            ? "Alterações pendentes de recálculo; a conferência anterior não se aplica."
            : snapshot.complete
              ? "Todos os itens selecionados têm valor calculável."
              : "Estimativa incompleta: pendências não equivalem a zero."}
        </p>
      </div>
      {snapshot.referenceDate && (
        <p className="text-xs text-muted-foreground">
          Referência de preços: {snapshot.referenceDate} · plano v
          {snapshot.planVersion ?? "não informada"}.
        </p>
      )}
    </div>
  );
}
function LineValue({ line }: { line: PlanQuoteLine }) {
  return (
    <div className="space-y-1 text-sm">
      <h4 className="font-medium">{line.label}</h4>
      {line.status === "INCLUDED" ? (
        <p>Incluído no grupo {line.chargeGroup}; sem cobrança separada.</p>
      ) : line.status === "EXCLUDED" ? (
        <p>Não incluído nesta estimativa.</p>
      ) : (
        <>
          <p>
            Quantidade comercial: {line.quantity ?? "Não informada"}{" "}
            {line.unit ?? "(unidade não informada)"}
          </p>
          <p>
            Preço unitário:{" "}
            {line.unitPrice === null ? "Preço indisponível" : amount(line.unitPrice)}
          </p>
          <p>
            Subtotal do item: {line.subtotal === null ? "Valor pendente" : amount(line.subtotal)}
          </p>
        </>
      )}
      {line.reason && (
        <p className="text-amber-900">
          {line.status === "UNRESOLVED" ? "Pendência" : "Observação"}: {line.reason}
        </p>
      )}
      {line.priceSource && (
        <p className="text-xs text-muted-foreground">
          Origem: {line.priceSource} · Vigência: {line.validFrom ?? "não informada"} até{" "}
          {line.validUntil ?? "sem término"} · versão do preço{" "}
          {line.priceVersion ?? "não informada"}.
        </p>
      )}
    </div>
  );
}
function QuoteSnapshot({
  patientId,
  planId,
  quoteId,
  onRevise,
  onNew,
}: {
  patientId?: string;
  planId: string;
  quoteId: string;
  onRevise: (record: Head, snapshot: Snapshot) => void;
  onNew: () => void;
}) {
  const [revision, setRevision] = useState<number | undefined>();
  const revisionId = useRef(crypto.randomUUID());
  const query = useInventory<{
    record: Head;
    snapshot: Snapshot;
    revision: number;
    canSave: boolean;
    canDiscount: boolean;
  }>(
    `plan-quotes?planId=${encodeURIComponent(planId)}&quoteId=${encodeURIComponent(quoteId)}${patientId ? `&patientId=${encodeURIComponent(patientId)}` : ""}${revision ? `&revision=${revision}` : ""}`,
  );
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  const currentRevision = data.revision ?? data.record.version;
  const canRevise =
    data.canSave === true &&
    currentRevision === data.record.version &&
    (!data.snapshot.discountBps || data.canDiscount === true);
  return (
    <section aria-label="Estimativa histórica imutável" className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">Estimativa armazenada — não aprovada</h3>
      <p className="text-xs text-muted-foreground">
        Registro de {new Date(data.record.createdAt).toLocaleString("pt-BR")} · plano v
        {data.snapshot.planVersion ?? data.record.planVersion} · estimativa v{currentRevision}.
        Snapshot preservado; preços atuais não substituem este registro.
      </p>
      <div>
        <label htmlFor={revisionId.current} className="text-sm">
          Revisão histórica
        </label>
        <select
          id={revisionId.current}
          className="ml-2 rounded-lg border bg-white p-2"
          value={currentRevision}
          onChange={(event) => setRevision(Number(event.target.value))}
        >
          {Array.from(
            { length: Math.min(data.record.version, 100) },
            (_, index) => Math.max(1, data.record.version - 99) + index,
          ).map((value) => (
            <option key={value} value={value}>
              Versão {value}
            </option>
          ))}
        </select>
      </div>
      <QuoteValues snapshot={data.snapshot} />
      <div className="space-y-3">
        {data.snapshot.lines.map((line) => (
          <div key={line.candidateKey} className="rounded-lg border p-3">
            <LineValue line={line} />
          </div>
        ))}
      </div>
      {canRevise && (
        <Button
          type="button"
          variant="outline"
          onClick={() => onRevise(data.record, data.snapshot)}
        >
          Revisar esta estimativa
        </Button>
      )}
      {data.canSave === true && !canRevise && (
        <p className="text-xs text-muted-foreground">
          Somente a revisão mais recente pode ser revisada; descontos existentes exigem autorização
          específica.
        </p>
      )}
      {data.canSave === true && (
        <Button type="button" variant="outline" onClick={onNew}>
          Nova estimativa sem desconto
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Revisar recalcula o plano vigente e os preços atuais antes de salvar uma nova versão. A
        versão anterior permanece imutável.
      </p>
    </section>
  );
}
export function PlanQuotePanel({
  patientId,
  planId,
  expectedPlanVersion,
  initialQuoteId,
}: {
  patientId?: string;
  planId: string;
  expectedPlanVersion?: number;
  initialQuoteId?: string;
}) {
  const query = useInventory<Payload>(
    `plan-quotes?planId=${encodeURIComponent(planId)}${patientId ? `&patientId=${encodeURIComponent(patientId)}` : ""}`,
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [overrides, setOverrides] = useState<PlanQuoteOverride[]>([]);
  const [discount, setDiscount] = useState("0");
  const [dirty, setDirty] = useState(false);
  const [quoteId, setQuoteId] = useState<string | null>(initialQuoteId ?? null);
  const [revisionTarget, setRevisionTarget] = useState<{ id: string; version: number } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const generation = useRef(crypto.randomUUID());
  const operation = useRef<{ key: string; id: string; operationId: string } | null>(null);
  useEffect(() => {
    function reset() {
      generation.current = crypto.randomUUID();
      setSnapshot(null);
      setOverrides([]);
      setDiscount("0");
      setDirty(false);
      setQuoteId(initialQuoteId ?? null);
      setRevisionTarget(null);
      setError("");
      setMessage("");
      operation.current = null;
    }
    reset();
    window.addEventListener("inventory-unit-change", reset);
    return () => {
      generation.current = crypto.randomUUID();
      window.removeEventListener("inventory-unit-change", reset);
    };
  }, [patientId, planId, expectedPlanVersion, initialQuoteId]);
  const decimal = discount.trim().replace(",", ".");
  const validDiscount = /^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/.test(decimal);
  const [whole, fraction = ""] = decimal.split(".");
  const bps = validDiscount ? Number(whole) * 100 + Number(fraction.padEnd(2, "0")) : NaN;
  const validOverrides = overrides.every(
    (value) => planQuoteOverrideSchema.safeParse(value).success,
  );
  async function submit(action: "PREVIEW" | "SAVE_ESTIMATE") {
    const data = query.data;
    if (
      !data ||
      lock.current ||
      !validOverrides ||
      !validDiscount ||
      bps > 10000 ||
      data.canPreview !== true ||
      (action === "SAVE_ESTIMATE" && (data.canSave !== true || !snapshot?.previewHash || dirty))
    )
      return;
    if (expectedPlanVersion !== undefined && expectedPlanVersion !== data.planVersion) {
      setError("O plano clínico foi alterado. Atualize sua visualização antes de calcular.");
      return;
    }
    const current = generation.current;
    const body = {
      action,
      ...(action === "SAVE_ESTIMATE" ? { expectedPreviewHash: snapshot?.previewHash } : {}),
      planId,
      expectedPlanVersion: expectedPlanVersion ?? data.planVersion,
      overrides,
      discountBps: data.canDiscount === true ? bps : 0,
    };
    const key = JSON.stringify({ ...body, revisionTarget });
    if (operation.current?.key !== key)
      operation.current = { key, id: crypto.randomUUID(), operationId: crypto.randomUUID() };
    lock.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(withSelectedUnit("/api/v1/inventory/plan-quotes"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          ...(action === "SAVE_ESTIMATE"
            ? {
                id: revisionTarget?.id ?? operation.current.id,
                version: revisionTarget?.version ?? null,
                operationId: operation.current.operationId,
              }
            : {}),
        }),
      });
      if (action === "SAVE_ESTIMATE" && response.status === 409 && generation.current === current) {
        setDirty(true);
        operation.current = null;
        void query.refetch();
      }
      if (action === "PREVIEW") {
        const result = await readInventoryResponse<Snapshot>(
          response,
          "Não foi possível calcular a estimativa.",
        );
        if (generation.current !== current) return;
        if (!result.data || !/^[a-f0-9]{64}$/.test(result.data.previewHash ?? ""))
          throw Error("O servidor não confirmou a versão da prévia. Calcule novamente.");
        setSnapshot(result.data);
        setDirty(false);
        setQuoteId(null);
        operation.current = null;
      } else {
        const result = await readInventoryResponse<{ id: string; version: number }>(
          response,
          "Não foi possível salvar a estimativa.",
        );
        if (generation.current !== current) return;
        if (!result.data) throw Error("O servidor não confirmou o snapshot.");
        await query.refetch();
        if (generation.current !== current) return;
        setQuoteId(result.data.id);
        setRevisionTarget(null);
        setSnapshot(null);
        setOverrides([]);
        setDiscount("0");
        operation.current = null;
        setMessage("Estimativa armazenada. Nenhuma aprovação ou ação operacional foi criada.");
      }
    } catch (cause) {
      if (generation.current === current)
        setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  function update(line: PlanQuoteLine, values: Partial<PlanQuoteOverride>) {
    const found = overrides.find((entry) => entry.candidateKey === line.candidateKey);
    const entry = {
      candidateKey: line.candidateKey,
      selected: line.selected,
      quantity: null,
      unit: null,
      ...found,
      ...values,
    };
    setOverrides((previous) => [
      ...previous.filter((value) => value.candidateKey !== line.candidateKey),
      entry,
    ]);
    setDirty(true);
    setMessage("");
  }
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  const versionChanged =
    expectedPlanVersion !== undefined && expectedPlanVersion !== data.planVersion;
  return (
    <section
      aria-label="Orçamento estimado — não aprovado"
      className="space-y-4 rounded-xl border border-teal-200 bg-white p-4"
    >
      <h3 className="font-semibold text-teal-950">Orçamento estimado — não aprovado</h3>
      <p className="text-sm text-muted-foreground">
        Estimativa comercial separada do plano clínico. Não aprova tratamento, registra pagamento,
        vende, reserva ou movimenta estoque.
      </p>
      <p className="text-xs text-muted-foreground">
        {data.unitName ?? "Unidade de origem do plano"} · plano v{data.planVersion}. O preço é
        consultado somente nessa unidade.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {versionChanged && (
        <p role="alert">O plano foi alterado; atualize a visualização clínica antes de calcular.</p>
      )}
      <section className="space-y-2" aria-label="Histórico de estimativas">
        <h4 className="font-medium">Histórico de estimativas</h4>
        <div className="flex flex-wrap gap-2">
          {data.estimates.map((entry) => (
            <Button
              key={`${entry.id}:${entry.version}`}
              type="button"
              variant="outline"
              disabled={pending}
              aria-pressed={quoteId === entry.id}
              onClick={() => {
                setQuoteId(entry.id);
                setSnapshot(null);
                setError("");
              }}
            >
              Estimativa {new Date(entry.createdAt).toLocaleString("pt-BR")} · v{entry.version}
            </Button>
          ))}
        </div>
        {!data.estimates.length && (
          <p className="text-sm text-muted-foreground">
            Nenhuma estimativa armazenada para este plano.
          </p>
        )}
      </section>
      {quoteId && (
        <QuoteSnapshot
          key={quoteId}
          {...(patientId ? { patientId } : {})}
          planId={planId}
          quoteId={quoteId}
          onRevise={(record, stored) => {
            setRevisionTarget({ id: record.id, version: record.version });
            setSnapshot(stored);
            setOverrides(structuredClone(stored.overrides ?? []));
            setDiscount(
              `${Math.floor(stored.discountBps / 100)}.${String(stored.discountBps % 100).padStart(2, "0")}`,
            );
            setDirty(true);
            setQuoteId(null);
            setError("");
            setMessage("Revisão comercial aberta. Recalcule antes de salvar uma nova versão.");
            operation.current = null;
          }}
          onNew={() => {
            setRevisionTarget(null);
            setSnapshot(null);
            setOverrides([]);
            setDiscount("0");
            setDirty(false);
            setQuoteId(null);
            setMessage("Nova estimativa sem desconto; registros anteriores preservados.");
            operation.current = null;
          }}
        />
      )}
      {data.canPreview === true && (
        <fieldset disabled={pending} className="space-y-3 rounded-xl border p-3">
          <legend className="px-1 font-medium">
            {revisionTarget
              ? `Revisão da estimativa v${revisionTarget.version}`
              : "Nova estimativa independente"}
          </legend>
          {data.canDiscount === true && (
            <label className="block max-w-xs text-sm">
              Desconto percentual
              <Input
                inputMode="decimal"
                value={discount}
                onChange={(event) => {
                  setDiscount(event.target.value);
                  setDirty(true);
                }}
              />
              <span className="text-xs text-muted-foreground">
                0 a 100%, somente conforme autorização concedida pelo servidor.
              </span>
            </label>
          )}
          {(!validDiscount || bps > 10000) && (
            <p role="alert">Informe um desconto válido com até duas casas decimais.</p>
          )}
          {!validOverrides && (
            <p role="alert">
              Informe quantidade e unidade comerciais juntas, ou apague ambas para usar os dados de
              origem.
            </p>
          )}
          {snapshot && (
            <>
              <p className="text-xs text-muted-foreground">
                {dirty
                  ? "Há ajustes ainda não calculados. Recalcule para atualizar valores e salvar."
                  : "Prévia calculada. Ajustes comerciais não alteram o plano clínico."}
              </p>
              <QuoteValues snapshot={snapshot} dirty={dirty} />
              {snapshot.lines.map((line, index) => {
                const override = overrides.find(
                  (value) => value.candidateKey === line.candidateKey,
                );
                return (
                  <fieldset key={line.candidateKey} className="space-y-3 rounded-lg border p-3">
                    <legend>Item comercial {index + 1}</legend>
                    <LineValue line={line} />
                    {line.canExclude === true && (
                      <label className="flex gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={override?.selected ?? line.selected}
                          onChange={(event) => update(line, { selected: event.target.checked })}
                        />
                        Incluir item opcional nesta estimativa
                      </label>
                    )}
                    {line.billingMode === "SEPARATE" && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-sm">
                          Quantidade comercial (ajuste explícito)
                          <Input
                            inputMode="decimal"
                            value={override?.quantity ?? ""}
                            onChange={(event) =>
                              update(line, { quantity: event.target.value || null })
                            }
                          />
                        </label>
                        <label className="text-sm">
                          Unidade comercial (ajuste explícito)
                          <Input
                            maxLength={80}
                            value={override?.unit ?? ""}
                            onChange={(event) => update(line, { unit: event.target.value || null })}
                          />
                        </label>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Sem ajuste, utiliza somente a quantidade explícita compatível com a unidade de
                      venda. Nenhuma conversão automática de dose, embalagem ou unidade.
                    </p>
                  </fieldset>
                );
              })}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={versionChanged || !validOverrides || !validDiscount || bps > 10000}
              onClick={() => void submit("PREVIEW")}
            >
              Calcular estimativa
            </Button>
            {data.canSave === true && (
              <Button
                type="button"
                variant="outline"
                disabled={
                  !snapshot?.previewHash ||
                  dirty ||
                  versionChanged ||
                  !validOverrides ||
                  !validDiscount
                }
                onClick={() => void submit("SAVE_ESTIMATE")}
              >
                Salvar estimativa
              </Button>
            )}
          </div>
          {pending && <p role="status">Processando estimativa…</p>}
        </fieldset>
      )}
    </section>
  );
}
export function PlanQuotesDesk() {
  const query = useInventory<{ estimates: Head[] }>("plan-quotes");
  const [selected, setSelected] = useState<Head | null>(null);
  useEffect(() => {
    const reset = () => setSelected(null);
    window.addEventListener("inventory-unit-change", reset);
    return () => window.removeEventListener("inventory-unit-change", reset);
  }, []);
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm">
        Consulta comercial de estimativas armazenadas. Este painel não carrega prontuário, doses,
        instruções clínicas ou conteúdo de receitas.
      </p>
      <ul className="space-y-2">
        {query.data!.estimates.map((entry) => (
          <li key={entry.id}>
            <Button
              className="h-auto justify-start whitespace-normal py-3 text-left"
              variant="outline"
              onClick={() => setSelected(entry)}
            >
              {entry.patientName ?? "Paciente"} · {entry.unitName ?? "Unidade autorizada"} ·{" "}
              {new Date(entry.createdAt).toLocaleString("pt-BR")} · estimativa v{entry.version}
            </Button>
          </li>
        ))}
      </ul>
      {!query.data!.estimates.length && (
        <p>Nenhuma estimativa armazenada nas unidades autorizadas.</p>
      )}
      {selected?.planId && (
        <PlanQuotePanel
          key={`${selected.planId}:${selected.id}`}
          planId={selected.planId}
          initialQuoteId={selected.id}
        />
      )}
    </div>
  );
}
