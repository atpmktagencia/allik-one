import { createFileRoute } from "@tanstack/react-router";
import { MovementsPage } from "@/components/clinic/stock-ui";
export const Route = createFileRoute("/estoque/movimentacoes")({
  head: () => ({ meta: [{ title: "Movimentações — Estoque — Estoque Allik Fortaleza" }] }),
  component: MovementsPage,
});
