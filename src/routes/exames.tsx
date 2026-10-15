import { createFileRoute } from "@tanstack/react-router";
import { ExamsPage } from "@/components/clinic/management-pages";
export const Route = createFileRoute("/exames")({
  head: () => ({
    meta: [
      { title: "Exames — Estoque Allik Fortaleza" },
      { name: "description", content: "Solicitações e resultados na linha do tempo do paciente." },
      { property: "og:title", content: "Exames — Estoque Allik Fortaleza" },
      {
        property: "og:description",
        content: "Solicitações e resultados na linha do tempo do paciente.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExamsPage,
});
