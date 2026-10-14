import { createFileRoute } from "@tanstack/react-router";
import { inventoryResponse } from "@/server/inventory";
import { receivingResponse } from "@/server/receiving";
import { purchasingResponse } from "@/server/purchases";
import { stockOperationResponse } from "@/server/stock-operations";
import { applicationResponse } from "@/server/applications";
import { lotTraceResponse } from "@/server/lot-trace";
import { supplierCatalogResponse } from "@/server/supplier-catalog";
import { catalogResponse } from "@/server/catalog";
import { salePricesResponse } from "@/server/sale-prices";
import { userAdminResponse } from "@/server/user-admin";
import { writeOffResponse } from "@/server/write-offs";
import { integrationCredentialResponse } from "@/server/integration-credentials";
import { pricingResponse } from "@/server/pricing";
import { patientsResponse } from "@/server/patients";
import { patientTimelineResponse } from "@/server/patient-timeline";
import { patientDetailResponse } from "@/server/patient-treatments";
import { patientDemandResponse } from "@/server/patient-demand";
import { patientApplicationResponse } from "@/server/patient-applications";
import { openPresentationResponse } from "@/server/open-presentations";
import { patientScheduleResponse } from "@/server/patient-schedule";
import { patientPurchaseNeedsResponse } from "@/server/patient-purchase-needs";
import { careAppointmentsResponse } from "@/server/care-appointments";
import { careSettingsResponse } from "@/server/care-settings";
import { careEncounterResponse } from "@/server/care-encounter";
import { clinicalProblemsResponse } from "@/server/clinical-problems";
import { clinicalAlertsResponse } from "@/server/clinical-alerts";
import { encounterPrescriptionsResponse } from "@/server/encounter-prescriptions";
import { encounterQuotesResponse } from "@/server/encounter-quotes";
import { encounterDocumentsResponse } from "@/server/encounter-documents";
import { documentSignaturesResponse } from "@/server/document-signatures";

function catalogResource(request: Request) {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (path === "/api/v1/inventory/catalog/products") return "products";
  if (path === "/api/v1/inventory/catalog/locations") return "locations";
  if (path === "/api/v1/inventory/catalog/history") return "history";
  return undefined;
}

function resource(request: Request) {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  return path === "/api/v1/inventory/suppliers"
    ? "suppliers"
    : path === "/api/v1/inventory/purchases"
      ? "purchases"
      : undefined;
}
export const Route = createFileRoute("/api/v1/inventory/$")({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/document-signatures"
        )
          return documentSignaturesResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/patient-timeline"
        )
          return patientTimelineResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/encounter-documents"
        )
          return encounterDocumentsResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/encounter-quotes"
        )
          return encounterQuotesResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/encounter-prescriptions"
        )
          return encounterPrescriptionsResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/care-encounter")
          return careEncounterResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/care-settings")
          return careSettingsResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/care-appointments"
        )
          return careAppointmentsResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/patient-purchase-needs"
        )
          return patientPurchaseNeedsResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/patient-schedule"
        )
          return patientScheduleResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/open-presentations"
        )
          return openPresentationResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/patient-demand")
          return patientDemandResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/patient-detail")
          return patientDetailResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/patients")
          return patientsResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/pricing")
          return pricingResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/integration-credentials"
        )
          return integrationCredentialResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/users")
          return userAdminResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/sale-prices")
          return salePricesResponse(request);
        if (
          /\/inventory\/vendor(?:s|-catalog|-history|-orders)\/?$/.test(
            new URL(request.url).pathname,
          )
        )
          return supplierCatalogResponse(request);
        const catalog = catalogResource(request);
        if (catalog) return catalogResponse(request, catalog);
        if (new URL(request.url).pathname.startsWith("/api/v1/inventory/trace/"))
          return lotTraceResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/applications")
          return applicationResponse(request);
        const name = resource(request);
        return name === "suppliers" || name === "purchases"
          ? purchasingResponse(request, name)
          : inventoryResponse(request);
      },
      POST: ({ request }) => {
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/document-signatures"
        )
          return documentSignaturesResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/encounter-documents"
        )
          return encounterDocumentsResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/encounter-quotes"
        )
          return encounterQuotesResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/encounter-prescriptions"
        )
          return encounterPrescriptionsResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/clinical-alerts"
        )
          return clinicalAlertsResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/clinical-problems"
        )
          return clinicalProblemsResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/care-encounter")
          return careEncounterResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/care-settings")
          return careSettingsResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/care-appointments"
        )
          return careAppointmentsResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/patient-schedule"
        )
          return patientScheduleResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/open-presentations"
        )
          return openPresentationResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/patient-applications"
        )
          return patientApplicationResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/patient-detail")
          return patientDetailResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/patients")
          return patientsResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/pricing")
          return pricingResponse(request);
        if (
          new URL(request.url).pathname.replace(/\/$/, "") ===
          "/api/v1/inventory/integration-credentials"
        )
          return integrationCredentialResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/write-offs")
          return writeOffResponse(request);
        if (new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/users")
          return userAdminResponse(request);
        if (
          /\/inventory\/vendor(?:s|-catalog|-history|-orders)\/?$/.test(
            new URL(request.url).pathname,
          )
        )
          return supplierCatalogResponse(request);
        const catalog = catalogResource(request);
        if (catalog) return catalogResponse(request, catalog);
        const name = resource(request);
        if (name === "suppliers" || name === "purchases") return purchasingResponse(request, name);
        const path = new URL(request.url).pathname.replace(/\/$/, "");
        if (path === "/api/v1/inventory/applications") return applicationResponse(request);
        if (path === "/api/v1/inventory/transfers")
          return stockOperationResponse(request, "TRANSFER");
        if (path === "/api/v1/inventory/adjustments")
          return stockOperationResponse(request, "ADJUSTMENT");
        return new URL(request.url).pathname.replace(/\/$/, "") === "/api/v1/inventory/receipts"
          ? receivingResponse(request)
          : Response.json({ error: "Recurso não encontrado." }, { status: 404 });
      },
    },
  },
});
