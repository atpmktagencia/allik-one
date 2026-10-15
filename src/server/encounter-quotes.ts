import "@tanstack/react-start/server-only";
import { recordClinicalAccess } from "./clinical-access-audit";
import { z } from "zod";
import { authenticate, can } from "./auth";
import { getPool } from "./db";
import { activateEncounterQuote } from "./encounter-quote-activation";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lifecycleInput = z.object({
  action: z.enum(["APPROVE", "DECLINE", "REGISTER_PAYMENT"]),
  appointmentId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  reason: z.string().trim().max(1000).optional(),
  payment: z
    .object({
      method: z.enum(["PIX", "CASH", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "OTHER"]),
      paidAt: z.string().datetime({ offset: true }),
      reference: z.string().trim().max(500).optional(),
      reason: z.string().trim().min(1).max(1000),
    })
    .optional(),
});

const quoteInput = z.object({
  action: z.enum(["SAVE_DRAFT", "ISSUE"]),
  appointmentId: z.string().uuid(),
  selections: z
    .array(
      z.object({
        prescriptionItemId: z.string().uuid(),
        pricingDoseId: z.string().uuid(),
        quantity: z.number().int().positive().max(1000),
      }),
    )
    .max(50),
  commercialNotes: z.string().trim().max(3000),
  version: z.number().int().nonnegative().nullable(),
});

type PrescriptionItem = {
  id: string;
  productId: string | null;
  medicationName: string;
  doseQuantity: number;
  doseUnit: string;
  plannedAdministrations: number | null;
};

const round = (value: number, decimals: number) => Number(value.toFixed(decimals));

