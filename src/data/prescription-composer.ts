import { z } from "zod";

const positiveDecimal = /^(?:0|[1-9]\d{0,5})(?:[.,]\d{1,4})?$/;
const text = (max: number) => z.string().trim().min(1).max(max);
export const prescriptionFormulaSchema = z
  .object({
    ingredients: z
      .array(
        z
          .object({
            medicationName: text(160),
            dose: z
              .string()
              .trim()
              .regex(positiveDecimal)
              .refine((v) => Number(v.replace(",", ".")) > 0),
            doseUnit: text(40),
            individualCapsule: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    route: text(100),
    presentation: text(100),
    instructions: z.string().trim().max(2000).default(""),
    dispenseQuantity: z
      .string()
      .trim()
      .max(11)
      .refine(
        (v) => !v || (positiveDecimal.test(v) && Number(v.replace(",", ".")) > 0),
        "Informe uma quantidade positiva sem conversão de unidades.",
      )
      .optional(),
    dispenseUnit: z.string().trim().max(100).optional(),
    phases: z
      .array(
        z
          .object({
            doseUnits: z.number().int().min(1).max(100),
            frequencyPerDay: z.number().int().min(1).max(24),
            durationDays: z.number().int().min(1).max(365),
            maintenance: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (Boolean(f.dispenseQuantity) !== Boolean(f.dispenseUnit))
      ctx.addIssue({
        code: "custom",
        path: [f.dispenseQuantity ? "dispenseUnit" : "dispenseQuantity"],
        message: "Informe quantidade a dispensar e unidade juntas.",
      });
    if (f.phases.some((p, i) => p.maintenance && i !== f.phases.length - 1))
      ctx.addIssue({
        code: "custom",
        path: ["phases"],
        message: "Manutenção deve ser a última etapa.",
      });
  });
export type PrescriptionFormula = z.infer<typeof prescriptionFormulaSchema>;
export type PrescriptionProtocol = {
  id: string;
  title: string;
  version: number;
  formula: PrescriptionFormula;
};
export type PrescriptionComposition = {
  text: string;
  quantity: number | null;
  quantityLabel: string;
  warnings: string[];
};

/** Arithmetic in explicitly entered presentation units; never infers a dose or converts units. */
export function composePrescription(value: unknown): PrescriptionComposition {
  const f = prescriptionFormulaSchema.parse(value);
  const finite = f.phases
    .filter((p) => !p.maintenance)
    .reduce((n, p) => n + p.doseUnits * p.frequencyPerDay * p.durationDays, 0);
  const maintenance = f.phases.some((p) => p.maintenance);
  const warnings = [
    "Conferir composição, compatibilidade, posologia, apresentação e quantidade antes de salvar. Não há validação clínica automática.",
  ];
  if (f.ingredients.some((i) => i.individualCapsule))
    warnings.push(
      "Componentes em cápsula individual exigem conferência separada de quantidades; o total calculado não é a quantidade de cápsulas de cada componente.",
    );
  const quantity = maintenance ? null : finite;
  if (f.dispenseQuantity && f.dispenseUnit) {
    warnings.push(
      "Quantidade a dispensar informada pelo prescritor; não há conversão automática entre unidades nem substituição do total calculado.",
    );
    if (
      quantity !== null &&
      f.dispenseUnit === f.presentation &&
      Number(f.dispenseQuantity.replace(",", ".")) !== quantity
    )
      warnings.push(
        "A quantidade a dispensar difere do total calculado na mesma unidade informada. Confira antes de salvar.",
      );
  }
  const quantityLabel = maintenance
    ? `Total indeterminado: manutenção sem prazo. Etapas anteriores: ${finite} unidade(s) de administração.`
    : `${finite} unidade(s) de administração da apresentação informada.`;
  const text = [
    "Composição informada por unidade de administração:",
    ...f.ingredients.map(
      (i) =>
        `- ${i.medicationName}: ${i.dose} ${i.doseUnit}${i.individualCapsule ? " (cápsula individual)" : ""}`,
    ),
    `Apresentação: ${f.presentation}`,
    `Via: ${f.route}`,
    "Posologia:",
    ...f.phases.map(
      (p, i) =>
        `${i + 1}. ${p.doseUnits} unidade(s) por administração, ${p.frequencyPerDay} vez(es) ao dia, ${p.maintenance ? "em manutenção, sem prazo definido" : `por ${p.durationDays} dia(s)`}.`,
    ),
    `Quantidade: ${quantityLabel}`,
    ...(f.dispenseQuantity && f.dispenseUnit
      ? [
          `Quantidade a dispensar: ${f.dispenseQuantity} ${f.dispenseUnit} (informada pelo prescritor).`,
        ]
      : []),
    ...(f.instructions ? [`Orientações: ${f.instructions}`] : []),
  ].join("\n");
  return { text, quantity, quantityLabel, warnings };
}
