import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Account = {
  user: { name: string; email: string | null };
  role: string;
  preview?: boolean;
  integration?: { id: string } | null;
  units: Array<{ id: string; name: string }>;
};
export const Route = createFileRoute("/estoque/minha-conta")({ component: MyAccount });
export function MyAccount() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    void fetch("/api/inventory-session")
      .then(async (response) => {
        if (!response.ok) throw new Error("SESSION_UNAVAILABLE");
        setAccount(((await response.json()) as { data: Account }).data);
      })
      .catch(() => setError("Não foi possível carregar sua conta. Entre novamente."));
  }, []);
  if (!account)
    return error ? (
      <section role="alert">
        <p>{error}</p>
        <a href="/estoque/acesso">Fazer login</a>
      </section>
    ) : (
      <p>Carregando sua conta…</p>
    );
  return (
    <section className="mx-auto max-w-xl space-y-5 rounded-xl border bg-card p-6">
      <div>
        <h1 className="text-2xl font-semibold">Minha conta</h1>
        <p className="text-muted-foreground">Identidade usada na auditoria do estoque.</p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Nome</dt>
          <dd className="font-medium">{account.user.name}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">E-mail</dt>
          <dd className="font-medium">{account.user.email}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Função</dt>
          <dd className="font-medium">{account.role}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Unidades permitidas</dt>
          <dd className="font-medium">
            {account.units.map((unit) => unit.name).join(", ") || "Todas as unidades"}
          </dd>
        </div>
      </dl>
      {!account.preview && !account.integration && account.user.email ? (
        <form
          className="space-y-3 border-t pt-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending) return;
            setError("");
            if (newPassword !== confirmation) {
              setError("As senhas não coincidem.");
              return;
            }
            setPending(true);
            try {
              const response = await fetch("/api/v1/inventory/password-security", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "CHANGE_PASSWORD", currentPassword, newPassword }),
              });
              const body = (await response.json()) as { error?: string };
              if (!response.ok) throw new Error(body.error ?? "Não foi possível alterar a senha.");
              setCurrentPassword("");
              setNewPassword("");
              setConfirmation("");
              window.location.assign("/estoque/acesso");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Falha de conexão.");
            } finally {
              setPending(false);
            }
          }}
        >
          <h2 className="font-semibold">Alterar minha senha</h2>
          <p className="text-sm text-muted-foreground">
            Após a alteração, entre novamente. Todas as sessões serão encerradas.
          </p>
          <label className="block text-sm">
            Senha atual
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              disabled={pending}
            />
          </label>
          <label className="block text-sm">
            Nova senha
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={12}
              disabled={pending}
            />
          </label>
          <label className="block text-sm">
            Confirmar nova senha
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              minLength={12}
              disabled={pending}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Alterando…" : "Alterar senha"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          Entre com sua conta individual para alterar a senha.
        </p>
      )}
      <Button
        variant="outline"
        onClick={async () => {
          await fetch("/api/inventory-session", { method: "DELETE" });
          window.location.assign("/estoque/acesso");
        }}
      >
        Sair
      </Button>
    </section>
  );
}
