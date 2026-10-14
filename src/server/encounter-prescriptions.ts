import "@tanstack/react-start/server-only";
import { z } from "zod";
import { actor, authenticate, can } from "./auth";
import { getPool } from "./db";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const prescriptionItem = z
  .object({
    id: z.string().uuid(),
    productId: z.string().uuid().nullable(),
    medicationName: z.string().trim().min(2).max(200),
    doseQuantity: z.number().positive().max(1_000_000),
    doseUnit: z.enum(["MG", "MCG", "G", "ML", "UI", "UNIT", "OTHER"]),
    doseUnitOther: z.string().trim().max(30).default(""),
    route: z.string().trim().min(2).max(80),
    frequencyEvery: z.number().int().positive().max(365),
    frequencyUnit: z.enum(["HOUR", "DAY", "WEEK", "MONTH"]),
    durationAmount: z.number().int().positive().max(3650).nullable(),
    durationUnit: z.enum(["DAY", "WEEK", "MONTH"]).nullable(),
    continuousUse: z.boolean(),
    plannedAdministrations: z.number().int().positive().max(1000).nullable(),
    instructions: z.string().trim().max(2000).default(""),
  })
  .refine((item) => item.doseUnit !== "OTHER" || item.doseUnitOther.length >= 1, {
    message: "Informe a unidade da dose.",
    path: ["doseUnitOther"],
  })
  .refine(
    (item) =>
      item.continuousUse
        ? item.durationAmount === null && item.durationUnit === null
        : item.durationAmount !== null && item.durationUnit !== null,
    {
      message: "Informe a duração ou marque uso contínuo.",
      path: ["durationAmount"],
    },
  );

const prescriptionInput = z.object({
  action: z.enum(["SAVE_DRAFT", "FINALIZE"]),
  appointmentId: z.string().uuid(),
  items: z.array(prescriptionItem).max(50),
  generalInstructions: z.string().trim().max(5000),
  version: z.number().int().nonnegative().nullable(),
});

export async function encounterPrescriptionsResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar a prescrição." }, { status: 401, headers });
  if (!can(auth, "patients.private.read"))
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
    return savePrescription(body, auth);
  }

  const appointmentId = new URL(request.url).searchParams.get("appointmentId");
  if (!appointmentId || !uuidPattern.test(appointmentId))
    return Response.json({ error: "Atendimento inválido." }, { status: 400, headers });

  const pool = getPool();
  const appointmentResult = await pool.query(
    `SELECT a.id,a.unit_id AS "unitId",a.patient_id AS "patientId",
      a.professional_user_id AS "professionalUserId",a.status,
      u.professional_council AS "professionalCouncil",u.council_number AS "councilNumber",
      u.council_region AS "councilRegion"
     FROM inventory_care_appointments a
     JOIN inventory_users u ON u.id=a.professional_user_id
     WHERE a.id=$1 AND a.organization_id=$2`,
    [appointmentId, auth.organizationId],
  );
  const appointment = appointmentResult.rows[0] as Record<string, unknown> | undefined;
  if (!appointment || !can(auth, "patients.private.read", String(appointment["unitId"])))
    return Response.json({ error: "Atendimento não encontrado." }, { status: 404, headers });

  const [prescription, products] = await Promise.all([
    pool.query(
      `SELECT id,items,general_instructions AS "generalInstructions",status,version,
        author_name AS "authorName",professional_council AS "professionalCouncil",
        council_number AS "councilNumber",council_region AS "councilRegion",
        finalized_at AS "finalizedAt",updated_at AS "updatedAt"
       FROM inventory_encounter_prescriptions
       WHERE appointment_id=$1 AND organization_id=$2`,
      [appointmentId, auth.organizationId],
    ),
    pool.query(
      `SELECT id,name,sku,unit FROM inventory_products
       WHERE organization_id=$1 AND active ORDER BY lower(name),lower(sku)`,
      [auth.organizationId],
    ),
  ]);
  const assigned = auth.user.id === appointment["professionalUserId"];
  const completeCouncil = Boolean(
    appointment["professionalCouncil"] &&
    appointment["councilNumber"] &&
    appointment["councilRegion"],
  );
  const canAuthor =
    Boolean(auth.user.id) &&
    !auth.preview &&
    !auth.integration &&
    assigned &&
    completeCouncil &&
    can(auth, "patients.clinical.manage", String(appointment["unitId"])) &&
    prescription.rows[0]?.status !== "FINAL" &&
    !["NO_SHOW", "CANCELED"].includes(String(appointment["status"]));

  return Response.json(
    {
      data: {
        prescription: prescription.rows[0] ?? null,
        products: products.rows,
        canAuthor,
      },
    },
    { headers },
  );
}

