import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInventory } from "@/data/inventory-api";
import { InventoryState } from "./inventory-state";
import { PageHeader } from "./page-kit";

type Payload = {
  units: Array<{ id: string; name: string; active: boolean }>;
  rooms: Array<{ id: string; unitId: string; unitName: string; name: string; active: boolean }>;
  resources: Array<{ id: string; unitId: string; roomId: string; name: string; active: boolean }>;
  types: Array<{ id: string; code: string; name: string; active: boolean }>;
  professionals: Array<{
    id: string;
    name: string;
    email: string;
    profession: string | null;
    professionalCouncil: string | null;
    councilNumber: string | null;
    councilRegion: string | null;
    title: string | null;
  }>;
  canManageUnits: boolean;
  canManageCare: boolean;
};

export function CareSettingsPage() {
  const query = useInventory<Payload>("care-settings");
  const [form, setForm] = useState({ action: "CREATE_ROOM", unitId: "", roomId: "", name: "" });
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
      const response = await fetch("/api/v1/inventory/care-settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar.");
      await query.refetch();
      setForm({ ...form, name: "" });
      setMessage("Configuração cadastrada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }
  const roomOptions = data.rooms.filter((room) => !form.unitId || room.unitId === form.unitId);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administração"
        title="Configurações da clínica"
        description="Unidades, salas, leitos/poltronas, profissionais e tipos de atendimento."
      />
      {(message || error) && (
        <div
          role={error ? "alert" : "status"}
          className={`rounded-lg border px-4 py-3 text-sm ${error ? "text-destructive" : "text-success-foreground"}`}
        >
          {error || message}
        </div>
      )}
      {(data.canManageUnits || data.canManageCare) && (
        <form onSubmit={save} className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Novo cadastro operacional</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1 text-sm font-medium">
              O que deseja cadastrar?
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value, roomId: "" })}
              >
                {data.canManageUnits && <option value="CREATE_UNIT">Clínica / unidade</option>}
                <option value="CREATE_ROOM">Sala da clínica</option>
                <option value="CREATE_RESOURCE">Leito / poltrona</option>
                {data.canManageUnits && <option value="CREATE_TYPE">Tipo de atendimento</option>}
              </select>
            </label>
            {!["CREATE_UNIT", "CREATE_TYPE"].includes(form.action) && (
              <label className="space-y-1 text-sm font-medium">
                Unidade
                <select
                  required
                  className="h-10 w-full rounded-md border bg-background px-3"
                  value={form.unitId}
                  onChange={(e) => setForm({ ...form, unitId: e.target.value, roomId: "" })}
                >
                  <option value="">Selecione</option>
                  {data.units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {form.action === "CREATE_RESOURCE" && (
              <label className="space-y-1 text-sm font-medium">
                Sala
                <select
                  required
                  className="h-10 w-full rounded-md border bg-background px-3"
                  value={form.roomId}
                  onChange={(e) => setForm({ ...form, roomId: e.target.value })}
                >
                  <option value="">Selecione</option>
                  {roomOptions.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="space-y-1 text-sm font-medium">
              Nome
              <Input
                required
                minLength={form.action === "CREATE_RESOURCE" ? 1 : 2}
                maxLength={100}
                placeholder={form.action === "CREATE_RESOURCE" ? "Ex.: Poltrona 1" : "Nome"}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
          </div>
          <Button disabled={pending}>
            <Plus className="mr-2 size-4" />
            {pending ? "Salvando…" : "Cadastrar"}
          </Button>
        </form>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Clínicas e salas</h2>
          <div className="mt-3 space-y-3">
            {data.units.map((unit) => (
              <div key={unit.id}>
                <p className="font-medium">{unit.name}</p>
                <p className="text-sm text-muted-foreground">
                  {data.rooms
                    .filter((r) => r.unitId === unit.id)
                    .map(
                      (room) =>
                        `${room.name}${
                          data.resources.some((resource) => resource.roomId === room.id)
                            ? ` (${data.resources
                                .filter((resource) => resource.roomId === room.id)
                                .map((resource) => resource.name)
                                .join(", ")})`
                            : ""
                        }`,
                    )
                    .join(" · ") || "Nenhuma sala cadastrada"}
                </p>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Tipos de atendimento</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            {data.types.map((type) => type.name).join(" · ")}
          </p>
        </section>
        <section className="rounded-xl border bg-card p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Profissionais da saúde</h2>
              <p className="text-sm text-muted-foreground">
                {data.professionals
                  .map(
                    (professional) =>
                      `${professional.name}${professional.profession ? ` · ${professional.profession}` : ""}${professional.professionalCouncil && professional.councilNumber && professional.councilRegion ? ` · ${professional.professionalCouncil} ${professional.councilNumber}/${professional.councilRegion}` : ""}`,
                  )
                  .join(" · ") || "Nenhum profissional cadastrado"}
              </p>
            </div>
            <Button asChild variant="outline">
              <Link to="/estoque/usuarios">Cadastrar profissional</Link>
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