export async function encounterQuotesResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar o orçamento." }, { status: 401, headers });
  if (!can(auth, "patients.private.read") && !can(auth, "quotes.manage"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  if (!new Set(["GET", "POST"]).has(request.method))
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });

  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
    }
    if (
      typeof body === "object" &&
      body &&
      "action" in body &&
      ["PREVIEW_ACTIVATION", "ACTIVATE_PLAN"].includes(String(body.action))
    )
      return activateEncounterQuote(body, auth);
    if (
      typeof body === "object" &&
      body &&
      "action" in body &&
      ["APPROVE", "DECLINE", "REGISTER_PAYMENT"].includes(String(body.action))
    )
      return transitionQuote(body, auth);
    return saveQuote(body, auth);
  }

  const appointmentId = new URL(request.url).searchParams.get("appointmentId");
  if (!appointmentId || !uuidPattern.test(appointmentId))
    return Response.json({ error: "Atendimento inválido." }, { status: 400, headers });
  const pool = getPool();
  const appointmentResult = await pool.query(
    `SELECT id,unit_id AS "unitId",patient_id AS "patientId",professional_user_id AS "professionalUserId",status
     FROM inventory_care_appointments WHERE id=$1 AND organization_id=$2`,
    [appointmentId, auth.organizationId],
  );
  const appointment = appointmentResult.rows[0];
  if (
    !appointment ||
    (!can(auth, "patients.private.read", appointment.unitId) &&
      !can(auth, "quotes.manage", appointment.unitId))
  )
    return Response.json({ error: "Atendimento não encontrado." }, { status: 404, headers });

  const [prescriptionResult, quoteResult, optionResult] = await Promise.all([
    pool.query(
      `SELECT id,items,status,version FROM inventory_encounter_prescriptions
       WHERE appointment_id=$1 AND organization_id=$2 AND status='FINAL'`,
      [appointmentId, auth.organizationId],
    ),
    pool.query(
      `SELECT id,items,commercial_notes AS "commercialNotes",total_sale::text AS "totalSale",
        estimated_cost::text AS "estimatedCost",gross_result::text AS "grossResult",status,version,
        issued_at AS "issuedAt",approved_at AS "approvedAt",declined_at AS "declinedAt",
        paid_at AS "paidAt",payment_method AS "paymentMethod",payment_reference AS "paymentReference",updated_at AS "updatedAt"
       FROM inventory_encounter_quotes WHERE appointment_id=$1 AND organization_id=$2`,
      [appointmentId, auth.organizationId],
    ),
    pool.query(
      `SELECT d.id,d.presentation_id AS "presentationId",d.name,d.dose_quantity::text AS "doseQuantity",
        d.sale_price::text AS "salePrice",d.material_cost::text AS "materialCost",
        p.product_id AS "productId",p.name AS "presentationName",upper(p.base_unit) AS "baseUnit",
        p.total_base_quantity::text AS "totalBaseQuantity",p.acquisition_cost::text AS "acquisitionCost",
        p.additional_presentation_cost::text AS "additionalPresentationCost",
        p.technical_loss_percent::text AS "technicalLossPercent"
       FROM inventory_pricing_doses d
       JOIN inventory_pricing_presentations p ON p.id=d.presentation_id
       WHERE p.organization_id=$1 AND p.active AND d.active AND p.pricing_status='VALIDATED'
       ORDER BY lower(p.name),d.dose_quantity`,
      [auth.organizationId],
    ),
  ]);
  const quote = quoteResult.rows[0] ?? null;
  const activation = quote
    ? ((
        await pool.query(
          "SELECT snapshot FROM inventory_encounter_quote_activations WHERE quote_id=$1 AND organization_id=$2",
          [quote.id, auth.organizationId],
        )
      ).rows[0]?.snapshot ?? null)
    : null;
  const clinicalReader = can(auth, "patients.private.read", appointment.unitId);
  if (clinicalReader && (prescriptionResult.rows[0] || activation))
    await recordClinicalAccess(auth, {
      unitId: appointment.unitId,
      patientId: appointment.patientId,
      appointmentId,
      action: "READ",
      resourceIds: [prescriptionResult.rows[0]?.id, quote?.id].filter(
        (id): id is string => typeof id === "string",
      ),
    });
  const canManage =
    Boolean(auth.user.id) &&
    !auth.preview &&
    !auth.integration &&
    auth.user.id === appointment.professionalUserId &&
    can(auth, "patients.clinical.manage", appointment.unitId) &&
    (!quote || quote.status === "DRAFT") &&
    !["NO_SHOW", "CANCELED"].includes(appointment.status);
  return Response.json(
    {
      data: {
        prescription: clinicalReader ? (prescriptionResult.rows[0] ?? null) : null,
        quote,
        activation: clinicalReader ? activation : null,
        canActivate:
          Boolean(auth.user.id) &&
          !auth.preview &&
          !auth.integration &&
          can(auth, "patients.clinical.manage", appointment.unitId) &&
          quote?.status === "PAID" &&
          !activation,
        pricingOptions: can(auth, "patients.private.read", appointment.unitId)
          ? optionResult.rows
          : [],
        canManage,
        canApprove:
          !auth.preview &&
          !auth.integration &&
          Boolean(auth.user.id) &&
          can(auth, "quotes.manage", appointment.unitId) &&
          quote?.status === "ISSUED",
        canDecline:
          !auth.preview &&
          !auth.integration &&
          Boolean(auth.user.id) &&
          can(auth, "quotes.manage", appointment.unitId) &&
          quote?.status === "ISSUED",
        canRegisterPayment:
          !auth.preview &&
          !auth.integration &&
          Boolean(auth.user.id) &&
          can(auth, "quotes.manage", appointment.unitId) &&
          quote?.status === "APPROVED",
      },
    },
    { headers },
  );
}

