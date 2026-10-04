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
        {pending ? "Carregando estoque…" : "Não foi possível carregar o estoque"}
      </h2>
      {error && <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>}
      {error instanceof InventoryError && error.status === 401 ? (
        <Button asChild className="mt-4">
          <Link to="/estoque/acesso">Acessar demonstração</Link>
        </Button>
      ) : (
        error && (
          <Button className="mt-4" onClick={retry}>
            Tentar novamente
          </Button>
        )
      )}
    </div>
  );
}
