import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { withSelectedUnit } from "./unit-context";
export type InventoryPosition = {
  id: string;
  productId: string;
  name: string;
  category: string;
  unit: string;
  minimum: number;
  active: boolean;
  lotId: string;
  lot: string;
  expiry: string;
  supplier: string;
  cost: number;
  status: string;
  quantity: number;
  locationId: string;
  location: string;
  expiringSoon: boolean;
};
export type InventoryProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  minimum: number;
  active: boolean;
  stockControlled: boolean;
};
export type InventoryMovement = {
  id: string;
  date: string;
  type: string;
  productId: string;
  lotId: string;
  product: string;
  lot: string;
  location: string;
  quantity: number;
  responsible: string;
  reference: string;
  reason: string;
  operationId?: string | null;
  applicationId?: string | null;
  origin?: string | null;
  destination?: string | null;
};
export class InventoryError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function readInventoryResponse<T>(
  response: Response,
  fallback = "Não foi possível concluir a operação.",
): Promise<{ data?: T; error?: string }> {
  const contentType = response.headers.get("content-type") ?? "";
  let body: { data?: T; error?: string } | null = null;
  if (contentType.includes("application/json")) {
    try {
      body = (await response.json()) as { data?: T; error?: string };
    } catch {
      body = null;
    }
  }
  if (!response.ok)
    throw new InventoryError(
      body?.error ??
        (response.status >= 500
          ? "O serviço está temporariamente indisponível. Tente novamente em instantes."
          : fallback),
      response.status,
    );
  if (!body)
    throw new InventoryError(
      "O servidor devolveu uma resposta inválida. Tente novamente.",
      response.status,
    );
  return body;
}
export async function fetchInventory<T>(resource: string): Promise<T> {
  const response = await fetch(withSelectedUnit(`/api/v1/inventory/${resource}`), {
    credentials: "same-origin",
  });
  const body = await readInventoryResponse<T>(response, "Não foi possível consultar os dados.");
  return body.data as T;
}
export function useInventory<T>(
  resource: string,
  options?: { enabled?: boolean; refetchInterval?: UseQueryOptions<T>["refetchInterval"] },
) {
  const patientResource =
    resource.startsWith("patient-") ||
    resource.startsWith("laboratory-history") ||
    resource.startsWith("care-tasks") ||
    resource.startsWith("preconsultation") ||
    resource.startsWith("prescription-composer") ||
    resource.startsWith("composer-plan-options") ||
    resource.startsWith("engine-catalog") ||
    resource.startsWith("plan-quotes") ||
    resource.startsWith("care-encounter") ||
    resource.startsWith("encounter-documents") ||
    resource.startsWith("encounter-prescriptions") ||
    resource.startsWith("clinical-requests");
  const requestPath = withSelectedUnit(`/api/v1/inventory/${resource}`);
  return useQuery<T>({
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? false,
    queryKey: ["inventory", requestPath],
    queryFn: async () => {
      const response = await fetch(requestPath, { credentials: "same-origin" });
      const body = await readInventoryResponse<T>(response, "Não foi possível consultar os dados.");
      return body.data as T;
    },
    placeholderData: (previous) => (patientResource ? undefined : previous),
    refetchOnMount: patientResource ? "always" : true,
    retry: false,
    staleTime: patientResource ? 0 : 15000,
  });
}
export const formatExpiry = (date: string) => date.split("-").reverse().join("/");
export function summarizeStock(positions: InventoryPosition[]) {
  const byProduct = new Map<string, InventoryPosition[]>();
  for (const p of positions) byProduct.set(p.productId, [...(byProduct.get(p.productId) ?? []), p]);
  return [...byProduct.entries()].map(([id, items]) => {
    const first = items[0]!;
    const usable = items.filter((p) => p.active && p.status === "AVAILABLE");
    const quantity = usable.reduce((sum, p) => sum + p.quantity, 0);
    const value = items.reduce((sum, p) => sum + p.quantity * p.cost, 0);
    const principal = usable.find((p) => p.quantity > 0) ?? first;
    const status =
      quantity === 0
        ? "Bloqueado"
        : quantity < first.minimum
          ? "Estoque baixo"
          : items.some((p) => p.expiringSoon && p.quantity > 0 && p.status === "AVAILABLE")
            ? "Próximo do vencimento"
            : "Normal";
    return {
      ...first,
      id,
      quantity,
      value,
      cost: quantity
        ? usable.reduce((sum, p) => sum + p.quantity * p.cost, 0) / quantity
        : first.cost,
      status,
      lot: principal.lot,
      expiry: formatExpiry(principal.expiry),
      location: [...new Set(items.map((p) => p.location))].join(" · "),
    };
  });
}
