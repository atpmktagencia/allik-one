import { Plus, Trash2, Pencil, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InventoryError, readInventoryResponse, useInventory } from "@/data/inventory-api";
import {
  administrationCountCheck,
  type TherapeuticPrescriptionSource,
} from "@/data/encounter-prescription";
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
  plannedAdministrationsReason?: string;
};
type DraftPrescriptionItem = Omit<
  PrescriptionItem,
  "doseQuantity" | "doseUnit" | "frequencyEvery" | "frequencyUnit"
> & {
  doseQuantity: number | null;
  doseUnit: PrescriptionItem["doseUnit"] | "";
  frequencyEvery: number | null;
  frequencyUnit: PrescriptionItem["frequencyUnit"] | "";
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

const emptyItem = (): DraftPrescriptionItem => ({
  id: crypto.randomUUID(),
  productId: null,
  medicationName: "",
  doseQuantity: null,
  doseUnit: "",
  doseUnitOther: "",
  route: "",
  frequencyEvery: null,
  frequencyUnit: "",
  durationAmount: null,
  durationUnit: null,
  continuousUse: false,
  plannedAdministrations: null,
  instructions: "",
});

function prescriptionFingerprint(items: DraftPrescriptionItem[], generalInstructions: string) {
  const keys = [
    "id",
    "productId",
    "medicationName",
    "doseQuantity",
    "doseUnit",
    "doseUnitOther",
    "route",
    "frequencyEvery",
    "frequencyUnit",
    "durationAmount",
    "durationUnit",
    "continuousUse",
    "plannedAdministrations",
    "instructions",
    "plannedAdministrationsReason",
  ] as const;
  return JSON.stringify({
    items: items.map((item) =>
      keys.map((key) => {
        const value = key === "plannedAdministrationsReason" ? (item[key] ?? "") : item[key];
        return typeof value === "string" ? value.trim() : value;
      }),
    ),
    generalInstructions: generalInstructions.trim(),
  });
}

export function EncounterPrescriptionCard({
  appointmentId,
  onDraftStateChange,
  onInsertIntoDocument,
  canInsertIntoDocument = true,
  searchQuery = "",
}: {
  appointmentId: string;
  onDraftStateChange?: (state: { dirty: boolean; pending: boolean }) => void;
  onInsertIntoDocument?: (text: string, source: TherapeuticPrescriptionSource) => void;
  canInsertIntoDocument?: boolean;
  searchQuery?: string;
}) {
  const query = useInventory<Payload>(`encounter-prescriptions?appointmentId=${appointmentId}`);
  const [items, setItems] = useState<DraftPrescriptionItem[]>([]);
  const [generalInstructions, setGeneralInstructions] = useState("");
  const [loadedId, setLoadedId] = useState<string | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [uncertainSave, setUncertainSave] = useState<null | {
    version: number;
    originalVersion: number | null;
    status: "DRAFT" | "FINAL";
    fingerprint: string;
  }>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onDraftStateChange?.({ dirty, pending });
  }, [dirty, pending, onDraftStateChange]);
  useEffect(() => {
    setLoadedId(undefined);
    setBaseVersion(null);
    setUncertainSave(null);
    setItems([]);
    setGeneralInstructions("");
    setEditingItemId(null);
    setDirty(false);
  }, [appointmentId]);
  const loaded = query.data?.prescription;

  useEffect(() => {
    const revision = loaded ? `${loaded.id}:${loaded.version}` : null;
    if (!query.data || dirty || pending || loadedId === revision) return;
    setLoadedId(revision);
    setBaseVersion(loaded?.version ?? null);
    setItems(loaded?.items ?? []);
    setGeneralInstructions(loaded?.generalInstructions ?? "");
    setDirty(false);
  }, [loaded, loadedId, query.data, dirty, pending]);

  if (!query.data && (query.isPending || query.error))
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );

  const data = query.data!;
  const disabled = !data.canAuthor || data.prescription?.status === "FINAL";

  function updateItem(id: string, values: Partial<DraftPrescriptionItem>) {
    setDirty(true);
    const recount = [
      "frequencyEvery",
      "frequencyUnit",
      "durationAmount",
      "durationUnit",
      "continuousUse",
      "plannedAdministrations",
    ].some((key) => Object.hasOwn(values, key));
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, ...values, ...(recount ? { plannedAdministrationsReason: "" } : {}) }
          : item,
      ),
    );
  }

  async function save(action: "SAVE_DRAFT" | "FINALIZE", clearDraft = false) {
    if (pending || uncertainSave) return;
    const savingItems = clearDraft ? [] : items;
    const savingInstructions = clearDraft ? "" : generalInstructions;
    if (
      action === "FINALIZE" &&
      !window.confirm(
        "Finalizar e assinar esta prescrição? Depois disso, ela não poderá ser alterada.",
      )
    )
      return;
    if (
      savingItems.some(
        (item) =>
          administrationCountCheck(item).needsReason &&
          (item.plannedAdministrationsReason?.trim().length ?? 0) < 10,
      )
    ) {
      setError(
        "Confira o número de aplicações e justifique a divergência ou contagem indeterminada em cada item.",
      );
      return;
    }
    setPending(true);
    setMessage("");
    setError("");
    const attempt = {
      version: baseVersion === null ? 0 : baseVersion + 1,
      originalVersion: baseVersion,
      status: action === "FINALIZE" ? ("FINAL" as const) : ("DRAFT" as const),
      fingerprint: prescriptionFingerprint(savingItems, savingInstructions),
    };
    try {
      const response = await fetch("/api/v1/inventory/encounter-prescriptions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          appointmentId,
          items: savingItems,
          generalInstructions: savingInstructions,
          version: baseVersion,
        }),
      });
      await readInventoryResponse(response, "Não foi possível salvar a prescrição.");
      const refreshed = await query.refetch();
      if (refreshed.error || !refreshed.data)
        throw new Error(
          "O servidor recebeu a gravação, mas a releitura não foi confirmada. O texto local foi preservado; confira o registro antes de tentar novamente.",
        );
      const saved = refreshed.data.prescription;
      if (
        !saved ||
        saved.version !== attempt.version ||
        saved.status !== attempt.status ||
        prescriptionFingerprint(saved.items, saved.generalInstructions) !== attempt.fingerprint
      )
        throw new Error(
          "A gravação e a releitura não coincidem. Seus campos locais foram preservados; confira o salvamento sem reenviar.",
        );
      setBaseVersion(saved.version);
      setLoadedId(`${saved.id}:${saved.version}`);
      setUncertainSave(null);
      setItems(refreshed.data.prescription?.items ?? []);
      setGeneralInstructions(refreshed.data.prescription?.generalInstructions ?? "");
      setDirty(false);
      setMessage(action === "FINALIZE" ? "Prescrição finalizada." : "Rascunho salvo.");
    } catch (cause) {
      if (!(cause instanceof InventoryError) || cause.status >= 500) setUncertainSave(attempt);
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }

  async function reconcileSave() {
    if (!uncertainSave || pending) return;
    setPending(true);
    try {
      const refreshed = await query.refetch();
      if (refreshed.error || !refreshed.data)
        throw new Error(
          "Não foi possível conferir o salvamento. Seus campos locais foram preservados.",
        );
      const saved = refreshed.data.prescription;
      if (
        saved?.version === uncertainSave.version &&
        saved.status === uncertainSave.status &&
        prescriptionFingerprint(saved.items, saved.generalInstructions) ===
          uncertainSave.fingerprint
      ) {
        setBaseVersion(saved.version);
        setLoadedId(`${saved.id}:${saved.version}`);
        setDirty(prescriptionFingerprint(items, generalInstructions) !== uncertainSave.fingerprint);
        setUncertainSave(null);
        setError("");
        setMessage(
          "Salvamento anterior confirmado sem reenviar. Alterações locais posteriores continuam pendentes.",
        );
      } else if ((saved?.version ?? null) === uncertainSave.originalVersion) {
        setUncertainSave(null);
        setError(
          "A releitura não encontrou a gravação anterior. Seus campos continuam locais; confira e salve novamente.",
        );
      } else {
        setError(
          "O servidor possui uma versão diferente. Seus campos locais foram preservados; resolva a divergência antes de reenviar.",
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível conferir o salvamento.");
    } finally {
      setPending(false);
    }
  }

  function insertSavedItems() {
    if (
      !onInsertIntoDocument ||
      !canInsertIntoDocument ||
      dirty ||
      pending ||
      !loaded?.items.length
    )
      return;
    const timeUnits = { HOUR: "hora(s)", DAY: "dia(s)", WEEK: "semana(s)", MONTH: "mês(es)" };
    const doseUnits = {
      MG: "mg",
      MCG: "mcg",
      G: "g",
      ML: "mL",
      UI: "UI",
      UNIT: "unidade(s)",
      OTHER: "",
    };
    // Only a backend-validated saved snapshot can cross into the printable document.
    if (
      loaded.items.some(
        (item) =>
          !item.medicationName?.trim() ||
          !Number.isFinite(item.doseQuantity) ||
          item.doseQuantity <= 0 ||
          !item.route?.trim() ||
          !Number.isInteger(item.frequencyEvery) ||
          item.frequencyEvery <= 0 ||
          !timeUnits[item.frequencyUnit] ||
          !Object.hasOwn(doseUnits, item.doseUnit) ||
          (item.doseUnit === "OTHER" && !item.doseUnitOther.trim()) ||
          (!item.continuousUse &&
            (!item.durationAmount || !item.durationUnit || !timeUnits[item.durationUnit])),
      )
    ) {
      setError("Confira e salve os campos estruturados de cada item antes de inserir na receita.");
      return;
    }
    const content = loaded.items
      .map((item, index) => {
        const doseUnit = item.doseUnit === "OTHER" ? item.doseUnitOther : doseUnits[item.doseUnit];
        return [
          `${index + 1}. ${item.medicationName}`,
          `Dose: ${item.doseQuantity} ${doseUnit}. Via: ${item.route}.`,
          `A cada ${item.frequencyEvery} ${timeUnits[item.frequencyUnit]}. ${item.continuousUse ? "Uso contínuo." : `Durante ${item.durationAmount} ${timeUnits[item.durationUnit!]}.`}`,
          item.plannedAdministrations
            ? `Número de aplicações: ${item.plannedAdministrations}.`
            : "",
          item.plannedAdministrationsReason
            ? `Conferência das aplicações: ${item.plannedAdministrationsReason}`
            : "",
          item.instructions,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
    onInsertIntoDocument(
      [
        content,
        loaded.generalInstructions ? `Orientações gerais: ${loaded.generalInstructions}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      { prescriptionId: loaded.id, version: loaded.version, updatedAt: loaded.updatedAt },
    );
  }
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase("pt-BR");
  const visibleItems = items.filter(
    (item) =>
      !normalizedSearch ||
      `${item.medicationName} ${item.instructions}`
        .toLocaleLowerCase("pt-BR")
        .includes(normalizedSearch),
  );
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Registro terapêutico</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Salvamento independente da receita. Não reserva produtos, calcula valores ou baixa
            estoque.
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
      {uncertainSave && (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => void reconcileSave()}
        >
          Conferir salvamento sem reenviar
        </Button>
      )}
      {items.length ? (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[650px] text-left text-xs">
              <thead className="bg-slate-50 text-[11px] text-slate-500">
                <tr>
                  <th className="px-3 py-3 font-medium">Medicamento / tratamento</th>
                  <th className="px-3 py-3 font-medium">Dose / Posologia</th>
                  <th className="px-3 py-3 font-medium">Via</th>
                  <th className="px-3 py-3 font-medium">Duração</th>
                  <th className="px-3 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => {
                  const index = items.findIndex((entry) => entry.id === item.id);
                  return (
                    <tr key={item.id} className="border-t border-slate-100">
                      <td className="px-3 py-3 font-medium">
                        {item.medicationName || `Item ${index + 1} — preencher`}
                      </td>
                      <td className="px-3 py-3">
                        {item.doseQuantity}{" "}
                        {item.doseUnit === "OTHER"
                          ? item.doseUnitOther
                          : item.doseUnit === "UNIT"
                            ? "unidade(s)"
                            : item.doseUnit.toLowerCase()}
                        <span className="mt-1 block text-muted-foreground">
                          A cada {item.frequencyEvery}{" "}
                          {
                            { HOUR: "hora(s)", DAY: "dia(s)", WEEK: "semana(s)", MONTH: "mês(es)" }[
                              item.frequencyUnit as PrescriptionItem["frequencyUnit"]
                            ]
                          }
                        </span>
                      </td>
                      <td className="px-3 py-3">{item.route || "Não informada"}</td>
                      <td className="px-3 py-3">
                        {item.continuousUse
                          ? "Uso contínuo"
                          : item.durationAmount && item.durationUnit
                            ? `${item.durationAmount} ${{ DAY: "dia(s)", WEEK: "semana(s)", MONTH: "mês(es)" }[item.durationUnit]}`
                            : "Não informada"}
                      </td>
                      <td className="px-3 py-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-teal-700"
                          aria-label={`${editingItemId === item.id ? "Recolher" : disabled ? "Ver" : "Editar"} item ${index + 1}`}
                          aria-expanded={editingItemId === item.id}
                          onClick={() =>
                            setEditingItemId((current) => (current === item.id ? null : item.id))
                          }
                        >
                          {editingItemId === item.id ? (
                            <ChevronUp size={14} />
                          ) : (
                            <Pencil size={14} />
                          )}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {items.map((item, index) => (
            <fieldset
              key={item.id}
              hidden={editingItemId !== item.id}
              disabled={disabled || pending}
              className="space-y-4 rounded-lg border border-teal-100 bg-teal-50/20 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <legend className="font-medium">Item {index + 1}</legend>
                {!disabled ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remover item ${index + 1}`}
                    onClick={() => {
                      setDirty(true);
                      setItems((current) => current.filter(({ id }) => id !== item.id));
                    }}
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
                    {data.products
                      .filter(
                        (product) =>
                          product.id === item.productId ||
                          !normalizedSearch ||
                          `${product.name} ${product.sku}`
                            .toLocaleLowerCase("pt-BR")
                            .includes(normalizedSearch),
                      )
                      .map((product) => (
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
                    value={item.doseQuantity ?? ""}
                    onChange={(event) =>
                      updateItem(item.id, {
                        doseQuantity: event.target.value ? Number(event.target.value) : null,
                      })
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
                    <option value="">Selecione a unidade</option>
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
                        value={item.frequencyEvery ?? ""}
                        onChange={(event) =>
                          updateItem(item.id, {
                            frequencyEvery: event.target.value ? Number(event.target.value) : null,
                          })
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
                        <option value="">Selecione o intervalo</option>
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
                          durationAmount: null,
                          durationUnit: null,
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
                          <option value="">Selecione a duração</option>
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
              {item.plannedAdministrations !== null && (
                <div className="space-y-2 rounded-md border p-3 text-sm">
                  <p>
                    {administrationCountCheck(item).expected === null
                      ? "Contagem indeterminada: uso contínuo, calendário mensal misto ou posologia incompleta. Não convertemos meses em dias."
                      : `Conferência aritmética: ${administrationCountCheck(item).expected} administração(ões), considerando a primeira no início e os intervalos informados. Não calcula unidades por dose.`}
                  </p>
                  {administrationCountCheck(item).needsReason && (
                    <label className="block space-y-1 font-medium">
                      Justificativa para o número de aplicações
                      <Textarea
                        aria-label="Justificativa para o número de aplicações"
                        value={item.plannedAdministrationsReason ?? ""}
                        minLength={10}
                        maxLength={1000}
                        onChange={(event) =>
                          updateItem(item.id, { plannedAdministrationsReason: event.target.value })
                        }
                      />
                      <span className="text-xs font-normal text-muted-foreground">
                        Confira a posologia. Uma exceção exige justificativa explícita do
                        prescritor, registrada no histórico.
                      </span>
                    </label>
                  )}
                </div>
              )}
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
          disabled={pending}
          onClick={() => {
            setDirty(true);
            const item = emptyItem();
            setItems((current) => [...current, item]);
            setEditingItemId(item.id);
          }}
        >
          <Plus /> Adicionar item
        </Button>
      ) : null}
      <label className="block space-y-1 text-sm font-medium">
        Orientações gerais
        <Textarea
          value={generalInstructions}
          disabled={disabled || pending}
          rows={4}
          maxLength={5000}
          onChange={(event) => {
            setDirty(true);
            setGeneralInstructions(event.target.value);
          }}
        />
      </label>
      {data.prescription ? (
        <p className="text-xs text-muted-foreground">
          {data.prescription.authorName} · {data.prescription.professionalCouncil}{" "}
          {data.prescription.councilNumber}/{data.prescription.councilRegion}
        </p>
      ) : null}
      {onInsertIntoDocument && (
        <div className="space-y-2 rounded-lg border border-teal-100 bg-teal-50/40 p-3">
          <Button
            type="button"
            variant="outline"
            disabled={!canInsertIntoDocument || dirty || pending || !loaded?.items.length}
            onClick={insertSavedItems}
          >
            Inserir itens na receita
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            Salve este registro e crie uma receita em Novo documento. A inserção é explícita; revise
            o documento antes de finalizar. Alterações posteriores não sincronizam os dois
            registros.
          </p>
        </div>
      )}
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          {data.prescription && (items.length > 0 || generalInstructions.trim()) && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending || Boolean(uncertainSave)}
              onClick={() => {
                if (
                  window.confirm(
                    "Limpar o rascunho do registro terapêutico? O histórico será preservado e nenhuma receita será finalizada.",
                  )
                )
                  void save("SAVE_DRAFT", true);
              }}
            >
              Limpar rascunho
            </Button>
          )}
          <Button
            variant="outline"
            disabled={pending || Boolean(uncertainSave)}
            onClick={() => save("SAVE_DRAFT")}
          >
            {pending ? "Salvando…" : "Salvar rascunho"}
          </Button>
          <Button
            disabled={pending || Boolean(uncertainSave) || items.length === 0}
            onClick={() => save("FINALIZE")}
          >
            {pending ? "Finalizando…" : "Finalizar prescrição"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
