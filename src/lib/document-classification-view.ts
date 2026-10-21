import type { DocumentClassificationSuggestion } from "./patient-document-classification";
export type ClassificationView = {
  id: string;
  revision: number;
  action: string;
  payload: {
    categories?: string[];
    result?: DocumentClassificationSuggestion;
    evidenceStatus?: string;
    failureCode?: string;
  };
  createdAt?: string;
  attemptId?: string | null;
};
export const classificationNames: Record<string, string> = {
  LAB_RESULT: "Resultado laboratorial",
  EXAM_REQUEST: "Pedido de exames",
  IMAGE_REPORT: "Laudo de imagem",
  MEDICAL_PRESCRIPTION: "Receita anterior",
  MEDICAL_REPORT: "Relatório médico",
  MEDICAL_CERTIFICATE: "Atestado",
  OTHER: "Outros documentos",
};
export function classificationLabel(value: ClassificationView | null | undefined) {
  if (!value) return "Sem classificação";
  const labels: Record<string, string> = {
    RECEIVED: "Recebido",
    RETRY_REQUESTED: "Recebido",
    STARTED: "Classificando",
    SUGGESTED: "Categoria sugerida",
    NEEDS_REVIEW: "Revisão necessária",
    FAILED: "Falha",
    CONFIRMED: "Categoria confirmada",
    MANUAL_CLASSIFIED: "Categoria confirmada",
    CORRECTED: "Categoria confirmada",
  };
  return labels[value.action] ?? "Revisão necessária";
}
