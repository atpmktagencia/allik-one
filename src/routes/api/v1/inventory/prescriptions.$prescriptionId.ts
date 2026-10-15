import { createFileRoute } from "@tanstack/react-router";
import { prescriptionDownloadResponse } from "@/server/patient-treatments";

export const Route = createFileRoute("/api/v1/inventory/prescriptions/$prescriptionId")({
  server: {
    handlers: {
      GET: ({ request, params }) => prescriptionDownloadResponse(request, params.prescriptionId),
    },
  },
});