async function savePrescription(
  body: unknown,
  auth: NonNullable<Awaited<ReturnType<typeof authenticate>>>,
) {
  if (!auth.user.id || auth.preview || auth.integration || !can(auth, "patients.clinical.manage"))
    return Response.json(
      { error: "Use uma conta profissional individual para prescrever." },
      { status: 403, headers },
    );
  const parsed = prescriptionInput.safeParse(body);
  if (!parsed.success)
    return Response.json(
      { error: "Confira todos os itens da prescrição." },
      { status: 400, headers },
    );
  if (parsed.data.action === "FINALIZE" && parsed.data.items.length === 0)
    return Response.json(
      { error: "Inclua pelo menos um item antes de finalizar." },
      { status: 400, headers },
    );

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const appointmentResult = await client.query(
      `SELECT a.id,a.unit_id,a.patient_id,a.professional_user_id,a.status,
        u.name AS author_name,u.professional_council,u.council_number,u.council_region
       FROM inventory_care_appointments a
       JOIN inventory_users u ON u.id=a.professional_user_id
       WHERE a.id=$1 AND a.organization_id=$2 FOR UPDATE OF a`,
      [parsed.data.appointmentId, auth.organizationId],
    );
    const appointment = appointmentResult.rows[0];
    if (!appointment || !can(auth, "patients.clinical.manage", appointment.unit_id))
      throw new Error("NOT_FOUND");
    if (appointment.professional_user_id !== auth.user.id) throw new Error("NOT_AUTHOR");
    if (
      !appointment.professional_council ||
      !appointment.council_number ||
      !appointment.council_region
    )
      throw new Error("INCOMPLETE_COUNCIL");
    if (["NO_SHOW", "CANCELED"].includes(appointment.status)) throw new Error("TERMINAL");

    const currentResult = await client.query(
      `SELECT * FROM inventory_encounter_prescriptions WHERE appointment_id=$1 FOR UPDATE`,
      [parsed.data.appointmentId],
    );
    const current = currentResult.rows[0];
    if (current && current.author_user_id !== auth.user.id) throw new Error("NOT_AUTHOR");
    if (current?.status === "FINAL") throw new Error("FINAL");
    if ((current ? Number(current.version) : null) !== parsed.data.version)
      throw new Error("STALE");

    const productIds = [
      ...new Set(
        parsed.data.items
          .map((item) => item.productId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const productRows = productIds.length
      ? await client.query(
          `SELECT id,name FROM inventory_products
           WHERE organization_id=$1 AND active AND id=ANY($2::uuid[])`,
          [auth.organizationId, productIds],
        )
      : { rows: [] as Array<{ id: string; name: string }> };
    if (productRows.rows.length !== productIds.length) throw new Error("PRODUCT");
    const productNames = new Map(
      productRows.rows.map((row: { id: string; name: string }) => [row.id, row.name]),
    );
    const items = parsed.data.items.map((item) => ({
      ...item,
      medicationName: item.productId ? productNames.get(item.productId) : item.medicationName,
    }));
    const final = parsed.data.action === "FINALIZE";
    const signer = actor(auth);
    const result = current
      ? await client.query(
          `UPDATE inventory_encounter_prescriptions
           SET items=$2,general_instructions=$3,status=$4,
             finalized_at=CASE WHEN $4='FINAL' THEN now() ELSE NULL END,
             version=version+1,updated_at=now()
           WHERE id=$1 RETURNING *`,
          [
            current.id,
            JSON.stringify(items),
            parsed.data.generalInstructions,
            final ? "FINAL" : "DRAFT",
          ],
        )
      : await client.query(
          `INSERT INTO inventory_encounter_prescriptions(
             organization_id,unit_id,appointment_id,patient_id,author_user_id,author_name,
             professional_council,council_number,council_region,items,general_instructions,
             status,finalized_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             CASE WHEN $12='FINAL' THEN now() ELSE NULL END)
           RETURNING *`,
          [
            auth.organizationId,
            appointment.unit_id,
            parsed.data.appointmentId,
            appointment.patient_id,
            auth.user.id,
            signer.name,
            appointment.professional_council,
            appointment.council_number,
            appointment.council_region,
            JSON.stringify(items),
            parsed.data.generalInstructions,
            final ? "FINAL" : "DRAFT",
          ],
        );
    const prescription = result.rows[0];
    await client.query(
      `INSERT INTO inventory_encounter_prescription_changes(
         organization_id,prescription_id,action,before_data,after_data,actor_user_id)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        auth.organizationId,
        prescription.id,
        final ? "FINALIZE" : current ? "UPDATE" : "CREATE",
        current,
        prescription,
        auth.user.id,
      ],
    );
    await client.query("COMMIT");
    return Response.json(
      { data: { id: prescription.id, status: prescription.status, version: prescription.version } },
      { status: current ? 200 : 201, headers },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const reason = error instanceof Error ? error.message : "";
    const response =
      reason === "NOT_FOUND"
        ? ["Atendimento não encontrado.", 404]
        : reason === "NOT_AUTHOR"
          ? ["Somente o profissional responsável pode prescrever.", 403]
          : reason === "INCOMPLETE_COUNCIL"
            ? ["Complete o conselho profissional antes de prescrever.", 409]
            : reason === "TERMINAL"
              ? ["Este atendimento não aceita prescrição.", 409]
              : reason === "FINAL"
                ? ["A prescrição finalizada é imutável.", 409]
                : reason === "STALE"
                  ? ["A prescrição mudou em outra sessão. Atualize a página.", 409]
                  : reason === "PRODUCT"
                    ? ["Um produto selecionado não está disponível.", 400]
                    : ["Não foi possível salvar a prescrição.", 500];
    if (response[1] === 500)
      console.error(
        "encounter prescription write failed",
        error instanceof Error ? error.message : "unknown error",
      );
    return Response.json({ error: response[0] }, { status: response[1] as number, headers });
  } finally {
    client.release();
  }
}
