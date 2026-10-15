import "@tanstack/react-start/server-only";
import { z } from "zod";
import { actor, can, type authenticate } from "./auth";
import { getPool } from "./db";
import { buildTreatmentCadence, type CadencePrescription } from "../data/treatment-cadence";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const inputSchema = z.object({
  action: z.enum(["PREVIEW_ACTIVATION", "ACTIVATE_PLAN"]),
  appointmentId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  firstScheduledOn: z.string().date(),
  reason: z.string().trim().min(10).max(500),
});
type Item = CadencePrescription & {
  id: string;
  productId: string;
  medicationName: string;
  doseQuantity: number;
  doseUnit: string;
  route: string;
};
type QuoteItem = {
  prescriptionItemId: string;
  productId: string;
  doseQuantity: number;
  doseUnit: string;
  quantity: number;
  subtotalSale: number;
};

export async function activateEncounterQuote(
  body: unknown,
  auth: NonNullable<Awaited<ReturnType<typeof authenticate>>>,
) {
  if (!auth.user.id || auth.preview || auth.integration || !can(auth, "patients.clinical.manage"))
    return Response.json(
      { error: "Use uma conta individual autorizada a gerenciar planos terapêuticos." },
      { status: 403, headers },
    );
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success)
    return Response.json(
      { error: "Confira a data e o motivo da ativação." },
      { status: 400, headers },
    );
  const input = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const appointment = (
      await client.query(
        "SELECT * FROM inventory_care_appointments WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [input.appointmentId, auth.organizationId],
      )
    ).rows[0];
    if (!appointment || !can(auth, "patients.clinical.manage", appointment.unit_id)) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Acesso negado ao atendimento." }, { status: 403, headers });
    }
    const quote = (
      await client.query(
        "SELECT * FROM inventory_encounter_quotes WHERE appointment_id=$1 AND organization_id=$2 AND unit_id=$3 FOR UPDATE",
        [appointment.id, auth.organizationId, appointment.unit_id],
      )
    ).rows[0];
    if (!quote) throw new Error("Orçamento não encontrado.");
    const patient = (
      await client.query(
        "SELECT * FROM inventory_patients WHERE id=$1 AND organization_id=$2 FOR SHARE",
        [quote.patient_id, auth.organizationId],
      )
    ).rows[0];
    if (
      !patient ||
      !patient.active ||
      patient.primary_unit_id !== quote.unit_id ||
      !can(auth, "patients.read", patient.primary_unit_id)
    )
      throw new Error("O paciente deve estar ativo e cadastrado na unidade deste orçamento.");
    const existing = (
      await client.query(
        "SELECT snapshot FROM inventory_encounter_quote_activations WHERE quote_id=$1 AND organization_id=$2",
        [quote.id, auth.organizationId],
      )
    ).rows[0];
    if (existing) {
      await client.query("COMMIT");
      return Response.json({ data: { activation: existing.snapshot } }, { headers });
    }
    if (quote.status !== "PAID") {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Registre o pagamento integral antes de ativar o plano." },
        { status: 409, headers },
      );
    }
    if (Number(quote.version) !== input.version) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "O orçamento foi alterado em outra sessão. Recarregue a página." },
        { status: 409, headers },
      );
    }
    if (["CANCELED", "NO_SHOW"].includes(appointment.status))
      throw new Error("Este atendimento não permite ativar um plano.");
    const prescription = (
      await client.query(
        "SELECT * FROM inventory_encounter_prescriptions WHERE id=$1 AND appointment_id=$2 AND organization_id=$3 FOR SHARE",
        [quote.prescription_id, appointment.id, auth.organizationId],
      )
    ).rows[0];
    if (!prescription || prescription.status !== "FINAL")
      throw new Error("A prescrição finalizada não foi encontrada.");
    const prescribed = new Map((prescription.items as Item[]).map((item) => [item.id, item]));
    const quoteItems = quote.items as QuoteItem[];
    if (
      !quoteItems.length ||
      new Set(quoteItems.map((item) => item.prescriptionItemId)).size !== quoteItems.length
    )
      throw new Error("Itens do orçamento inválidos.");
    const items = quoteItems.map((quoted) => {
      const item = prescribed.get(quoted.prescriptionItemId);
      if (
        !item ||
        !item.productId ||
        item.productId !== quoted.productId ||
        item.doseUnit !== quoted.doseUnit ||
        Number(item.doseQuantity) !== Number(quoted.doseQuantity)
      )
        throw new Error("O item do orçamento não corresponde à prescrição.");
      if (!["MG", "ML", "UI", "UNIT"].includes(item.doseUnit))
        throw new Error("A unidade desta dose ainda não é suportada pelo plano terapêutico.");
      if (!item.route || item.route.trim().length > 40)
        throw new Error("Revise a via de administração antes de ativar o plano.");
      return {
        prescriptionItemId: item.id,
        medicationName: item.medicationName,
        productId: item.productId,
        doseQuantity: Number(item.doseQuantity),
        doseUnit: item.doseUnit,
        route: item.route,
        quantity: quoted.quantity,
        dates: buildTreatmentCadence(input.firstScheduledOn, item, quoted.quantity),
        frequencyEvery: item.frequencyEvery,
        frequencyUnit: item.frequencyUnit,
        treatmentId: crypto.randomUUID(),
      };
    });
    const activation = {
      quoteId: quote.id,
      patientId: quote.patient_id,
      unitId: quote.unit_id,
      firstScheduledOn: input.firstScheduledOn,
      items,
      activated: input.action === "ACTIVATE_PLAN",
    };
    for (const item of items) {
      const product = (
        await client.query(
          "SELECT id FROM inventory_products WHERE id=$1 AND organization_id=$2 AND active FOR SHARE",
          [item.productId, auth.organizationId],
        )
      ).rows[0];
      if (!product)
        throw new Error("Produto não encontrado ou inativo no catálogo da organização.");
    }
    if (input.action === "ACTIVATE_PLAN") {
      for (const item of items) {
        const treatment = (
          await client.query(
            `INSERT INTO inventory_patient_treatments(id,organization_id,patient_id,unit_id,product_id,dose_quantity,dose_unit,route,frequency_every_days,frequency_every,frequency_unit,first_scheduled_on,planned_administrations,status,created_by_user_id,updated_by_user_id,source_quote_id,source_prescription_item_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ACTIVE',$14,$14,$15,$16) RETURNING *`,
            [
              item.treatmentId,
              auth.organizationId,
              quote.patient_id,
              quote.unit_id,
              item.productId,
              item.doseQuantity,
              item.doseUnit,
              item.route,
              item.frequencyUnit === "MONTH"
                ? null
                : item.frequencyEvery * (item.frequencyUnit === "WEEK" ? 7 : 1),
              item.frequencyEvery,
              item.frequencyUnit,
              input.firstScheduledOn,
              item.quantity,
              auth.user.id,
              quote.id,
              item.prescriptionItemId,
            ],
          )
        ).rows[0];
        await client.query(
          `INSERT INTO inventory_patient_treatment_schedule(organization_id,patient_id,treatment_id,unit_id,product_id,sequence,scheduled_on,dose_quantity,dose_unit,updated_by_user_id) SELECT $1,$2,$3,$4,$5,ordinality,day::date,$6,$7,$8 FROM unnest($9::text[]) WITH ORDINALITY AS dates(day,ordinality)`,
          [
            auth.organizationId,
            quote.patient_id,
            item.treatmentId,
            quote.unit_id,
            item.productId,
            item.doseQuantity,
            item.doseUnit,
            auth.user.id,
            item.dates,
          ],
        );
        const quoted = quoteItems.find((q) => q.prescriptionItemId === item.prescriptionItemId)!;
        await client.query(
          `INSERT INTO inventory_patient_treatment_purchases(organization_id,patient_id,treatment_id,unit_id,purchased_quantity,quantity_unit,total_value,reference,purchased_on,reason,actor,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,($9::timestamptz AT TIME ZONE 'America/Fortaleza')::date,$10,$11,$12)`,
          [
            auth.organizationId,
            quote.patient_id,
            item.treatmentId,
            quote.unit_id,
            Number((item.doseQuantity * item.quantity).toFixed(6)),
            item.doseUnit,
            quoted.subtotalSale,
            `Orçamento ${quote.id}`,
            quote.paid_at,
            input.reason,
            actor(auth).name,
            auth.user.id,
          ],
        );
        await client.query(
          `INSERT INTO inventory_patient_treatment_changes(organization_id,treatment_id,action,after_data,reason,actor,actor_user_id) VALUES($1,$2,'CREATE',$3,$4,$5,$6)`,
          [
            auth.organizationId,
            item.treatmentId,
            treatment,
            input.reason,
            actor(auth).name,
            auth.user.id,
          ],
        );
      }
      await client.query(
        `INSERT INTO inventory_encounter_quote_activations(organization_id,quote_id,patient_id,unit_id,first_scheduled_on,snapshot,reason,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          auth.organizationId,
          quote.id,
          quote.patient_id,
          quote.unit_id,
          input.firstScheduledOn,
          activation,
          input.reason,
          auth.user.id,
        ],
      );
    }
    await client.query("COMMIT");
    return Response.json({ data: { activation } }, { headers });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const message = error instanceof Error ? error.message : "";
    const expectedMessages = new Set([
      "Orçamento não encontrado.",
      "O paciente deve estar ativo e cadastrado na unidade deste orçamento.",
      "Este atendimento não permite ativar um plano.",
      "A prescrição finalizada não foi encontrada.",
      "Itens do orçamento inválidos.",
      "O item do orçamento não corresponde à prescrição.",
      "A unidade desta dose ainda não é suportada pelo plano terapêutico.",
      "Revise a via de administração antes de ativar o plano.",
      "Produto não encontrado ou inativo no catálogo da organização.",
      "Informe uma data válida para a primeira aplicação.",
      "Cadência em horas exige agendamento com horário e ainda não pode ser ativada.",
      "A prescrição precisa de frequência estruturada válida.",
      "Quantidade de aplicações inválida.",
      "O orçamento excede o número de aplicações prescrito.",
      "A prescrição precisa de duração estruturada válida.",
      "A quantidade comprada não cabe na duração prescrita. Revise a prescrição e o orçamento.",
      "A cadência excede o período permitido.",
    ]);
    const unexpected = !expectedMessages.has(message);
    return Response.json(
      { error: unexpected ? "Não foi possível ativar o plano terapêutico." : message },
      { status: unexpected ? 500 : 400, headers },
    );
  } finally {
    client.release();
  }
}
