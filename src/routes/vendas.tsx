import { createFileRoute } from "@tanstack/react-router";
import { SalesPage } from "@/components/clinic/feature-pages";
export const Route = createFileRoute("/vendas")({
  head: () => ({
    meta: [
      { title: "Vendas — Estoque Allik Fortaleza" },
      { name: "description", content: "Gestão comercial integrada à jornada do paciente." },
      { property: "og:title", content: "Vendas — Estoque Allik Fortaleza" },
      { property: "og:description", content: "Gestão comercial integrada à jornada do paciente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SalesPage,
});
