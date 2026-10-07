import { createFileRoute } from "@tanstack/react-router";
import { SupplierPage } from "@/components/clinic/supplier-page";
export const Route = createFileRoute("/estoque/fornecedores")({ component: SupplierPage });
