import { createFileRoute } from "@tanstack/react-router";
import { NewApplicationPage } from "@/components/clinic/stock-ui";
export const Route = createFileRoute("/aplicacoes/nova")({ head: () => ({ meta: [{ title: "Nova aplicação — Clinic OS" }] }), component: NewApplicationPage });
