import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/estoque/ativar")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search["token"] === "string" ? search["token"] : "",
  }),
  component: ActivateInventoryAccount,
});

function ActivateInventoryAccount() {
  const { token } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setError("As senhas não coincidem.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/inventory-activation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Não foi possível ativar a conta.");
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }
  if (done)
    return (
      <div className="mx-auto max-w-md rounded-xl border bg-card p-7">
        <h1 className="text-2xl font-semibold">Conta ativada</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sua senha foi definida. O convite não poderá ser reutilizado.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link to="/estoque/acesso">Entrar</Link>
        </Button>
      </div>
    );
  return (
    <div className="mx-auto max-w-md rounded-xl border bg-card p-7">
      <h1 className="text-2xl font-semibold">Ativar conta do estoque</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Defina uma senha exclusiva com pelo menos 12 caracteres.
      </p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Nova senha</span>
          <Input
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={200}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Confirmar senha</span>
          <Input
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={200}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button className="w-full" disabled={pending || !token}>
          {pending ? "Ativando…" : "Definir senha"}
        </Button>
        {!token && (
          <p role="alert" className="text-sm text-destructive">
            O link de convite está incompleto.
          </p>
        )}
      </form>
    </div>
  );
}
