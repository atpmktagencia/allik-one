import "@tanstack/react-start/server-only";
import { del, get, put } from "@vercel/blob";
import { actor, authenticate, can, type AuthContext } from "./auth";
import { getPool } from "./db";
import { treatmentInput } from "../data/treatment-input";
import { patientSupplyInput, type PatientSupplyInput } from "../data/patient-supply-input";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const allowedTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);

async function scopedPatient(auth: AuthContext, patientId: string) {
  const result = await getPool().query(
    `SELECT p.id,p.primary_unit_id AS "primaryUnitId",p.internal_code AS "internalCode",
      p.full_name AS "fullName",p.active,u.name AS "unitName"
     FROM inventory_patients p JOIN inventory_units u ON u.id=p.primary_unit_id
     WHERE p.id=$1 AND p.organization_id=$2`,
    [patientId, auth.organizationId],
  );
  const patient = result.rows[0];
  if (!patient || !can(auth, "patients.read", String(patient.primaryUnitId))) return null;
  return patient;
}

export async function patientDetailResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Entre para acessar pacientes." }, { status: 401, headers });
  if (!can(auth, "patients.read"))
    return Response.json({ error: "Acesso negado." }, { status: 403, headers });
  const patientId = new URL(request.url).searchParams.get("patientId");
  if (!patientId)
    return Response.json({ error: "Paciente não informado." }, { status: 400, headers });
  const patient = await scopedPatient(auth, patientId);
  if (!patient)
    return Response.json({ error: "Paciente não encontrado." }, { status: 404, headers });

  if (request.method === "GET") {
    const [
      treatments,
      prescriptions,
      products,
      purchases,
      schedule,
      presentations,
      stock,
      locations,
      unitDemand,
    ] = await Promise.all([
      getPool().query(
        `SELECT t.id,t.product_id AS "productId",p.name AS "productName",p.sku,
          t.dose_quantity AS "doseQuantity",t.dose_unit AS "doseUnit",t.route,
          t.frequency_every_days AS "frequencyEveryDays",t.first_scheduled_on AS "firstScheduledOn",
          t.planned_administrations AS "plannedAdministrations",t.status,t.version
         FROM inventory_patient_treatments t JOIN inventory_products p ON p.id=t.product_id
         WHERE t.patient_id=$1 AND t.organization_id=$2 ORDER BY t.first_scheduled_on,t.created_at`,
        [patientId, auth.organizationId],
      ),
      getPool().query(
        `SELECT id,treatment_id AS "treatmentId",original_filename AS "originalFilename",
          content_type AS "contentType",size_bytes AS "sizeBytes",uploaded_at AS "uploadedAt"
         FROM inventory_patient_prescriptions WHERE patient_id=$1 AND organization_id=$2
         ORDER BY uploaded_at DESC`,
        [patientId, auth.organizationId],
      ),
      getPool().query(
        `SELECT id,name,sku,unit FROM inventory_products
         WHERE organization_id=$1 AND active AND stock_controlled ORDER BY lower(name)`,
        [auth.organizationId],
      ),
      getPool().query(
        `SELECT id,treatment_id AS "treatmentId",purchased_quantity AS "purchasedQuantity",quantity_unit AS "quantityUnit",total_value AS "totalValue",reference,purchased_on::text AS "purchasedOn",created_at AS "createdAt" FROM inventory_patient_treatment_purchases WHERE patient_id=$1 AND organization_id=$2 ORDER BY purchased_on,created_at`,
        [patientId, auth.organizationId],
      ),
      getPool().query(
        `SELECT s.id,s.treatment_id AS "treatmentId",s.sequence,s.scheduled_on::text AS "scheduledOn",
          s.dose_quantity AS "doseQuantity",s.dose_unit AS "doseUnit",s.status,s.version,
          a.id AS "applicationId",a.reference AS "applicationReference",
          a.professional AS "applicationProfessional",a.physical_quantity AS "physicalQuantity",
          a.created_at AS "administeredAt"
         FROM inventory_patient_treatment_schedule s
         LEFT JOIN inventory_patient_applications a ON a.schedule_id=s.id
         WHERE s.patient_id=$1 AND s.organization_id=$2 ORDER BY s.scheduled_on,s.sequence`,
        [patientId, auth.organizationId],
      ),
      getPool().query(
        `SELECT DISTINCT ON (product_id,upper(base_unit)) product_id AS "productId",upper(base_unit) AS "baseUnit",name,total_base_quantity AS "totalBaseQuantity",technical_loss_percent AS "technicalLossPercent" FROM inventory_pricing_presentations WHERE organization_id=$1 AND active AND product_id IS NOT NULL ORDER BY product_id,upper(base_unit),pricing_status DESC,updated_at DESC`,
        [auth.organizationId],
      ),
      getPool().query(
        `SELECT l.product_id AS "productId",COALESCE(sum(b.quantity),0) AS quantity FROM inventory_balances b JOIN inventory_lots l ON l.id=b.lot_id JOIN inventory_locations loc ON loc.id=b.location_id WHERE loc.unit_id=$1 AND l.status='AVAILABLE' AND l.expires_on>=current_date GROUP BY l.product_id`,
        [patient.primaryUnitId],
      ),
      getPool().query(
        `SELECT id,name FROM inventory_locations
         WHERE unit_id=$1 AND active ORDER BY lower(name)`,
        [patient.primaryUnitId],
      ),
      getPool().query(
        `SELECT product_id AS "productId",upper(dose_unit) AS "doseUnit",sum(dose_quantity) AS quantity
           FROM inventory_patient_treatment_schedule
           WHERE unit_id=$1 AND status IN ('PLANNED','RESERVED') AND scheduled_on>=current_date
           GROUP BY product_id,upper(dose_unit)`,
        [patient.primaryUnitId],
      ),
    ]);
    const purchaseRows = purchases.rows as Array<Record<string, unknown>>;
    const scheduleRows = schedule.rows as Array<Record<string, unknown>>;
    const presentationRows = presentations.rows as Array<Record<string, unknown>>;
    const stockRows = stock.rows as Array<Record<string, unknown>>;
    const unitDemandRows = unitDemand.rows as Array<Record<string, unknown>>;
    const summaries = treatments.rows.map((treatment: Record<string, unknown>) => {
      const treatmentId = String(treatment["id"]);
      const doseUnit = String(treatment["doseUnit"]).toUpperCase();
      const treatmentSchedule = scheduleRows.filter((row) => row["treatmentId"] === treatmentId);
      const activeSchedule = treatmentSchedule.filter((row) => row["status"] !== "CANCELED");
      const purchasedQuantity = purchaseRows
        .filter((row) => row["treatmentId"] === treatmentId)
        .reduce((sum, row) => sum + Number(row["purchasedQuantity"]), 0);
      const reservedQuantity = activeSchedule
        .filter((row) => row["status"] === "RESERVED")
        .reduce((sum, row) => sum + Number(row["doseQuantity"]), 0);
      const consumedQuantity = activeSchedule
        .filter((row) => row["status"] === "CONSUMED")
        .reduce((sum, row) => sum + Number(row["doseQuantity"]), 0);
      const plannedQuantity = activeSchedule
        .filter((row) => row["status"] === "PLANNED")
        .reduce((sum, row) => sum + Number(row["doseQuantity"]), 0);
      const presentation = presentationRows.find(
        (row) => row["productId"] === treatment["productId"] && row["baseUnit"] === doseUnit,
      );
      const availableStockUnits = Number(
        stockRows.find((row) => row["productId"] === treatment["productId"])?.["quantity"] ?? 0,
      );
      const usablePerPresentation = presentation
        ? Number(presentation["totalBaseQuantity"]) *
          (1 - Number(presentation["technicalLossPercent"]) / 100)
        : null;
      const demandQuantity = plannedQuantity + reservedQuantity;
      const requiredPresentationUnits =
        usablePerPresentation && usablePerPresentation > 0
          ? Math.ceil(demandQuantity / usablePerPresentation)
          : null;
      const unitDemandQuantity = Number(
        unitDemandRows.find(
          (row) => row["productId"] === treatment["productId"] && row["doseUnit"] === doseUnit,
        )?.["quantity"] ?? 0,
      );
      const unitRequiredPresentationUnits =
        usablePerPresentation && usablePerPresentation > 0
          ? Math.ceil(unitDemandQuantity / usablePerPresentation)
          : null;
      return {
        treatmentId,
        purchasedQuantity,
        reservedQuantity,
        consumedQuantity,
        plannedQuantity,
        purchasedRemaining: Math.max(0, purchasedQuantity - consumedQuantity),
        presentationName: presentation?.["name"] ?? null,
        usablePerPresentation,
        availableStockUnits,
        requiredPresentationUnits,
        shortageUnits:
          requiredPresentationUnits === null
            ? null
            : Math.max(0, requiredPresentationUnits - availableStockUnits),
        unitDemandQuantity,
        unitRequiredPresentationUnits,
        unitShortageUnits:
          unitRequiredPresentationUnits === null
            ? null
            : Math.max(0, unitRequiredPresentationUnits - availableStockUnits),
      };
    });
    return Response.json(
      {
        data: {
          patient,
          treatments: treatments.rows,
          prescriptions: prescriptions.rows,
          products: products.rows,
          purchases: purchaseRows,
          schedule: scheduleRows,
          supplySummaries: summaries,
          locations: locations.rows,
          canManage: can(auth, "patients.manage", String(patient.primaryUnitId)),
          canConsume:
            can(auth, "patients.read", String(patient.primaryUnitId)) &&
            can(auth, "inventory.consume", String(patient.primaryUnitId)),
        },
      },
      { headers },
    );
  }

  if (request.method !== "POST")
    return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  if (!can(auth, "patients.manage", String(patient.primaryUnitId)))
    return Response.json(
      { error: "Sem permissão para alterar tratamentos." },
      { status: 403, headers },
    );

  if (request.headers.get("content-type")?.startsWith("multipart/form-data"))
    return uploadPrescription(request, auth, patient);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers });
  }
  const supplyParsed = patientSupplyInput.safeParse(body);
  if (supplyParsed.success) {
    if (supplyParsed.data.patientId !== patientId)
      return Response.json({ error: "Paciente inválido." }, { status: 400, headers });
    return updatePatientSupply(auth, patient, supplyParsed.data);
  }
  const parsed = treatmentInput.safeParse(body);
  if (!parsed.success || parsed.data.patientId !== patientId)
    return Response.json(
      { error: "Confira os dados do tratamento ou da compra." },
      { status: 400, headers },
    );
  const input = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const product = await client.query(
      "SELECT id FROM inventory_products WHERE id=$1 AND organization_id=$2 AND active FOR SHARE",
      [input.productId, auth.organizationId],
    );
    if (!product.rowCount) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Produto inválido." }, { status: 400, headers });
    }
    let before: unknown = null;
    let result;
    if (input.action === "CREATE_TREATMENT") {
      result = await client.query(
        `INSERT INTO inventory_patient_treatments(id,organization_id,patient_id,unit_id,product_id,dose_quantity,dose_unit,route,frequency_every_days,first_scheduled_on,planned_administrations,status,created_by_user_id,updated_by_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
        [
          input.id,
          auth.organizationId,
          patientId,
          patient.primaryUnitId,
          input.productId,
          input.doseQuantity,
          input.doseUnit,
          input.route,
          input.frequencyEveryDays,
          input.firstScheduledOn,
          input.plannedAdministrations,
          input.status,
          auth.user.id,
        ],
      );
      if (input.plannedAdministrations)
        await client.query(
          `INSERT INTO inventory_patient_treatment_schedule(organization_id,patient_id,treatment_id,unit_id,product_id,sequence,scheduled_on,dose_quantity,dose_unit,updated_by_user_id)
         SELECT $1,$2,$3,$4,$5,g,($6::date + (($7::numeric * (g-1)) * interval '1 day'))::date,$8,$9,$10 FROM generate_series(1,$11::integer) g`,
          [
            auth.organizationId,
            patientId,
            input.id,
            patient.primaryUnitId,
            input.productId,
            input.firstScheduledOn,
            input.frequencyEveryDays,
            input.doseQuantity,
            input.doseUnit,
            auth.user.id,
            input.plannedAdministrations,
          ],
        );
    } else {
      const current = await client.query(
        "SELECT * FROM inventory_patient_treatments WHERE id=$1 AND patient_id=$2 AND organization_id=$3 FOR UPDATE",
        [input.id, patientId, auth.organizationId],
      );
      if (!current.rowCount) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Tratamento não encontrado." }, { status: 404, headers });
      }
      if (current.rows[0].version !== input.version) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "O tratamento mudou. Recarregue e tente novamente." },
          { status: 409, headers },
        );
      }
      before = current.rows[0];
      result = await client.query(
        `UPDATE inventory_patient_treatments SET product_id=$4,dose_quantity=$5,dose_unit=$6,route=$7,frequency_every_days=$8,first_scheduled_on=$9,planned_administrations=$10,status=$11,updated_by_user_id=$12,version=version+1,updated_at=now()
         WHERE id=$1 AND patient_id=$2 AND organization_id=$3 RETURNING *`,
        [
          input.id,
          patientId,
          auth.organizationId,
          input.productId,
          input.doseQuantity,
          input.doseUnit,
          input.route,
          input.frequencyEveryDays,
          input.firstScheduledOn,
          input.plannedAdministrations,
          input.status,
          auth.user.id,
        ],
      );
    }
    await client.query(
      `INSERT INTO inventory_patient_treatment_changes(organization_id,treatment_id,action,before_data,after_data,reason,actor,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        auth.organizationId,
        input.id,
        input.action === "CREATE_TREATMENT" ? "CREATE" : "UPDATE",
        before,
        result.rows[0],
        input.reason,
        actor(auth).name,
        actor(auth).userId,
      ],
    );
    await client.query("COMMIT");
    return Response.json(
      { data: { id: input.id } },
      { status: input.action === "CREATE_TREATMENT" ? 201 : 200, headers },
    );
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return Response.json(
      { error: "Não foi possível salvar o tratamento." },
      { status: 503, headers },
    );
  } finally {
    client.release();
  }
}

