import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ArrowLeft, FileText, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { PageHeader } from "./page-kit";

type Treatment = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  doseQuantity: string;
  doseUnit: string;
  route: string;
  frequencyEveryDays: string;
  firstScheduledOn: string;
  plannedAdministrations: number | null;
  status: string;
  version: number;
};
type Payload = {
  patient: {
    id: string;
    fullName: string;
    internalCode: string;
    unitName: string;
    active: boolean;
  };
  treatments: Treatment[];
  prescriptions: Array<{
    id: string;
    treatmentId: string;
    originalFilename: string;
    contentType: string;
    sizeBytes: number;
    uploadedAt: string;
  }>;
  products: Array<{ id: string; name: string; sku: string; unit: string }>;
  canManage: boolean;
};
const blank = {
  productId: "",
  doseQuantity: "",
  doseUnit: "MG",
  route: "IM",
  frequencyEveryDays: "7",
  firstScheduledOn: "",
  plannedAdministrations: "",
  status: "PLANNED",
  reason: "Cadastro inicial do tratamento prescrito.",
};
const statusLabels: Record<string, string> = {
  PLANNED: "Planejado",
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  COMPLETED: "Concluído",
  CANCELED: "Cancelado",
};

export function PatientTreatmentPage({ patientId }: { patientId: string }) {
  const query = useInventory<Payload>(`patient-detail?patientId=${patientId}`);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (query.isPending || query.error)
    return (
      <InventoryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    );
  const data = query.data!;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "CREATE_TREATMENT",
          id: crypto.randomUUID(),
          patientId,
          ...form,
          doseQuantity: Number(form.doseQuantity),
          frequencyEveryDays: Number(form.frequencyEveryDays),
          plannedAdministrations: form.plannedAdministrations
            ? Number(form.plannedAdministrations)
            : null,
          version: 0,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar.");
      await query.refetch();
      setForm(blank);
      setOpen(false);
      setMessage("Tratamento cadastrado e auditado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const body = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/v1/inventory/patient-detail?patientId=${patientId}`, {
        method: "POST",
        body,
        credentials: "same-origin",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível enviar.");
      await query.refetch();
      event.currentTarget.reset();
      setMessage("Prescrição armazenada de forma privada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      <Link
        to="/pacientes"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Voltar aos pacientes
      </Link>
      <PageHeader
        eyebrow={`${data.patient.internalCode} · ${data.patient.unitName}`}
        title={data.patient.fullName}
        description="Plano operacional de aplicações. Não substitui prontuário, avaliação clínica ou prescrição médica."
        action={
          data.canManage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 size-4" />
              Novo tratamento
            </Button>
          ) : undefined
        }
      />
      {(message || error) && (
        <div
          role={error ? "alert" : "status"}
          className={`rounded-lg border px-4 py-3 text-sm ${error ? "text-destructive" : "text-success-foreground"}`}
        >
          {error || message}
        </div>
      )}
      {open && data.canManage && (
        <form onSubmit={save} className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Tratamento prescrito</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1 text-sm font-medium md:col-span-2">
              Produto
              <select
                required
                className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                value={form.productId}
                onChange={(e) => setForm({ ...form, productId: e.target.value })}
              >
                <option value="">Selecione</option>
                {data.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.sku}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Via
              <Input
                required
                value={form.route}
                onChange={(e) => setForm({ ...form, route: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Dose
              <Input
                required
                type="number"
                min="0.000001"
                step="0.000001"
                value={form.doseQuantity}
                onChange={(e) => setForm({ ...form, doseQuantity: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Unidade da dose
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.doseUnit}
                onChange={(e) => setForm({ ...form, doseUnit: e.target.value })}
              >
                <option>MG</option>
                <option>ML</option>
                <option>UI</option>
                <option>UNIT</option>
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Aplicar a cada (dias)
              <Input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={form.frequencyEveryDays}
                onChange={(e) => setForm({ ...form, frequencyEveryDays: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Primeira aplicação
              <Input
                required
                type="date"
                value={form.firstScheduledOn}
                onChange={(e) => setForm({ ...form, firstScheduledOn: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Aplicações previstas
              <Input
                type="number"
                min="1"
                value={form.plannedAdministrations}
                onChange={(e) => setForm({ ...form, plannedAdministrations: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Situação
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {Object.entries(statusLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium md:col-span-3">
              Motivo
              <Input
                required
                minLength={10}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </label>
          </div>
          <div className="flex gap-3">
            <Button disabled={pending}>{pending ? "Salvando…" : "Salvar tratamento"}</Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      <section className="rounded-xl border bg-card">
        <div className="border-b p-5">
          <h2 className="font-semibold">Tratamentos</h2>
        </div>
        {data.treatments.length ? (
          <div className="divide-y">
            {data.treatments.map((t) => (
              <div key={t.id} className="grid gap-3 p-5 md:grid-cols-[1fr_auto]">
                <div>
                  <p className="font-medium">{t.productName}</p>
                  <p className="text-sm text-muted-foreground">
                    {t.doseQuantity} {t.doseUnit} · {t.route} · a cada {t.frequencyEveryDays} dias ·
                    início {String(t.firstScheduledOn).slice(0, 10).split("-").reverse().join("/")}
                  </p>
                </div>
                <Badge>{statusLabels[t.status] ?? t.status}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Nenhum tratamento cadastrado.
          </p>
        )}
      </section>
      {data.canManage && data.treatments.length > 0 && (
        <form onSubmit={upload} className="space-y-4 rounded-xl border bg-card p-5">
          <div>
            <h2 className="font-semibold">Anexar prescrição</h2>
            <p className="text-sm text-muted-foreground">
              PDF ou foto, até 10 MB. O arquivo será privado e baixado somente após autorização.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              Tratamento
              <select
                name="treatmentId"
                required
                className="h-10 w-full rounded-md border bg-background px-3"
              >
                {data.treatments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.productName}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Arquivo
              <Input
                name="file"
                required
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/heic,image/heif"
              />
            </label>
            <label className="space-y-1 text-sm font-medium md:col-span-2">
              Motivo
              <Input
                name="reason"
                required
                minLength={10}
                defaultValue="Prescrição conferida e anexada ao tratamento."
              />
            </label>
          </div>
          <Button disabled={pending}>{pending ? "Enviando…" : "Guardar prescrição"}</Button>
        </form>
      )}
      <section className="rounded-xl border bg-card">
        <div className="border-b p-5">
          <h2 className="font-semibold">Prescrições protegidas</h2>
        </div>
        {data.prescriptions.length ? (
          <div className="divide-y">
            {data.prescriptions.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-4 p-5">
                <div className="flex items-center gap-3">
                  <FileText className="size-5 text-primary" />
                  <div>
                    <p className="font-medium">{p.originalFilename}</p>
                    <p className="text-xs text-muted-foreground">
                      {Math.ceil(p.sizeBytes / 1024)} KB
                    </p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`/api/v1/inventory/prescriptions/${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir
                  </a>
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma prescrição anexada.
          </p>
        )}
      </section>
    </div>
  );
}
