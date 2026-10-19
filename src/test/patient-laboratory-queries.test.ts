import { expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidatePatientLaboratoryQueries } from "@/data/patient-laboratory-queries";

it("invalidates patient files and confirmed results across mounted scopes without affecting other patients", async () => {
  const client = new QueryClient();
  const paths = [
    "/api/v1/inventory/laboratory-history?patientId=one",
    "/api/v1/inventory/laboratory-history?patientId=one&unitId=u&dateFrom=2026-01-01",
    "/api/v1/inventory/patient-documents?patientId=one&categoryGroup=EXAMS",
    "/api/v1/inventory/laboratory-history?patientId=two",
    "/api/v1/inventory/patient-documents?patientId=two",
    "/api/v1/inventory/care-encounter?patientId=one",
  ];
  for (const path of paths) client.setQueryData(["inventory", path], { rows: [] });
  client.setQueryData(["other", paths[0]], {});
  await invalidatePatientLaboratoryQueries(client, "one");
  expect(paths.map((path) => client.getQueryState(["inventory", path])?.isInvalidated)).toEqual([
    true,
    true,
    true,
    false,
    false,
    false,
  ]);
  expect(client.getQueryState(["other", paths[0]])?.isInvalidated).toBe(false);
  client.clear();
});
