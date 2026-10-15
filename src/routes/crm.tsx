import { createFileRoute } from "@tanstack/react-router";
import { CrmPage } from "@/components/clinic/management-pages";
export const Route = createFileRoute("/crm")({
  head: () => ({
    meta: [
      { title: "CRM — Estoque Allik Fortaleza" },
      { name: "description", content: "Relacionamento conectado à identidade do paciente." },
      { property: "og:title", content: "CRM — Estoque Allik Fortaleza" },
      { property: "og:description", content: "Relacionamento conectado à identidade do paciente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CrmPage,
});
