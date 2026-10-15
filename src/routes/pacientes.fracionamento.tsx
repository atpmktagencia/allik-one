import { createFileRoute } from "@tanstack/react-router";
import { OpenPresentationsPage } from "@/components/clinic/open-presentations-page";

export const Route = createFileRoute("/pacientes/fracionamento")({
  head: () => ({ meta: [{ title: "Apresentações abertas — Allik One" }] }),
  component: OpenPresentationsPage,
});
