import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Account = {
  user: { name: string; email: string | null };
  role: string;
  units: Array<{ id: string; name: string }>;
};
export const Route = createFileRoute("/estoque/minha-conta")({ component: MyAccount });
function MyAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    void fetch("/api/inventory-session").then(
      async (response) =>
        response.ok && setAccount(((await response.json()) as { data: Account }).data),
    );
  }, []);
  if (!account) return <p>Carregando sua conta…</p>;
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
