import { createFileRoute } from "@tanstack/react-router";
import { StockOverviewPage } from "@/components/clinic/stock-ui";
export const Route = createFileRoute("/estoque/")({ head: () => ({ meta: [{ title: "Estoque — Clinic OS" }] }), component: StockOverviewPage });
