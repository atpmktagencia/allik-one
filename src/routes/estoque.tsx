import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
function InventoryLayout() {
  const { pathname } = useLocation();
  return (
    <div className="space-y-6">
      {pathname !== "/estoque/acesso" && (
        <nav
          aria-label="Abas do estoque"
          className="flex gap-2 overflow-x-auto border-b pb-3 text-sm"
        >
          <Link
            to="/estoque"
            className="shrink-0 rounded-md px-3 py-2 hover:bg-muted"
            activeProps={{ className: "bg-muted font-medium" }}
            activeOptions={{ exact: true }}
          >
            Visão do estoque
          </Link>
          <Link
            to="/estoque/cadastros"
            className="shrink-0 rounded-md px-3 py-2 hover:bg-muted"
            activeProps={{ className: "bg-muted font-medium" }}
          >
            Cadastros
          </Link>
          <Link
            to="/estoque/fornecedores"
            className="shrink-0 rounded-md px-3 py-2 hover:bg-muted"
            activeProps={{ className: "bg-muted font-medium" }}
          >
            Fornecedores e catálogos
          </Link>
          <Link
            to="/estoque/valores"
            className="shrink-0 rounded-md px-3 py-2 hover:bg-muted"
            activeProps={{ className: "bg-muted font-medium" }}
          >
            Valores de venda
          </Link>
          <Link
            to="/estoque/recebimento"
            className="shrink-0 rounded-md px-3 py-2 hover:bg-muted"
            activeProps={{ className: "bg-muted font-medium" }}
          >
            Recebimentos
          </Link>
          <Link
            to="/estoque/movimentacoes"
            className="shrink-0 rounded-md px-3 py-2 hover:bg-muted"
            activeProps={{ className: "bg-muted font-medium" }}
          >
            Histórico
          </Link>
        </nav>
      )}
      <Outlet />
    </div>
  );
}
export const Route = createFileRoute("/estoque")({ component: InventoryLayout });
