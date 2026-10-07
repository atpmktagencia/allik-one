import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/components/clinic/management-pages";
export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Estoque Allik Fortaleza" },
      { name: "description", content: "Preferências operacionais da clínica." },
      { property: "og:title", content: "Configurações — Estoque Allik Fortaleza" },
      { property: "og:description", content: "Preferências operacionais da clínica." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});
