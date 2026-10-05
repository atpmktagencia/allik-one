import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Unit = { id: string; name: string };
type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  units: Unit[];
};
export const Route = createFileRoute("/estoque/usuarios")({ component: UserAdministration });
function UserAdministration() {
  const [users, setUsers] = useState<User[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    profession: "",
    title: "",
    role: "VIEWER",
    unitId: "",
  });
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
          action: "CREATE",
          name: form.name,
          email: form.email,
          profession: form.profession || undefined,
          title: form.title || undefined,
          role: form.role,
          unitIds: form.unitId ? [form.unitId] : [],
        }),
      });
      const body = (await response.json()) as { error?: string; data?: { activationPath: string } };
      if (!response.ok || !body.data)
        throw new Error(body.error ?? "Não foi possível criar o convite.");
      const link = `${window.location.origin}${body.data.activationPath}`;
      await navigator.clipboard.writeText(link);
      setMessage("Usuário criado. O link de ativação de uso único foi copiado.");
      setForm({ name: "", email: "", profession: "", title: "", role: "VIEWER", unitId: "" });
      await load();
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
          aria-label="Perfil de acesso"
          className="h-10 rounded-md border bg-background px-3"
          value={form.role}
          onChange={(event) => setForm({ ...form, role: event.target.value })}
        >
          {["PARTNER_ADMIN", "INVENTORY_MANAGER", "UNIT_MANAGER", "FINANCE", "VIEWER"].map(
            (role) => (
              <option key={role}>{role}</option>
            ),
          )}
        </select>
        <select
          aria-label="Unidade"
          className="h-10 rounded-md border bg-background px-3"
          value={form.unitId}
          onChange={(event) => setForm({ ...form, unitId: event.target.value })}
        >
          <option value="">Sem unidade operacional</option>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </select>
        <Button disabled={pending}>{pending ? "Criando…" : "Criar e copiar convite"}</Button>
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
              <th className="p-3">Unidades</th>
              <th className="p-3">Status</th>
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
                <td className="p-3">{user.units.map((unit) => unit.name).join(", ") || "—"}</td>
                <td className="p-3">{user.active ? "Ativo" : "Inativo"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
