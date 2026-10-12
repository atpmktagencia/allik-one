import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Unit = { id: string; name: string };
type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  profession?: string | null;
  title?: string | null;
  professionalCouncil?: string | null;
  councilNumber?: string | null;
  councilRegion?: string | null;
  units: Unit[];
};
export const Route = createFileRoute("/estoque/usuarios")({ component: UserAdministration });
export function UserAdministration() {
  const [users, setUsers] = useState<User[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    profession: "",
    title: "",
    professionalCouncil: "",
    councilNumber: "",
    councilRegion: "",
    role: "VIEWER",
    unitIds: [] as string[],
  });
  const [editing, setEditing] = useState<User | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function load() {
    const [sessionResponse, usersResponse] = await Promise.all([
      fetch("/api/inventory-session"),
      fetch("/api/v1/inventory/users"),
    ]);
    if (!sessionResponse.ok || !usersResponse.ok) {
      setError("Você não tem acesso à administração de usuários.");
      return;
    }
    setUnits(((await sessionResponse.json()) as { data: { units: Unit[] } }).data.units);
    setUsers(((await usersResponse.json()) as { data: User[] }).data);
  }
  useEffect(() => {
    void load();
  }, []);
  function resetForm() {
    setEditing(null);
    setForm({
      name: "",
      email: "",
      profession: "",
      title: "",
      professionalCouncil: "",
      councilNumber: "",
      councilRegion: "",
      role: "VIEWER",
      unitIds: [],
    });
  }
  function startEdit(user: User) {
    setEditing(user);
    setForm({
      name: user.name,
      email: user.email,
      profession: user.profession ?? "",
      title: user.title ?? "",
      professionalCouncil: user.professionalCouncil ?? "",
      councilNumber: user.councilNumber ?? "",
      councilRegion: user.councilRegion ?? "",
      role: user.role,
      unitIds: user.units.map((unit) => unit.id),
    });
    setError("");
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/inventory/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: editing ? "UPDATE" : "CREATE",
          ...(editing ? { userId: editing.id } : {}),
          name: form.name,
          email: form.email,
          profession: form.profession || undefined,
          title: form.title || undefined,
          professionalCouncil: form.professionalCouncil || undefined,
          councilNumber: form.councilNumber || undefined,
          councilRegion: form.councilRegion || undefined,
          role: form.role,
          unitIds: form.unitIds,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        data?: { activationPath?: string };
      };
      if (!response.ok || !body.data)
        throw new Error(body.error ?? "Não foi possível salvar o usuário.");
      if (editing) setMessage("Dados do usuário atualizados e auditados.");
      else if (body.data.activationPath) {
        const link = `${window.location.origin}${body.data.activationPath}`;
        await navigator.clipboard.writeText(link);
        setMessage("Usuário criado. O link de ativação de uso único foi copiado.");
      }
      resetForm();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }
  async function resetPassword(user: User) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/inventory/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REINVITE", userId: user.id }),
      });
      const body = (await response.json()) as {
        error?: string;
        data?: { activationPath?: string };
      };
      if (!response.ok || !body.data?.activationPath)
        throw new Error(body.error ?? "Não foi possível gerar o link de redefinição.");
      const link = `${window.location.origin}${body.data.activationPath}`;
      await navigator.clipboard.writeText(link);
      setMessage(
        `Link de redefinição para ${user.name} copiado. Ele é de uso único e expira em 72 horas.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Usuários do estoque</h1>
        <p className="text-muted-foreground">
          Crie contas individuais e envie o link de ativação diretamente à pessoa.
        </p>
      </header>
      <form onSubmit={submit} className="grid gap-3 rounded-xl border bg-card p-5 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">
          {editing ? `Editar ${editing.name}` : "Adicionar usuário"}
        </h2>
        <Input
          aria-label="Nome"
          placeholder="Nome"
          required
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <Input
          aria-label="E-mail"
          type="email"
          placeholder="E-mail"
          required
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
        />
        <Input
          aria-label="Profissão"
          placeholder="Profissão"
          value={form.profession}
          onChange={(event) => setForm({ ...form, profession: event.target.value })}
        />
        <Input
          aria-label="Função"
          placeholder="Função"
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
        <select
          aria-label="Conselho profissional"
          className="h-10 rounded-md border bg-background px-3"
          value={form.professionalCouncil}
          required={Boolean(form.profession)}
          onChange={(event) => setForm({ ...form, professionalCouncil: event.target.value })}
        >
          <option value="">Sem conselho profissional</option>
          {["CRM", "COREN", "CREFITO", "CRN", "CRF", "CRO", "CRP", "OUTRO"].map((council) => (
            <option key={council} value={council}>
              {council}
            </option>
          ))}
        </select>
        <Input
          aria-label="Número do conselho"
          placeholder="Número do conselho"
          required={Boolean(form.profession)}
          value={form.councilNumber}
          onChange={(event) => setForm({ ...form, councilNumber: event.target.value })}
        />
        <Input
          aria-label="UF do conselho"
          placeholder="UF do conselho, ex.: CE"
          maxLength={2}
          minLength={2}
          required={Boolean(form.profession)}
          value={form.councilRegion}
          onChange={(event) =>
            setForm({ ...form, councilRegion: event.target.value.toUpperCase() })
          }
        />
        <select
          aria-label="Perfil de acesso"
          className="h-10 rounded-md border bg-background px-3"
          value={form.role}
          onChange={(event) => setForm({ ...form, role: event.target.value })}
        >
          {[
            ...(editing?.role === "SUPER_ADMIN" ? ["SUPER_ADMIN"] : []),
            "PARTNER_ADMIN",
            "INVENTORY_MANAGER",
            "UNIT_MANAGER",
            "FINANCE",
            "VIEWER",
          ].map((role) => (
            <option key={role}>{role}</option>
          ))}
        </select>
        <fieldset className="rounded-md border bg-background px-3 py-2">
          <legend className="px-1 text-sm font-medium">Unidades permitidas</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {units.map((unit) => (
              <label key={unit.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="unitIds"
                  value={unit.id}
                  checked={form.unitIds.includes(unit.id)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      unitIds: event.target.checked
                        ? [...form.unitIds, unit.id]
                        : form.unitIds.filter((unitId) => unitId !== unit.id),
                    })
                  }
                  className="size-4 accent-primary"
                />
                {unit.name}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Marque uma ou mais unidades. Deixe vazio apenas para acesso sem operação local.
          </p>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending}>
            {pending ? "Salvando…" : editing ? "Salvar alterações" : "Criar e copiar convite"}
          </Button>
          {editing ? (
            <Button type="button" variant="outline" disabled={pending} onClick={resetForm}>
              Cancelar edição
            </Button>
          ) : null}
        </div>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="p-3">Pessoa</th>
              <th className="p-3">Perfil</th>
              <th className="p-3">Registro profissional</th>
              <th className="p-3">Unidades</th>
              <th className="p-3">Status</th>
              <th className="p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t">
                <td className="p-3">
                  <strong>{user.name}</strong>
                  <br />
                  <span className="text-muted-foreground">{user.email}</span>
                </td>
                <td className="p-3">{user.role}</td>
                <td className="p-3">
                  {user.professionalCouncil && user.councilNumber && user.councilRegion
                    ? `${user.professionalCouncil} ${user.councilNumber}/${user.councilRegion}`
                    : "—"}
                </td>
                <td className="p-3">{user.units.map((unit) => unit.name).join(", ") || "—"}</td>
                <td className="p-3">{user.active ? "Ativo" : "Inativo"}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => startEdit(user)}
                    >
                      <Pencil className="mr-1.5 size-3.5" /> Editar
                    </Button>
                    {user.active ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => resetPassword(user)}
                      >
                        <KeyRound className="mr-1.5 size-3.5" /> Redefinir senha
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
