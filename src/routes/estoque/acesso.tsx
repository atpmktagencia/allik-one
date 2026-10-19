import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supportWhatsAppUrl } from "@/config/support";
import { Input } from "@/components/ui/input";
import { readInventoryResponse } from "@/data/inventory-api";
export const Route = createFileRoute("/estoque/acesso")({ component: InventoryAccess });
export function InventoryAccess() {
  const [ready, setReady] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryToken, setRecoveryToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    setReady(true);
    const readRecoveryLink = () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const token = fragment.get("recover");
      if (token) {
        setRecoveryToken(token);
        setRecovering(true);
        setMessage("");
        setError("");
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    };
    readRecoveryLink();
    window.addEventListener("hashchange", readRecoveryLink);
    void fetch("/api/v1/inventory/password-security")
      .then(async (response) => (response.ok ? response.json() : null))
      .then((body: { data?: { recoveryAvailable?: boolean } } | null) =>
        setRecoveryAvailable(body?.data?.recoveryAvailable === true),
      )
      .catch(() => setRecoveryAvailable(false));
    return () => window.removeEventListener("hashchange", readRecoveryLink);
  }, []);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-7 shadow-soft">
      <h1 className="font-display text-2xl font-semibold">Estoque Allik</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Entre com sua conta individual para acessar somente as unidades autorizadas.
      </p>
      {recovering ? (
        <form
          className="mt-6 space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending) return;
            setError("");
            setMessage("");
            if (recoveryToken && newPassword !== confirmation) {
              setError("As senhas não coincidem.");
              return;
            }
            setPending(true);
            try {
              const response = await fetch("/api/v1/inventory/password-security", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                  recoveryToken
                    ? { action: "RESET_PASSWORD", token: recoveryToken, newPassword }
                    : { action: "REQUEST_RESET", email },
                ),
              });
              if (!response.ok)
                throw new Error("Não foi possível concluir a solicitação. Tente novamente.");
              if (recoveryToken) {
                setRecoveryToken("");
                setNewPassword("");
                setConfirmation("");
                setPassword("");
                setRecovering(false);
                setMessage("Senha redefinida. Entre com sua nova senha.");
              } else {
                setMessage(
                  "Se houver uma conta elegível, você receberá as instruções no e-mail cadastrado.",
                );
              }
            } catch {
              setError("Não foi possível concluir a solicitação. Tente novamente.");
            } finally {
              setPending(false);
            }
          }}
        >
          <h2 className="font-semibold">
            {recoveryToken ? "Definir nova senha" : "Recuperar acesso"}
          </h2>
          {recoveryToken ? (
            <>
              <label className="block text-sm">
                Nova senha
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                  value={newPassword}
                  disabled={pending}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label className="block text-sm">
                Confirmar nova senha
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                  value={confirmation}
                  disabled={pending}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            </>
          ) : (
            <label className="block text-sm">
              E-mail cadastrado
              <Input
                type="email"
                autoComplete="username"
                required
                value={email}
                disabled={pending}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          <Button
            className="w-full"
            type="submit"
            disabled={pending || (!recoveryToken && !recoveryAvailable)}
          >
            {pending ? "Aguarde…" : recoveryToken ? "Definir senha" : "Enviar instruções"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setRecovering(false);
              setRecoveryToken("");
              setNewPassword("");
              setConfirmation("");
              setError("");
              setMessage("");
            }}
          >
            Voltar ao login
          </Button>
        </form>
      ) : (
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
                body: JSON.stringify({ email, password }),
              });
              await readInventoryResponse(response, "Não foi possível entrar.");
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
          <label htmlFor="inventory-email" className="text-sm font-medium">
            E-mail
          </label>
          <Input
            id="inventory-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!ready}
          />
          <label htmlFor="inventory-password" className="text-sm font-medium">
            Senha
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
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          {recoveryAvailable ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={pending || !ready}
              onClick={() => {
                setRecovering(true);
                setError("");
                setMessage("");
              }}
            >
              Esqueci minha senha
            </Button>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              Recuperação por e-mail ainda indisponível. Entre em contato com o suporte.
            </p>
          )}
          <p className="text-center text-sm text-muted-foreground">
            Enfrentando problemas no login?{" "}
            <a
              className="font-medium text-primary underline underline-offset-4"
              href={supportWhatsAppUrl}
              target="_blank"
              rel="noreferrer"
            >
              Entre em contato por aqui
            </a>
            .
          </p>
        </form>
      )}
    </div>
  );
}
