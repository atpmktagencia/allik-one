import { z } from "zod";
import { prescriptionFormulaSchema } from "./prescription-composer";

export const treatmentPlanKinds = [
  "PRESCRIPTION",
  "PROCEDURE",
  "CONSULTATION",
  "INJECTABLE_SESSION",
  "SERVICE",
  "RETURN",
] as const;
export const treatmentPlanUnits = [
  "PACK",
  "VIAL",
  "AMPOULE",
  "SYRINGE",
  "UNIT",
  "CAPSULE",
  "TABLET",
  "ML",
  "G",
  "DROP",
  "SACHET",
  "SESSION",
  "CONSULTATION",
  "PROCEDURE",
] as const;
const decimalPattern = /^(?:0|[1-9]\d{0,7})(?:[.,]\d{1,4})?$/;
const decimal = z
  .string()
  .trim()
  .regex(decimalPattern)
  .refine((v) => decimalPattern.test(v) && scaled(v) > 0n, "Informe quantidade positiva.");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const parsed = new Date(v + "T00:00:00Z");
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.getUTCFullYear() >= 1900 &&
      parsed.toISOString().slice(0, 10) === v
    );
  }, "Data de calendário inválida.");
const unit = z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[\p{L}][\p{L}\p{N} ./%µμ_-]*$/u),
  uuid = z.string().uuid();
export const treatmentPlanStageSchema = z
  .object({
    doseUnits: decimal.nullable(),
    frequencyPerDay: z.number().int().min(1).max(24).nullable(),
    everyDays: z.number().int().min(1).max(365),
    durationDays: z.number().int().min(1).max(3650).nullable(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).nullable(),
    times: z
      .array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/))
      .min(1)
      .max(24)
      .nullable(),
  })
  .strict()
  .superRefine((s, c) => {
    if (s.weekdays && new Set(s.weekdays).size !== s.weekdays.length)
      c.addIssue({ code: "custom", path: ["weekdays"], message: "Dias da semana repetidos." });
    if (
      s.times &&
      (new Set(s.times).size !== s.times.length || s.times.length !== s.frequencyPerDay)
    )
      c.addIssue({
        code: "custom",
        path: ["times"],
        message: "Informe horários distintos correspondentes à frequência explícita.",
      });
  });
export const treatmentPlanItemSchema = z
  .object({
    id: uuid,
    kind: z.enum(treatmentPlanKinds),
    title: z.string().trim().min(1).max(200),
    productId: uuid.nullable(),
    catalogItemId: uuid.nullable(),
    administrationUnit: unit.nullable(),
    optional: z.boolean().default(false),
    patientInstructions: z.string().trim().max(4000).default(""),
    existingTreatmentId: uuid.nullable().optional(),
    appointmentId: uuid.nullable().optional(),
    prescriptionInstanceId: uuid.nullable().optional(),
    formula: prescriptionFormulaSchema.nullable().optional(),
    stages: z.array(treatmentPlanStageSchema).min(1).max(12),
    dispense: z.object({ quantity: decimal, unit }).strict().nullable(),
    package: z.object({ capacity: decimal, unit }).strict().nullable(),
  })
  .strict()
  .superRefine((i, c) => {
    if (i.stages.some((s, n) => s.durationDays === null && n !== i.stages.length - 1))
      c.addIssue({
        code: "custom",
        path: ["stages"],
        message: "A etapa sem prazo deve ser a última.",
      });
    if (i.stages.reduce((n, s) => n + (s.durationDays ?? 0), 0) > 3650)
      c.addIssue({
        code: "custom",
        path: ["stages"],
        message: "O calendário finito excede 3650 dias.",
      });
    if (i.productId && i.catalogItemId)
      c.addIssue({
        code: "custom",
        path: ["catalogItemId"],
        message: "Escolha uma única referência de catálogo.",
      });
    if (i.package && (!i.dispense || i.package.unit !== i.dispense.unit))
      c.addIssue({
        code: "custom",
        path: ["package"],
        message:
          "Capacidade exige quantidade de dispensação na mesma unidade exata. Não há conversão.",
      });
  });
export const treatmentPlanSchema = z
  .object({
    startDate: date,
    previewDays: z.number().int().min(1).max(366),
    items: z.array(treatmentPlanItemSchema).min(1).max(50),
  })
  .strict()
  .superRefine((p, c) => {
    if (new Set(p.items.map((i) => i.id)).size !== p.items.length)
      c.addIssue({
        code: "custom",
        path: ["items"],
        message: "Identificadores de itens repetidos.",
      });
  });
export type TreatmentPlanInput = z.infer<typeof treatmentPlanSchema>;
export type TreatmentPlanItem = z.infer<typeof treatmentPlanItemSchema>;
export type TreatmentPlanStage = z.infer<typeof treatmentPlanStageSchema>;
export type TreatmentPlanScheduleEntry = {
  date: string;
  stageIndex: number;
  times: string[] | null;
  administrations: number | null;
  doseUnits: string | null;
};
export type ComputedTreatmentPlan = {
  startDate: string;
  previewThrough: string;
  truncated: boolean;
  warnings: string[];
  items: {
    id: string;
    administrationQuantity: string | null;
    dispenseQuantity: string | null;
    packagesRequired: string | null;
    schedule: TreatmentPlanScheduleEntry[];
    stages: { startsOn: string; endsOn: string | null }[];
    warnings: string[];
    truncated: boolean;
  }[];
};

