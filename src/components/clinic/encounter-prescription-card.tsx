import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";

type PrescriptionItem = {
  id: string;
  productId: string | null;
  medicationName: string;
  doseQuantity: number;
  doseUnit: "MG" | "MCG" | "G" | "ML" | "UI" | "UNIT" | "OTHER";
  doseUnitOther: string;
  route: string;
  frequencyEvery: number;
  frequencyUnit: "HOUR" | "DAY" | "WEEK" | "MONTH";
  durationAmount: number | null;
  durationUnit: "DAY" | "WEEK" | "MONTH" | null;
  continuousUse: boolean;
  frequency?: string;
  duration?: string;
  plannedAdministrations: number | null;
  instructions: string;
};

type Payload = {
  prescription: null | {
    id: string;
    items: PrescriptionItem[];
    generalInstructions: string;
    status: "DRAFT" | "FINAL";
    version: number;
    authorName: string;
    professionalCouncil: string;
    councilNumber: string;
    councilRegion: string;
    finalizedAt: string | null;
    updatedAt: string;
  };
  products: Array<{ id: string; name: string; sku: string; unit: string }>;
  canAuthor: boolean;
};

const emptyItem = (): PrescriptionItem => ({
  id: crypto.randomUUID(),
  productId: null,
  medicationName: "",
  doseQuantity: 1,
  doseUnit: "MG",
  doseUnitOther: "",
  route: "",
  frequencyEvery: 1,
  frequencyUnit: "WEEK",
  durationAmount: 4,
  durationUnit: "WEEK",
  continuousUse: false,
  plannedAdministrations: null,
  instructions: "",
});

