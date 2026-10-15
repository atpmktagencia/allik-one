import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SupplierPage, type PurchaseDraft } from "@/components/clinic/supplier-page";

const searchSchema = z
  .object({
    supplierId: z.string().uuid().optional(),
    catalogItemId: z.string().uuid().optional(),
    quantity: z.coerce.number().int().positive().max(9999).optional(),
    unitId: z.string().uuid().optional(),
    unitName: z.string().trim().min(1).max(100).optional(),
  })
  .catch({});

function Page() {
  const search = Route.useSearch();
  const draft =
    search.supplierId && search.catalogItemId && search.quantity && search.unitId && search.unitName
      ? (search as PurchaseDraft)
      : undefined;
  return <SupplierPage {...(draft ? { draft } : {})} />;
}

export const Route = createFileRoute("/estoque/fornecedores")({
  validateSearch: searchSchema,
  component: Page,
});