/** Decimal quantities are four-place fixed-point integers; never perform medication/unit conversions. */
function scaled(value: string): bigint {
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  return BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, "0"));
}
function formatted(value: bigint): string {
  const whole = value / 10000n,
    fraction = (value % 10000n).toString().padStart(4, "0").replace(/0+$/, "");
  return `${whole}${fraction ? "." + fraction : ""}`;
}
function addDate(start: string, days: number): string {
  const value = new Date(start + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  if (value.getUTCFullYear() > 9999) throw Error("Calendário excede o ano 9999.");
  return value.toISOString().slice(0, 10);
}
function eligible(start: string, offset: number, stage: TreatmentPlanStage) {
  return (
    offset % stage.everyDays === 0 &&
    (!stage.weekdays ||
      stage.weekdays.includes(new Date(addDate(start, offset) + "T00:00:00Z").getUTCDay()))
  );
}
/** Dates are civil dates in America/Fortaleza; no system timezone or current clock is consulted. */
export function computeTreatmentPlan(value: unknown): ComputedTreatmentPlan {
  const plan = treatmentPlanSchema.parse(value);
  const previewThrough = addDate(plan.startDate, plan.previewDays - 1);
  let eventCount = 0,
    truncated = false;
  const items = plan.items.map((item) => {
    let offset = 0,
      total = 0n,
      unknown = item.administrationUnit === null,
      itemTruncated = false;
    const warnings: string[] = [];
    const schedule: TreatmentPlanScheduleEntry[] = [];
    const stages: { startsOn: string; endsOn: string | null }[] = [];
    for (const [stageIndex, stage] of item.stages.entries()) {
      const startsOn = addDate(plan.startDate, offset),
        endsOn = stage.durationDays === null ? null : addDate(startsOn, stage.durationDays - 1);
      stages.push({ startsOn, endsOn });
      if (stage.durationDays === null || stage.frequencyPerDay === null || stage.doseUnits === null)
        unknown = true;
      if (
        stage.durationDays !== null &&
        stage.frequencyPerDay !== null &&
        stage.doseUnits !== null
      ) {
        let days = 0;
        for (let day = 0; day < stage.durationDays; day++)
          if (eligible(startsOn, day, stage)) days++;
        total += scaled(stage.doseUnits) * BigInt(stage.frequencyPerDay) * BigInt(days);
      }
      const visibleDays = Math.max(
        0,
        Math.min(stage.durationDays ?? plan.previewDays, plan.previewDays - offset),
      );
      for (let day = 0; day < visibleDays; day++)
        if (eligible(startsOn, day, stage)) {
          if (eventCount >= 512) {
            itemTruncated = true;
            truncated = true;
            continue;
          }
          schedule.push({
            date: addDate(startsOn, day),
            stageIndex,
            times: stage.times ? [...stage.times].sort() : null,
            administrations: stage.frequencyPerDay,
            doseUnits: stage.doseUnits === null ? null : formatted(scaled(stage.doseUnits)),
          });
          eventCount++;
        }
      offset += stage.durationDays ?? 0;
    }
    const administrationQuantity = unknown ? null : formatted(total);
    if (unknown)
      warnings.push(
        "Total de administração indeterminado: há prazo, frequência, dose ou unidade não informados, ou manutenção sem prazo.",
      );
    if (item.stages.some((s) => s.times === null))
      warnings.push("Horários não informados permanecem sem agendamento de hora.");
    let packagesRequired: string | null = null;
    if (item.package && item.dispense) {
      const need = scaled(item.dispense.quantity),
        capacity = scaled(item.package.capacity);
      packagesRequired = ((need + capacity - 1n) / capacity).toString();
      warnings.push(
        "Embalagens calculadas somente com a capacidade e a quantidade explicitamente informadas, na mesma unidade; confira a dispensação.",
      );
    }
    if (
      item.dispense &&
      administrationQuantity !== null &&
      item.dispense.unit === item.administrationUnit &&
      scaled(item.dispense.quantity) !== total
    )
      warnings.push(
        "Quantidade prescrita para dispensação difere do total de administração na mesma unidade. Conferir.",
      );
    if (item.dispense && item.dispense.unit !== item.administrationUnit)
      warnings.push(
        "Administração e dispensação têm unidades distintas ou desconhecidas; não foi feita conversão.",
      );
    if (itemTruncated)
      warnings.push(
        "Prévia de calendário limitada ao teto global de 512 registros; o total finito não foi truncado.",
      );
    return {
      id: item.id,
      administrationQuantity,
      dispenseQuantity: item.dispense ? formatted(scaled(item.dispense.quantity)) : null,
      packagesRequired,
      schedule,
      stages,
      warnings,
      truncated: itemTruncated,
    };
  });
  return {
    startDate: plan.startDate,
    previewThrough,
    items,
    truncated,
    warnings: [
      "Planejamento explícito, sem recomendação de doses ou validação de compatibilidade clínica.",
      ...(truncated ? ["Calendário da prévia truncado em 512 registros para todo o plano."] : []),
    ],
  };
}
