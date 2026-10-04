import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export const Route = createFileRoute("/estoque/acesso")({ component: InventoryAccess });
function InventoryAccess() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-7 shadow-soft">
      <h1 className="font-display text-2xl font-semibold">Estoque Allik Fortaleza</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Acesso ao Preview com dados sintéticos. As operações de recebimento e aplicação serão
        habilitadas nas próximas etapas.
      </p>
      <form
        className="mt-6 space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError("");
          try {
            const response = await fetch("/api/inventory-session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password }),
            });
            const body = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(body.error ?? "Não foi possível entrar.");
            setPassword("");
            await queryClient.invalidateQueries({ queryKey: ["inventory"] });
            await navigate({ to: "/estoque" });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Falha de conexão.");
          } finally {
            setPending(false);
          }
        }}
      >
        <label htmlFor="inventory-password" className="text-sm font-medium">
          Senha do Preview
        </label>
        <Input
          id="inventory-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={!ready}
          required
        />
        {error && (
          <p role="alert" className="text-sm text-danger-foreground">
            {error}
          </p>
        )}
        <Button className="w-full" type="submit" disabled={pending || !ready}>
          {pending ? "Entrando…" : "Acessar estoque"}
        </Button>
      </form>
    </div>
  );
}
