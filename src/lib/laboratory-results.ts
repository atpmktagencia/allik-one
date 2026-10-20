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
    issuedOn: laboratoryDate.nullable().optional(),
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

export const laboratoryFailureMessages: Record<string, string> = {
  PROVIDER_AUTHENTICATION:
    "A credencial do serviço de IA está ausente ou foi recusada. Solicite a configuração ao administrador.",
  PROVIDER_CREDITS:
    "O serviço de IA está sem saldo disponível ou atingiu seu orçamento. O administrador precisa verificar a cobrança.",
  PROVIDER_VERIFICATION:
    "O provedor exige a verificação da conta ou da forma de pagamento pelo administrador.",
  PROVIDER_FORBIDDEN: "A conta não tem autorização para esta operação no serviço de IA.",
  PROVIDER_CONFIGURATION:
    "A configuração do provedor e do modelo de IA precisa ser corrigida pelo administrador.",
  PROVIDER_RATE_LIMIT:
    "O serviço de IA atingiu um limite temporário de solicitações. Aguarde antes de tentar novamente.",
  PROVIDER_MODEL_UNAVAILABLE: "O modelo configurado não está disponível para esta conta.",
  PROVIDER_REQUEST_REJECTED:
    "O serviço de IA recusou o formato da solicitação. A integração precisa ser revisada.",
  PROVIDER_INVALID_OUTPUT:
    "A IA não devolveu resultados no formato seguro esperado. Nenhum resultado foi confirmado.",
  PROVIDER_UNAVAILABLE: "O serviço de IA está temporariamente indisponível.",
  SOURCE_UNAVAILABLE: "Não foi possível ler o arquivo original privado para extração.",
  SOURCE_INTEGRITY: "A verificação de integridade do PDF falhou. A extração foi interrompida.",
  NO_RESULTS: "Não foram encontrados resultados laboratoriais neste documento.",
  EXTRACTION_TIMEOUT: "A extração excedeu o tempo limite e foi interrompida.",
};
