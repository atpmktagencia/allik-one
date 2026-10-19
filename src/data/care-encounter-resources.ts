/** Kept bounded by the patient document API's supported page size. */
export const encounterReviewDocumentLimit = 50;
export function encounterReviewLaboratoryResource(patientId: string, unitId: string) {
  const params = new URLSearchParams({
    patientId,
    unitId,
    categoryGroup: "EXAMS",
    limit: String(encounterReviewDocumentLimit),
  });
  return `patient-documents?${params}`;
}