async function updatePatientSupply(
  auth: AuthContext,
  patient: Record<string, unknown>,
  input: PatientSupplyInput,
) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (input.action === "CREATE_PURCHASE") {
      const treatment = await client.query(
        "SELECT id,dose_unit FROM inventory_patient_treatments WHERE id=$1 AND patient_id=$2 AND organization_id=$3 FOR SHARE",
        [input.treatmentId, patient["id"], auth.organizationId],
      );
      if (!treatment.rowCount) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Tratamento inválido." }, { status: 400, headers });
      }
      await client.query(
        `INSERT INTO inventory_patient_treatment_purchases(id,organization_id,patient_id,treatment_id,unit_id,purchased_quantity,quantity_unit,total_value,reference,purchased_on,reason,actor,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          input.id,
          auth.organizationId,
          patient["id"],
          input.treatmentId,
          patient["primaryUnitId"],
          input.purchasedQuantity,
          treatment.rows[0].dose_unit,
          input.totalValue,
          input.reference,
          input.purchasedOn,
          input.reason,
          actor(auth).name,
          actor(auth).userId,
        ],
      );
      await client.query("COMMIT");
      return Response.json({ data: { id: input.id } }, { status: 201, headers });
    }
    const current = await client.query(
      "SELECT * FROM inventory_patient_treatment_schedule WHERE id=$1 AND patient_id=$2 AND organization_id=$3 FOR UPDATE",
      [input.scheduleId, patient["id"], auth.organizationId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Aplicação prevista não encontrada." },
        { status: 404, headers },
      );
    }
    if (current.rows[0].status === "CONSUMED") {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Uma aplicação consumida não pode ser alterada por este fluxo." },
        { status: 409, headers },
      );
    }
    if (current.rows[0].version !== input.version) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "A reserva mudou. Recarregue e tente novamente." },
        { status: 409, headers },
      );
    }
    const updated = await client.query(
      "UPDATE inventory_patient_treatment_schedule SET status=$2,version=version+1,updated_by_user_id=$3,updated_at=now() WHERE id=$1 RETURNING *",
      [input.scheduleId, input.status, auth.user.id],
    );
    await client.query(
      `INSERT INTO inventory_patient_schedule_changes(organization_id,schedule_id,before_data,after_data,reason,actor,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        auth.organizationId,
        input.scheduleId,
        current.rows[0],
        updated.rows[0],
        input.reason,
        actor(auth).name,
        actor(auth).userId,
      ],
    );
    await client.query("COMMIT");
    return Response.json({ data: { id: input.scheduleId } }, { headers });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return Response.json(
      { error: "Não foi possível atualizar a previsão do paciente." },
      { status: 503, headers },
    );
  } finally {
    client.release();
  }
}

