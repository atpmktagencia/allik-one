import { createFileRoute } from "@tanstack/react-router";
import { PatientPurchaseNeedsPage } from "@/components/clinic/patient-purchase-needs-page";

export const Route = createFileRoute("/estoque/necessidade-compras")({
  head: () => ({
    meta: [
      { title: "Necessidade de compra — Allik One" },
      { name: "description", content: "Previsão de compras baseada na agenda e no estoque." },
    ],
  }),
  component: PatientPurchaseNeedsPage,
});
