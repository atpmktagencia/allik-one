import { createFileRoute } from "@tanstack/react-router";
import { OperationalSchedulePage } from "@/components/clinic/operational-schedule-page";
export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda operacional — Allik One" },
      { name: "description", content: "Aplicações previstas por paciente e unidade." },
    ],
  }),
  component: OperationalSchedulePage,
});
