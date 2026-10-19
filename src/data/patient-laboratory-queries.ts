import type { QueryClient } from "@tanstack/react-query";

/** Refresh every mounted view of this patient's files and confirmed results. */
export function invalidatePatientLaboratoryQueries(client: QueryClient, patientId: string) {
  return client.invalidateQueries({
    predicate: ({ queryKey }) => {
      if (queryKey[0] !== "inventory" || typeof queryKey[1] !== "string") return false;
      const url = new URL(queryKey[1], "https://inventory.invalid");
      return (
        ["/api/v1/inventory/laboratory-history", "/api/v1/inventory/patient-documents"].includes(
          url.pathname,
        ) && url.searchParams.get("patientId") === patientId
      );
    },
  });
}
