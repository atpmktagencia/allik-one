import { createFileRoute } from "@tanstack/react-router";
import { OperationalSchedulePage } from "@/components/clinic/operational-schedule-page";

export const Route = createFileRoute("/agenda-aplicacoes")({
  head: () => ({
    meta: [
      { title: "Agenda de aplicações — Allik One" },
      { name: "description", content: "Aplicações previstas por paciente e unidade." },
    ],
  }),
  component: OperationalSchedulePage,
});
