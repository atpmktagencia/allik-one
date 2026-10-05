import { createFileRoute } from "@tanstack/react-router";
import { SalePricesPage } from "@/components/clinic/sale-prices-page";

export const Route = createFileRoute("/estoque/valores")({ component: SalePricesPage });
