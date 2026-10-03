import { createFileRoute } from "@tanstack/react-router";
import { InventoryPage } from "@/components/clinic/feature-pages";
export const Route = createFileRoute("/estoque")({ head: () => ({ meta: [{ title: "Estoque — Clinic OS" }, { name: "description", content: "Controle de insumos e suprimentos clínicos." }, { property: "og:title", content: "Estoque — Clinic OS" }, { property: "og:description", content: "Controle de insumos e suprimentos clínicos." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }), component: InventoryPage });
