import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Permission =
  | "inventory.read"
  | "inventory.catalog.manage"
  | "inventory.supplier.manage"
  | "inventory.purchase.manage"
  | "inventory.receive"
  | "inventory.adjust"
  | "inventory.trace"
  | "inventory.audit.read";

type Credential = {
  id: string;
  name: string;
  permissions: Permission[];
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
  created_by: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
};

const permissionLabels: Record<Permission, string> = {
  "inventory.read": "Consultar estoque",
  "inventory.catalog.manage": "Produtos e locais",
  "inventory.supplier.manage": "Fornecedores e catálogos",
  "inventory.purchase.manage": "Pedidos de compra",
  "inventory.receive": "Recebimentos",
  "inventory.adjust": "Ajustes de estoque",
  "inventory.trace": "Rastreabilidade",
  "inventory.audit.read": "Consultar auditoria",
};
const defaultPermissions = Object.keys(permissionLabels) as Permission[];

function dateTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
        new Date(value),
      )
    : "Nunca";
}

export const Route = createFileRoute("/estoque/integracoes")({ component: Integrations });

export function Integrations() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [name, setName] = useState("Codex");
  const [expiresInDays, setExpiresInDays] = useState<30 | 90>(90);
  const [permissions, setPermissions] = useState<Permission[]>(defaultPermissions);
  const [revealedToken, setRevealedToken] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/v1/inventory/integration-credentials");
    const body = (await response.json()) as { data?: Credential[]; error?: string };
    if (!response.ok || !body.data) throw new Error(body.error ?? "Não foi possível carregar.");
    setCredentials(body.data);
  }

  useEffect(() => {
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Falha de conexão."),
    );
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    setRevealedToken("");
    try {
      const response = await fetch("/api/v1/inventory/integration-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CREATE", name, expiresInDays, permissions }),
      });
      const body = (await response.json()) as {
        data?: Credential & { token: string };
        error?: string;
      };
      if (!response.ok || !body.data) throw new Error(body.error ?? "Não foi possível criar.");
      setRevealedToken(body.data.token);
      setMessage("Integração criada. Copie a credencial agora: ela não será exibida novamente.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }

  async function revoke(credential: Credential) {
    if (
      !window.confirm(
        `Revogar a integração “${credential.name}”? O acesso será interrompido imediatamente.`,
      )
    )
      return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/v1/inventory/integration-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVOKE", credentialId: credential.id }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Não foi possível revogar.");
      setMessage("Integração revogada.");
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
        <h1 className="text-2xl font-semibold">Integrações administrativas</h1>
        <p className="text-muted-foreground">
          Crie acessos revogáveis para manutenção de catálogo e estoque, sem compartilhar sua senha.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm font-medium">
            Nome da integração
            <Input
              required
              minLength={3}
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Validade
            <select
              className="block h-10 w-full rounded-md border bg-background px-3"
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(Number(event.target.value) as 30 | 90)}
            >
              <option value={30}>30 dias</option>
              <option value={90}>90 dias</option>
            </select>
          </label>
        </div>
        <fieldset className="rounded-md border bg-background p-4">
          <legend className="px-1 text-sm font-medium">Permissões concedidas</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {defaultPermissions.map((permission) => (
              <label key={permission} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={permissions.includes(permission)}
                  onChange={(event) =>
                    setPermissions(
                      event.target.checked
                        ? [...permissions, permission]
                        : permissions.filter((current) => current !== permission),
                    )
                  }
                />
                {permissionLabels[permission]}
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Gestão de usuários, transferências, consumos e baixas não podem ser concedidos aqui.
          </p>
        </fieldset>
        <Button disabled={pending || permissions.length === 0}>
          {pending ? "Criando…" : "Criar integração"}
        </Button>
      </form>

      {revealedToken && (
        <section className="space-y-3 rounded-xl border border-amber-400 bg-amber-50 p-5 text-amber-950">
          <h2 className="font-semibold">Credencial exibida uma única vez</h2>
          <p className="text-sm">
            Guarde-a em um gerenciador de segredos. Não envie por mensagem comum.
          </p>
          <code className="block overflow-x-auto rounded bg-white p-3 text-xs">
            {revealedToken}
          </code>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(revealedToken);
              setMessage("Credencial copiada.");
            }}
          >
            Copiar credencial
          </Button>
        </section>
      )}

      {message && (
        <p role="status" className="text-sm text-emerald-700">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="p-3">Integração</th>
              <th className="p-3">Validade</th>
              <th className="p-3">Último uso</th>
              <th className="p-3">Status</th>
              <th className="p-3">Ação</th>
            </tr>
          </thead>
          <tbody>
            {credentials.map((credential) => (
              <tr key={credential.id} className="border-t">
                <td className="p-3">
                  <strong>{credential.name}</strong>
                  <p className="text-xs text-muted-foreground">
                    Criada por {credential.created_by}
                  </p>
                </td>
                <td className="p-3">{dateTime(credential.expires_at)}</td>
                <td className="p-3">{dateTime(credential.last_used_at)}</td>
                <td className="p-3">
                  {credential.status === "ACTIVE"
                    ? "Ativa"
                    : credential.status === "EXPIRED"
                      ? "Expirada"
                      : "Revogada"}
                </td>
                <td className="p-3">
                  {credential.status === "ACTIVE" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => void revoke(credential)}
                    >
                      Revogar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {credentials.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  Nenhuma integração criada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
