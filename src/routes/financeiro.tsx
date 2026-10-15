import { createFileRoute } from "@tanstack/react-router";
import { FinancePage } from "@/components/clinic/feature-pages";
export const Route = createFileRoute("/financeiro")({
  head: () => ({
    meta: [
      { title: "Financeiro — Estoque Allik Fortaleza" },
      { name: "description", content: "Visão financeira consolidada da clínica." },
      { property: "og:title", content: "Financeiro — Estoque Allik Fortaleza" },
      { property: "og:description", content: "Visão financeira consolidada da clínica." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FinancePage,
});