async function uploadPrescription(
  request: Request,
  auth: AuthContext,
  patient: Record<string, unknown>,
) {
  const form = await request.formData();
  const file = form.get("file");
  const treatmentId = String(form.get("treatmentId") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (
    !(file instanceof File) ||
    !allowedTypes.has(file.type) ||
    file.size < 1 ||
    file.size > 10 * 1024 * 1024 ||
    reason.length < 10 ||
    reason.length > 500
  )
    return Response.json(
      { error: "Envie PDF ou imagem de até 10 MB e informe o motivo." },
      { status: 400, headers },
    );
  const treatment = await getPool().query(
    "SELECT id FROM inventory_patient_treatments WHERE id=$1 AND patient_id=$2 AND organization_id=$3",
    [treatmentId, patient["id"], auth.organizationId],
  );
  if (!treatment.rowCount)
    return Response.json({ error: "Tratamento inválido." }, { status: 400, headers });
  const prescriptionId = crypto.randomUUID();
  const extension =
    file.type === "application/pdf" ? "pdf" : file.type.split("/")[1]!.replace("jpeg", "jpg");
  const pathname = `prescriptions/${auth.organizationId}/${patient["id"]}/${prescriptionId}.${extension}`;
  const blob = await put(pathname, file, {
    access: "private",
    addRandomSuffix: false,
    contentType: file.type,
  });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO inventory_patient_prescriptions(id,organization_id,patient_id,treatment_id,blob_pathname,original_filename,content_type,size_bytes,uploaded_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        prescriptionId,
        auth.organizationId,
        patient["id"],
        treatmentId,
        blob.pathname,
        file.name.slice(0, 180),
        file.type,
        file.size,
        auth.user.id,
      ],
    );
    await client.query(
      `INSERT INTO inventory_patient_treatment_changes(organization_id,treatment_id,action,after_data,reason,actor,actor_user_id) VALUES($1,$2,'UPLOAD_PRESCRIPTION',$3,$4,$5,$6)`,
      [
        auth.organizationId,
        treatmentId,
        { prescriptionId, contentType: file.type, sizeBytes: file.size },
        reason,
        actor(auth).name,
        actor(auth).userId,
      ],
    );
    await client.query("COMMIT");
    return Response.json({ data: { id: prescriptionId } }, { status: 201, headers });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    await del(blob.pathname).catch(() => {});
    return Response.json(
      { error: "Não foi possível guardar a prescrição." },
      { status: 503, headers },
    );
  } finally {
    client.release();
  }
}

export async function prescriptionDownloadResponse(request: Request, prescriptionId: string) {
  const auth = await authenticate(request);
  if (!auth || !can(auth, "patients.read"))
    return Response.json({ error: "Acesso negado." }, { status: auth ? 403 : 401, headers });
  const result = await getPool().query(
    `SELECT d.blob_pathname,d.original_filename,d.content_type,p.primary_unit_id FROM inventory_patient_prescriptions d JOIN inventory_patients p ON p.id=d.patient_id WHERE d.id=$1 AND d.organization_id=$2`,
    [prescriptionId, auth.organizationId],
  );
  const document = result.rows[0];
  if (!document || !can(auth, "patients.read", String(document.primary_unit_id)))
    return Response.json({ error: "Documento não encontrado." }, { status: 404, headers });
  const blob = await get(String(document.blob_pathname), { access: "private" });
  if (!blob || blob.statusCode !== 200)
    return Response.json({ error: "Documento não encontrado." }, { status: 404, headers });
  const safeName = String(document.original_filename).replace(/["\\\r\n]/g, "_");
  return new Response(blob.stream, {
    headers: {
      "Content-Type": String(document.content_type),
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
