import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { InventoryError } from "@/data/inventory-api";
export function InventoryState({
  pending,
  error,
  retry,
}: {
  pending?: boolean;
  error?: Error | null;
  retry?: () => void;
}) {
  return (
    <div
      className="rounded-xl border border-border bg-card p-8 text-center"
      role={error ? "alert" : "status"}
    >
      <h2 className="font-semibold">
        {pending ? "Carregando estoque…" : "Faça o login para liberar seu acesso."}
      </h2>
      {error && <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>}
      {error instanceof InventoryError && error.status === 401 ? (
        <Button asChild className="mt-4">
          <Link to="/estoque/acesso">Fazer login</Link>
        </Button>
      ) : (
        error && (
          <Button className="mt-4" onClick={retry}>
            Tentar novamente
          </Button>
        )
      )}
      {error instanceof InventoryError && error.status === 401 && (
        <p className="mt-4 text-sm text-muted-foreground">
          Enfrentando problemas no login?{" "}
          <a
            className="font-medium text-primary underline underline-offset-4"
            href="https://wa.me/5585996146664"
            target="_blank"
            rel="noreferrer"
          >
            Entre em contato por aqui
          </a>
          .
        </p>
      )}
    </div>
  );
}
