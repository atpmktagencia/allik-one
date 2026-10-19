import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const nullable = (max: number) => text(max).nullable();
export const laboratoryDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !value.startsWith("0000") &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
  );
export const laboratoryRow = z
  .object({
    name: text(160),
    result: text(240),
    unit: nullable(80),
    reference: nullable(500),
    collectedOn: laboratoryDate.nullable(),
    reportedOn: laboratoryDate.nullable(),
    laboratory: nullable(200),
    method: nullable(200),
    material: nullable(200),
    sourcePage: z.number().int().min(1).max(1000).nullable(),
    evidence: nullable(600),
    uncertainty: nullable(500),
    verified: z.boolean(),
  })
  .strict();
export const laboratoryDraft = z
  .object({
    patientConfirmed: z.boolean(),
    notes: text(2000),
    rows: z.array(laboratoryRow).max(200),
  })
  .strict();
export type LaboratoryDraft = z.infer<typeof laboratoryDraft>;
export type LaboratoryRow = z.infer<typeof laboratoryRow>;
export const emptyLaboratoryDraft = (): LaboratoryDraft => ({
  patientConfirmed: false,
  notes: "",
  rows: [],
});
export const emptyLaboratoryRow = (): LaboratoryRow => ({
  name: "",
  result: "",
  unit: null,
  reference: null,
  collectedOn: null,
  reportedOn: null,
  laboratory: null,
  method: null,
  material: null,
  sourcePage: null,
  evidence: null,
  uncertainty: null,
  verified: false,
});
export function laboratoryValidationProblem(draft: LaboratoryDraft) {
  if (!draft.patientConfirmed) return "Confirme que o PDF corresponde ao paciente selecionado.";
  if (!draft.rows.length) return "Inclua pelo menos um resultado.";
  if (draft.rows.some((row) => !row.name || !row.result || !row.verified || row.uncertainty))
    return "Confira nome e resultado, resolva as pendências e confirme cada linha.";
  return null;
}