export function EncounterPrescriptionCard({ appointmentId }: { appointmentId: string }) {
  const query = useInventory<Payload>(`encounter-prescriptions?appointmentId=${appointmentId}`);
  const [items, setItems] = useState<PrescriptionItem[]>([]);
  const [generalInstructions, setGeneralInstructions] = useState("");
  const [loadedId, setLoadedId] = useState<string | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const loaded = query.data?.prescription;

  useEffect(() => {
    if (!query.data || loadedId === (loaded?.id ?? null)) return;
    setLoadedId(loaded?.id ?? null);
    setItems(
      (loaded?.items ?? []).map((item) => ({
        ...item,
        frequencyEvery: item.frequencyEvery ?? 1,
        frequencyUnit: item.frequencyUnit ?? "WEEK",
        durationAmount: item.durationAmount ?? 4,
        durationUnit: item.durationUnit ?? "WEEK",
        continuousUse: item.continuousUse ?? false,
      })),
    );
    setGeneralInstructions(loaded?.generalInstructions ?? "");
  }, [loaded, loadedId, query.data]);

  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );

  const data = query.data!;
  const disabled = !data.canAuthor || data.prescription?.status === "FINAL";

  function updateItem(id: string, values: Partial<PrescriptionItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...values } : item)));
  }

  async function save(action: "SAVE_DRAFT" | "FINALIZE") {
    if (
      action === "FINALIZE" &&
      !window.confirm(
        "Finalizar e assinar esta prescrição? Depois disso, ela não poderá ser alterada.",
      )
    )
      return;
    setPending(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/v1/inventory/encounter-prescriptions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          appointmentId,
          items,
          generalInstructions,
          version: data.prescription?.version ?? null,
        }),
      });
      await readInventoryResponse(response, "Não foi possível salvar a prescrição.");
      await query.refetch();
      setMessage(action === "FINALIZE" ? "Prescrição finalizada." : "Rascunho salvo.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Prescrição do atendimento</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Registro terapêutico. Não reserva produtos, calcula valores ou baixa estoque.
          </p>
        </div>
        <Badge variant="outline">
          {data.prescription?.status === "FINAL"
            ? "Finalizada"
            : data.prescription
              ? "Rascunho"
              : "Não iniciada"}
        </Badge>
      </div>
      {(message || error) && (
        <div role={error ? "alert" : "status"} className="rounded-lg border px-4 py-3 text-sm">
          {error || message}
        </div>
      )}
      {items.length ? (
        <div className="space-y-4">
          {items.map((item, index) => (
            <fieldset key={item.id} disabled={disabled} className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <legend className="font-medium">Item {index + 1}</legend>
                {!disabled ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remover item ${index + 1}`}
                    onClick={() =>
                      setItems((current) => current.filter(({ id }) => id !== item.id))
                    }
                  >
                    <Trash2 /> Remover
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1 text-sm font-medium">
                  Produto do catálogo (opcional)
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                    value={item.productId ?? ""}
                    onChange={(event) => {
                      const product = data.products.find(({ id }) => id === event.target.value);
                      updateItem(item.id, {
                        productId: product?.id ?? null,
                        medicationName: product?.name ?? item.medicationName,
                      });
                    }}
                  >
                    <option value="">Medicamento ou item não cadastrado</option>
                    {data.products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} · {product.sku}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Medicamento ou tratamento
                  <Input
                    value={item.medicationName}
                    readOnly={Boolean(item.productId)}
                    required
                    minLength={2}
                    maxLength={200}
                    onChange={(event) =>
                      updateItem(item.id, { medicationName: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1 text-sm font-medium">
                  Dose
                  <Input
                    type="number"
                    min="0.000001"
                    step="any"
                    required
                    value={item.doseQuantity}
                    onChange={(event) =>
                      updateItem(item.id, { doseQuantity: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Unidade
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                    value={item.doseUnit}
                    onChange={(event) =>
                      updateItem(item.id, {
                        doseUnit: event.target.value as PrescriptionItem["doseUnit"],
                      })
                    }
                  >
                    {["MG", "MCG", "G", "ML", "UI", "UNIT", "OTHER"].map((unit) => (
                      <option key={unit} value={unit}>
                        {unit === "UNIT" ? "Unidade" : unit === "OTHER" ? "Outra" : unit}
                      </option>
                    ))}
                  </select>
                </label>
                {item.doseUnit === "OTHER" ? (
                  <label className="space-y-1 text-sm font-medium">
                    Outra unidade
                    <Input
                      value={item.doseUnitOther}
                      required
                      maxLength={30}
                      onChange={(event) =>
                        updateItem(item.id, { doseUnitOther: event.target.value })
                      }
                    />
                  </label>
                ) : null}
                <label className="space-y-1 text-sm font-medium">
                  Via
                  <Input
                    value={item.route}
                    required
                    minLength={2}
                    maxLength={80}
                    placeholder="Ex.: IM, EV, oral"
                    onChange={(event) => updateItem(item.id, { route: event.target.value })}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Número de aplicações (opcional)
                  <Input
                    type="number"
                    min="1"
                    max="1000"
                    value={item.plannedAdministrations ?? ""}
                    onChange={(event) =>
                      updateItem(item.id, {
                        plannedAdministrations: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <fieldset className="space-y-2 rounded-md border p-3">
                  <legend className="px-1 text-sm font-medium">Frequência de administração</legend>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-2">
                    <label className="space-y-1 text-xs text-muted-foreground">
                      A cada
                      <Input
                        aria-label={`Intervalo da frequência do item ${index + 1}`}
                        type="number"
                        min="1"
                        max="365"
                        step="1"
                        required
                        value={item.frequencyEvery}
                        onChange={(event) =>
                          updateItem(item.id, { frequencyEvery: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      Unidade do intervalo
                      <select
                        aria-label={`Unidade da frequência do item ${index + 1}`}
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                        value={item.frequencyUnit}
                        onChange={(event) =>
                          updateItem(item.id, {
                            frequencyUnit: event.target.value as PrescriptionItem["frequencyUnit"],
                          })
                        }
                      >
                        <option value="HOUR">hora(s)</option>
                        <option value="DAY">dia(s)</option>
                        <option value="WEEK">semana(s)</option>
                        <option value="MONTH">mês(es)</option>
                      </select>
                    </label>
                  </div>
                  {item.frequency ? (
                    <p className="text-xs text-warning-foreground">
                      Registro anterior: {item.frequency}. Confira a conversão estruturada.
                    </p>
                  ) : null}
                </fieldset>
                <fieldset className="space-y-2 rounded-md border p-3">
                  <legend className="px-1 text-sm font-medium">Duração do tratamento</legend>
                  <label className="flex min-h-10 items-center gap-2 text-sm font-normal">
                    <input
                      type="checkbox"
                      checked={item.continuousUse}
                      onChange={(event) =>
                        updateItem(item.id, {
                          continuousUse: event.target.checked,
                          durationAmount: event.target.checked ? null : 4,
                          durationUnit: event.target.checked ? null : "WEEK",
                        })
                      }
                    />
                    Uso contínuo
                  </label>
                  {!item.continuousUse ? (
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-2">
                      <label className="space-y-1 text-xs text-muted-foreground">
                        Durante
                        <Input
                          aria-label={`Quantidade da duração do item ${index + 1}`}
                          type="number"
                          min="1"
                          max="3650"
                          step="1"
                          required
                          value={item.durationAmount ?? ""}
                          onChange={(event) =>
                            updateItem(item.id, {
                              durationAmount: event.target.value
                                ? Number(event.target.value)
                                : null,
                            })
                          }
                        />
                      </label>
                      <label className="space-y-1 text-xs text-muted-foreground">
                        Unidade da duração
                        <select
                          aria-label={`Unidade da duração do item ${index + 1}`}
                          className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                          value={item.durationUnit ?? ""}
                          onChange={(event) =>
                            updateItem(item.id, {
                              durationUnit: event.target.value as NonNullable<
                                PrescriptionItem["durationUnit"]
                              >,
                            })
                          }
                        >
                          <option value="DAY">dia(s)</option>
                          <option value="WEEK">semana(s)</option>
                          <option value="MONTH">mês(es)</option>
                        </select>
                      </label>
                    </div>
                  ) : null}
                  {item.duration ? (
                    <p className="text-xs text-warning-foreground">
                      Registro anterior: {item.duration}. Confira a conversão estruturada.
                    </p>
                  ) : null}
                </fieldset>
              </div>
              <label className="block space-y-1 text-sm font-medium">
                Orientações adicionais
                <Textarea
                  value={item.instructions}
                  rows={3}
                  maxLength={2000}
                  onChange={(event) => updateItem(item.id, { instructions: event.target.value })}
                />
              </label>
            </fieldset>
          ))}
        </div>
      ) : (
        <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
          Nenhum item adicionado à prescrição.
        </p>
      )}
      {!disabled ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setItems((current) => [...current, emptyItem()])}
        >
          <Plus /> Adicionar item
        </Button>
      ) : null}
      <label className="block space-y-1 text-sm font-medium">
        Orientações gerais
        <Textarea
          value={generalInstructions}
          disabled={disabled}
          rows={4}
          maxLength={5000}
          onChange={(event) => setGeneralInstructions(event.target.value)}
        />
      </label>
      {data.prescription ? (
        <p className="text-xs text-muted-foreground">
          {data.prescription.authorName} · {data.prescription.professionalCouncil}{" "}
          {data.prescription.councilNumber}/{data.prescription.councilRegion}
        </p>
      ) : null}
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending} onClick={() => save("SAVE_DRAFT")}>
            {pending ? "Salvando…" : "Salvar rascunho"}
          </Button>
          <Button disabled={pending || items.length === 0} onClick={() => save("FINALIZE")}>
            {pending ? "Finalizando…" : "Finalizar prescrição"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
