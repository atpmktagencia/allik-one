import { createFileRoute } from "@tanstack/react-router";
import { LotTracePage } from "@/components/clinic/lot-trace-page";

export const Route = createFileRoute("/estoque/lotes/$lotId")({
  head: () => ({ meta: [{ title: "Rastreabilidade do lote — Estoque Allik Fortaleza" }] }),
  component: LotRoute,
});
function LotRoute() {
  const { lotId } = Route.useParams();
  return <LotTracePage lotId={lotId} />;
}
