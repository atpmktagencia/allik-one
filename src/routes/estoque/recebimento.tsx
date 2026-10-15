import { createFileRoute } from "@tanstack/react-router";
import { ReceivingPage } from "@/components/clinic/stock-ui";
export const Route = createFileRoute("/estoque/recebimento")({
  head: () => ({ meta: [{ title: "Receber compra — Estoque — Estoque Allik Fortaleza" }] }),
  component: ReceivingPage,
});
