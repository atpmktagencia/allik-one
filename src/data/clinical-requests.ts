export type ClinicalRequestStatus = "NOT_ISSUED" | "ISSUED" | "RETURNED" | "REVIEWED";
export type ClinicalRequest = {
  sourceKind: "DOCUMENT" | "PLAN";
  sourceId: string;
  title: string;
  type: string;
  recordStatus: string;
  status: ClinicalRequestStatus;
  sourceChanged: boolean;
  version: number;
  sourceVersion: number;
  updatedAt: string | null;
  allowedActions: Exclude<ClinicalRequestStatus, "NOT_ISSUED">[];
};
export type ClinicalRequestsPayload = {
  requests: ClinicalRequest[];
  canManage: boolean;
  hasMore: boolean;
  unitName: string;
};
export const clinicalRequestStatusNames: Record<ClinicalRequestStatus, string> = {
  NOT_ISSUED: "Emissão não registrada",
  ISSUED: "Emissão registrada",
  RETURNED: "Retorno recebido",
  REVIEWED: "Retorno revisado",
};
export function clinicalRequestActions(
  recordStatus: string,
  status: ClinicalRequestStatus,
  changed: boolean,
): ClinicalRequest["allowedActions"] {
  if (!["FINAL", "ACTIVE"].includes(recordStatus)) return [];
  if (changed || status === "NOT_ISSUED") return ["ISSUED"];
  return status === "ISSUED" ? ["RETURNED"] : status === "RETURNED" ? ["REVIEWED"] : [];
}
