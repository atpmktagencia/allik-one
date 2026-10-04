import { createFileRoute } from "@tanstack/react-router";
import { ApplicationsPage } from "@/components/clinic/stock-ui";
export const Route = createFileRoute("/aplicacoes")({ head: () => ({ meta: [{ title: "Aplicações — Clinic OS" }] }), component: ApplicationsPage });
