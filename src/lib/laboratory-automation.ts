import { z } from "zod";
import { documentClassificationSuggestion } from "./patient-document-classification";

/** F3 contract only. No dispatch, provider calls, SQL writes or clinical confirmation. */
export const LABORATORY_AUTOMATION_VERSION = "laboratory-automation-1";
export const laboratoryAutomationEnrollment = z
  .object({
    operationId: z.string().uuid(),
    documentId: z.string().uuid(),
    organizationId: z.string().uuid(),
    patientId: z.string().uuid(),
    unitId: z.string().uuid(),
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    receiptEventId: z.string().uuid(),
    initiatedByUserId: z.string().uuid(),
    pipelineVersion: z.literal(LABORATORY_AUTOMATION_VERSION),
  })
  .strict();
export type LaboratoryAutomationEnrollment = z.infer<typeof laboratoryAutomationEnrollment>;

const supported = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    action: z.literal("SUGGESTED"),
    payload: z
      .object({
        schemaVersion: z.literal(1),
        evidenceStatus: z.literal("SUPPORTED"),
        result: documentClassificationSuggestion,
      })
      .strict(),
  })
  .strict();
export type LaboratoryAutomationBlock =
  | "NOT_ENROLLED"
  | "ACCESS_REVOKED"
  | "UNIT_CHANGED"
  | "SOURCE_CHANGED"
  | "CLASSIFICATION_NOT_SUPPORTED"
  | "NO_LAB_RESULTS"
  | "MIXED_DOCUMENT"
  | "PAGE_SCOPE_UNPROVEN"
  | "EXISTING_IMPORT";
/** Fail-closed initial rollout: only wholly laboratory PDFs with independent page evidence.
 * Quotes alone don't prove all pages were classified: actual parser page count is required.
 * Mixed/scanned/identity-uncertain documents remain accessible via the manual flow.
 */
export function laboratoryAutomationEligibility(input: {
  enrolled: boolean;
  authorized: boolean;
  sameOriginal: boolean;
  samePrimaryUnit: boolean;
  existingImport: boolean;
  classification: unknown;
  independentTotalPages: number | null;
}):
  | { eligible: false; reason: LaboratoryAutomationBlock }
  | {
      eligible: true;
      classificationEventId: string;
      classificationRevision: number;
      pages: number[];
    } {
  const blocked = (reason: LaboratoryAutomationBlock) => ({ eligible: false as const, reason });
  if (!input.enrolled) return blocked("NOT_ENROLLED");
  if (!input.authorized) return blocked("ACCESS_REVOKED");
  if (!input.samePrimaryUnit) return blocked("UNIT_CHANGED");
  if (!input.sameOriginal) return blocked("SOURCE_CHANGED");
  if (input.existingImport) return blocked("EXISTING_IMPORT");
  const parsed = supported.safeParse(input.classification);
  if (!parsed.success || parsed.data.payload.result.abstention !== "NONE")
    return blocked("CLASSIFICATION_NOT_SUPPORTED");
  const result = parsed.data.payload.result;
  const lab = result.categories.find((c) => c.category === "LAB_RESULT");
  if (!lab) return blocked("NO_LAB_RESULTS");
  if (result.categories.length !== 1) return blocked("MIXED_DOCUMENT");
  const count = input.independentTotalPages;
  const pages = [...new Set(lab.evidence.map((e) => e.page))].sort((a, b) => a - b);
  if (
    !count ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 20 ||
    pages.length !== count ||
    pages.some((p, i) => p !== i + 1)
  )
    return blocked("PAGE_SCOPE_UNPROVEN");
  return {
    eligible: true,
    classificationEventId: parsed.data.id,
    classificationRevision: parsed.data.revision,
    pages,
  };
}

const transitions = {
  ENROLLED: ["STARTED", "CANCELLED"],
  STARTED: ["READY", "FAILED", "CANCELLED"],
  FAILED: ["RETRY_REQUESTED", "CANCELLED"],
  RETRY_REQUESTED: ["STARTED", "CANCELLED"],
  READY: ["CANCELLED"],
  CANCELLED: [],
} as const;
export type LaboratoryAutomationState = keyof typeof transitions;
/** Every completion must still match the latest classification AND the claimed attempt.
 * READY only means draft available; there is deliberately no VALIDATED state here.
 */
export function laboratoryAutomationTransition(input: {
  previous: LaboratoryAutomationState;
  next: LaboratoryAutomationState;
  actor: "SYSTEM" | "HUMAN";
  startedAttempts: number;
  sameClassification: boolean;
  sameAttempt: boolean;
}) {
  if (!Number.isInteger(input.startedAttempts) || input.startedAttempts < 0) return false;
  if (!(transitions[input.previous] as readonly string[]).includes(input.next)) return false;
  if (input.next === "RETRY_REQUESTED") return input.actor === "HUMAN" && input.startedAttempts < 2;
  if (input.next === "STARTED")
    return input.actor === "SYSTEM" && input.startedAttempts < 2 && input.sameClassification;
  if (["READY", "FAILED"].includes(input.next))
    return input.actor === "SYSTEM" && input.sameClassification && input.sameAttempt;
  return input.next === "CANCELLED";
}
