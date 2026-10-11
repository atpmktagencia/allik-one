import { createFileRoute } from "@tanstack/react-router";
import { CareAppointmentsPage } from "@/components/clinic/care-appointments-page";
export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [
      { title: "Agendamentos — Allik One" },
      { name: "description", content: "Agenda de atendimentos por unidade e profissional." },
    ],
  }),
  component: CareAppointmentsPage,
});
