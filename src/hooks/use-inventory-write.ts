import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { InventoryError } from "@/data/inventory-api";

// Retain the original payload after ambiguous failures, including its UUID.
export function useInventoryWrite(resource: string) {
  const queryClient = useQueryClient();
  const snapshot = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<InventoryError | null>(null);
  const [uncertain, setUncertain] = useState(false);
  async function submit(body: unknown) {
    if (inFlight.current) return false;
    snapshot.current ??= JSON.stringify(body);
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/inventory/${resource}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: snapshot.current,
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new InventoryError(result.error ?? "Não foi possível salvar.", response.status);
      setUncertain(false);
      snapshot.current = null;
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      return true;
    } catch (cause) {
      const failure =
        cause instanceof InventoryError
          ? cause
          : new InventoryError(
              "Não foi possível confirmar o resultado. Tente novamente com os mesmos dados.",
              503,
            );
      const retrySame = failure.status >= 500 || failure.status === 401 || failure.status === 403;
      setUncertain(retrySame);
      if (!retrySame) snapshot.current = null;
      setError(failure);
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return { submit, pending, error, uncertain };
}
