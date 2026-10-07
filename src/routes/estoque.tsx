import { createFileRoute, Outlet } from "@tanstack/react-router";

function InventoryLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/estoque")({ component: InventoryLayout });