async function transitionQuote(
  body: unknown,
  auth: NonNullable<Awaited<ReturnType<typeof authenticate>>>,
) {
  if (!auth.user.id || auth.preview || auth.integration || !can(auth, "quotes.manage"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  const parsed = lifecycleInput.safeParse(body);
  if (!parsed.success || (parsed.data.action === "REGISTER_PAYMENT" && !parsed.data.payment))
    return Response.json(
      { error: "Confira os dados da aprovação ou pagamento." },
      { status: 400, headers },
    );
  const input = parsed.data;
  if (input.payment && Date.parse(input.payment.paidAt) > Date.now())
    return Response.json(
      { error: "A data do pagamento não pode estar no futuro." },
      { status: 400, headers },
    );
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Match the creation lock order to avoid deadlocks with draft/issue writes.
    const appointmentResult = await client.query(
      `SELECT id,unit_id FROM inventory_care_appointments WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
      [input.appointmentId, auth.organizationId],
    );
    const appointment = appointmentResult.rows[0];
    if (!appointment || !can(auth, "quotes.manage", appointment.unit_id)) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Acesso negado ao atendimento." }, { status: 403, headers });
    }
    const result = await client.query(
      `SELECT * FROM inventory_encounter_quotes WHERE appointment_id=$1 AND organization_id=$2 AND unit_id=$3 FOR UPDATE`,
      [input.appointmentId, auth.organizationId, appointment.unit_id],
    );
    const before = result.rows[0];
    if (!before) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Orçamento não encontrado." }, { status: 404, headers });
    }
    if (Number(before.version) !== input.version) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "O orçamento foi alterado em outra sessão. Recarregue a página." },
        { status: 409, headers },
      );
    }
    const payment = input.payment;
    const expected = input.action === "REGISTER_PAYMENT" ? "APPROVED" : "ISSUED";
    if (before.status !== expected) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Esta ação não é permitida no estado atual do orçamento." },
        { status: 409, headers },
      );
    }
    const status =
      input.action === "APPROVE" ? "APPROVED" : input.action === "DECLINE" ? "DECLINED" : "PAID";
    const updated = await client.query(
      `UPDATE inventory_encounter_quotes SET status=$2,
       approved_at=CASE WHEN $2='APPROVED' THEN now() ELSE approved_at END,
       declined_at=CASE WHEN $2='DECLINED' THEN now() ELSE declined_at END,
       paid_at=CASE WHEN $2='PAID' THEN $3::timestamptz ELSE paid_at END,
       payment_method=CASE WHEN $2='PAID' THEN $4 ELSE payment_method END,
       payment_reference=CASE WHEN $2='PAID' THEN $5 ELSE payment_reference END,
       version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
      [
        before.id,
        status,
        payment?.paidAt ?? null,
        payment?.method ?? null,
        payment?.reference || null,
      ],
    );
    const after = updated.rows[0];
    await client.query(
      `INSERT INTO inventory_encounter_quote_changes(organization_id,quote_id,action,before_data,after_data,actor_user_id)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        auth.organizationId,
        before.id,
        input.action,
        before,
        {
          ...after,
          reason: input.action === "REGISTER_PAYMENT" ? payment!.reason : (input.reason ?? null),
          ...(input.action === "REGISTER_PAYMENT"
            ? { paymentAmount: after.total_sale, paymentRecording: "MANUAL_FULL_PAYMENT" }
            : {}),
        },
        auth.user.id,
      ],
    );
    await client.query("COMMIT");
    return Response.json(
      {
        data: {
          id: after.id,
          status: after.status,
          version: after.version,
          totalSale: after.total_sale,
        },
      },
      { headers },
    );
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return Response.json(
      { error: "Não foi possível atualizar o orçamento." },
      { status: 500, headers },
    );
  } finally {
    client.release();
  }
}

async function saveQuote(
  body: unknown,
  auth: NonNullable<Awaited<ReturnType<typeof authenticate>>>,
) {
  if (!auth.user.id || auth.preview || auth.integration || !can(auth, "patients.clinical.manage"))
    return Response.json(
      { error: "Use a conta individual do profissional responsável." },
      { status: 403, headers },
    );
  const parsed = quoteInput.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: "Confira os itens do orçamento." }, { status: 400, headers });
  const uniqueItems = new Set(parsed.data.selections.map((item) => item.prescriptionItemId));
  if (uniqueItems.size !== parsed.data.selections.length)
    return Response.json({ error: "Há itens repetidos no orçamento." }, { status: 400, headers });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const appointmentResult = await client.query(
      `SELECT id,unit_id,patient_id,professional_user_id,status FROM inventory_care_appointments
       WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
      [parsed.data.appointmentId, auth.organizationId],
    );
    const appointment = appointmentResult.rows[0];
    if (!appointment || !can(auth, "patients.clinical.manage", appointment.unit_id))
      throw new Error("NOT_FOUND");
    if (appointment.professional_user_id !== auth.user.id) throw new Error("NOT_AUTHOR");
    if (["NO_SHOW", "CANCELED"].includes(appointment.status)) throw new Error("TERMINAL");

    const prescriptionResult = await client.query(
      `SELECT * FROM inventory_encounter_prescriptions
       WHERE appointment_id=$1 AND organization_id=$2 FOR SHARE`,
      [parsed.data.appointmentId, auth.organizationId],
    );
    const prescription = prescriptionResult.rows[0];
    if (!prescription || prescription.status !== "FINAL") throw new Error("PRESCRIPTION");
    const prescriptionItems = prescription.items as PrescriptionItem[];
    if (
      parsed.data.action === "ISSUE" &&
      parsed.data.selections.length !== prescriptionItems.length
    )
      throw new Error("INCOMPLETE");

    const currentResult = await client.query(
      `SELECT * FROM inventory_encounter_quotes WHERE appointment_id=$1 FOR UPDATE`,
      [parsed.data.appointmentId],
    );
    const current = currentResult.rows[0];
    if (current && current.status !== "DRAFT") throw new Error("ISSUED");
    if ((current ? Number(current.version) : null) !== parsed.data.version)
      throw new Error("STALE");

    const doseIds = parsed.data.selections.map((item) => item.pricingDoseId);
    const optionsResult = doseIds.length
      ? await client.query(
          `SELECT d.id,d.presentation_id,d.name,d.dose_quantity,d.sale_price,d.material_cost,
            p.product_id,p.name AS presentation_name,upper(p.base_unit) AS base_unit,
            p.total_base_quantity,p.acquisition_cost,p.additional_presentation_cost,
            p.technical_loss_percent,p.cost_source,p.cost_valid_on
           FROM inventory_pricing_doses d JOIN inventory_pricing_presentations p ON p.id=d.presentation_id
           WHERE d.id=ANY($1::uuid[]) AND p.organization_id=$2 AND p.active AND d.active
             AND p.pricing_status='VALIDATED' FOR SHARE OF d,p`,
          [doseIds, auth.organizationId],
        )
      : { rows: [] as Record<string, unknown>[] };
    if (optionsResult.rows.length !== doseIds.length) throw new Error("PRICING");
    const options = new Map(optionsResult.rows.map((option) => [option.id, option]));
    const prescriptionById = new Map(prescriptionItems.map((item) => [item.id, item]));
    const items = parsed.data.selections.map((selection) => {
      const item = prescriptionById.get(selection.prescriptionItemId);
      const option = options.get(selection.pricingDoseId);
      if (!item || !option) throw new Error("PRICING");
      if (
        !item.productId ||
        item.productId !== option.product_id ||
        item.doseUnit.toUpperCase() !== option.base_unit ||
        Math.abs(Number(item.doseQuantity) - Number(option.dose_quantity)) > 0.0000001
      )
        throw new Error("MISMATCH");
      const usableQuantity =
        Number(option.total_base_quantity) * (1 - Number(option.technical_loss_percent) / 100);
      if (usableQuantity <= 0) throw new Error("PRICING");
      const medicationCost =
        ((Number(option.acquisition_cost) + Number(option.additional_presentation_cost)) /
          usableQuantity) *
        Number(option.dose_quantity);
      const unitEstimatedCost = medicationCost + Number(option.material_cost);
      const unitSalePrice = Number(option.sale_price);
      return {
        prescriptionItemId: item.id,
        productId: item.productId,
        medicationName: item.medicationName,
        doseQuantity: Number(item.doseQuantity),
        doseUnit: item.doseUnit,
        pricingDoseId: option.id,
        pricingDoseName: option.name,
        presentationId: option.presentation_id,
        presentationName: option.presentation_name,
        quantity: selection.quantity,
        unitSalePrice: round(unitSalePrice, 2),
        unitEstimatedCost: round(unitEstimatedCost, 4),
        subtotalSale: round(unitSalePrice * selection.quantity, 2),
        subtotalEstimatedCost: round(unitEstimatedCost * selection.quantity, 4),
        technicalLossPercent: Number(option.technical_loss_percent),
        costSource: option.cost_source,
        costValidOn: option.cost_valid_on,
      };
    });
    const totalSale = round(
      items.reduce((sum, item) => sum + item.subtotalSale, 0),
      2,
    );
    const estimatedCost = round(
      items.reduce((sum, item) => sum + item.subtotalEstimatedCost, 0),
      4,
    );
    const grossResult = round(totalSale - estimatedCost, 4);
    const issued = parsed.data.action === "ISSUE";
    const result = current
      ? await client.query(
          `UPDATE inventory_encounter_quotes SET items=$2,commercial_notes=$3,total_sale=$4,
            estimated_cost=$5,gross_result=$6,status=$7,
            issued_at=CASE WHEN $7='ISSUED' THEN now() ELSE NULL END,version=version+1,updated_at=now()
           WHERE id=$1 RETURNING *`,
          [
            current.id,
            JSON.stringify(items),
            parsed.data.commercialNotes,
            totalSale,
            estimatedCost,
            grossResult,
            issued ? "ISSUED" : "DRAFT",
          ],
        )
      : await client.query(
          `INSERT INTO inventory_encounter_quotes(organization_id,unit_id,appointment_id,patient_id,
            prescription_id,created_by_user_id,items,commercial_notes,total_sale,estimated_cost,
            gross_result,status,issued_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $12='ISSUED' THEN now() ELSE NULL END)
           RETURNING *`,
          [
            auth.organizationId,
            appointment.unit_id,
            appointment.id,
            appointment.patient_id,
            prescription.id,
            auth.user.id,
            JSON.stringify(items),
            parsed.data.commercialNotes,
            totalSale,
            estimatedCost,
            grossResult,
            issued ? "ISSUED" : "DRAFT",
          ],
        );
    const quote = result.rows[0];
    await client.query(
      `INSERT INTO inventory_encounter_quote_changes(organization_id,quote_id,action,before_data,after_data,actor_user_id)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        auth.organizationId,
        quote.id,
        issued ? "ISSUE" : current ? "UPDATE" : "CREATE",
        current,
        quote,
        auth.user.id,
      ],
    );
    await client.query("COMMIT");
    return Response.json(
      {
        data: {
          id: quote.id,
          status: quote.status,
          version: quote.version,
          totalSale: quote.total_sale,
        },
      },
      { status: current ? 200 : 201, headers },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const reason = error instanceof Error ? error.message : "";
    const response =
      reason === "NOT_FOUND"
        ? ["Atendimento não encontrado.", 404]
        : reason === "NOT_AUTHOR"
          ? ["Somente o profissional responsável pode criar o orçamento.", 403]
          : reason === "TERMINAL"
            ? ["Este atendimento não aceita novas alterações.", 409]
            : reason === "PRESCRIPTION"
              ? ["Finalize a prescrição antes de criar o orçamento.", 409]
              : reason === "INCOMPLETE"
                ? ["Selecione uma precificação validada para todos os itens prescritos.", 400]
                : reason === "ISSUED"
                  ? ["O orçamento emitido é imutável.", 409]
                  : reason === "STALE"
                    ? ["O orçamento foi alterado em outra sessão. Recarregue a página.", 409]
                    : reason === "MISMATCH"
                      ? [
                          "A dose selecionada não corresponde exatamente ao produto, unidade e dose prescritos.",
                          400,
                        ]
                      : reason === "PRICING"
                        ? ["Uma precificação selecionada não está mais válida.", 400]
                        : ["Não foi possível salvar o orçamento.", 500];
    return Response.json({ error: response[0] }, { status: Number(response[1]), headers });
  } finally {
    client.release();
  }
}
