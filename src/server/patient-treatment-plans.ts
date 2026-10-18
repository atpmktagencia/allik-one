import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticate, can, canAccessAllUnits } from "./auth";
import { getPool } from "./db";
import { hasClinicalRegistration, canWriteClinicalDocument } from "./clinical-professional-policy";
import { recordClinicalAccess } from "./clinical-access-audit";
import { treatmentPlanSchema, computeTreatmentPlan } from "../data/treatment-plan";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
const input = z
  .object({
    action: z.literal("SAVE_PLAN"),
    id: z.string().uuid(),
    operationId: z.string().uuid(),
    version: z.number().int().positive().nullable(),
    patientId: z.string().uuid(),
    title: z.string().trim().min(2).max(200),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
    plan: treatmentPlanSchema,
  })
  .strict();
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 262144) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
const headFields = `id,patient_id AS "patientId",unit_id AS "unitId",author_user_id AS "authorUserId",title,status,version,start_date::text AS "startDate",preview_days AS "previewDays"`;
export async function patientTreatmentPlansResponse(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para consultar os planos.", 401);
  if (
    !auth.user.id ||
    auth.preview ||
    auth.integration ||
    !can(auth, "patients.private.read") ||
    !can(auth, "patients.clinical.manage")
  )
    return fail("Use uma conta clínica individual autorizada.", 403);
  if (!["GET", "POST"].includes(request.method)) return fail("Método não permitido.", 405);
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin)
    return fail("Origem não autorizada.", 403);
  let data: z.infer<typeof input> | undefined;
  let computed: ReturnType<typeof computeTreatmentPlan> | undefined;
  if (request.method === "POST") {
    const parsed = input.safeParse(await body(request));
    if (!parsed.success) return fail("Confira o plano e as etapas informadas.", 400);
    data = parsed.data;
  }
  const filter = z
    .object({
      patientId: z.string().uuid(),
      planId: z.string().uuid().optional(),
      unitId: z.string().uuid().optional(),
    })
    .strict()
    .safeParse(
      request.method === "GET"
        ? Object.fromEntries(new URL(request.url).searchParams)
        : { patientId: data!.patientId },
    );
  if (!filter.success) return fail("Paciente ou plano inválido.", 400);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const selector = z
      .string()
      .uuid()
      .optional()
      .safeParse(new URL(request.url).searchParams.get("unitId") ?? undefined);
    if (!selector.success) return fail("Unidade inválida.", 400);
    if (
      selector.data &&
      (!can(auth, "patients.private.read", selector.data) ||
        !can(auth, "patients.clinical.manage", selector.data) ||
        !(
          await client.query("SELECT id FROM inventory_units WHERE id=$1 AND organization_id=$2", [
            selector.data,
            auth.organizationId,
          ])
        ).rowCount)
    )
      return fail("Unidade não autorizada.", 403);

    const patient = (
      await client.query(
        "SELECT id,primary_unit_id,active FROM inventory_patients WHERE id=$1 AND organization_id=$2 FOR SHARE",
        [filter.data.patientId, auth.organizationId],
      )
    ).rows[0];
    if (!patient || !can(auth, "patients.private.read", patient.primary_unit_id))
      return fail("Paciente não encontrado.", 404);
    const professional = (
      await client.query(
        "SELECT professional_council,council_number,council_region,inventory_professional_registration_state(id,$2) AS registry_state FROM inventory_users WHERE id=$1 AND active FOR SHARE",
        [auth.user.id, auth.organizationId],
      )
    ).rows[0];
    const clinical =
      professional &&
      hasClinicalRegistration(professional) &&
      !["INVALID", "DUPLICATE"].includes(professional.registry_state) &&
      can(auth, "patients.clinical.manage", patient.primary_unit_id);
    if (!data) {
      const rows = (
        await client.query(
          `SELECT ${headFields} FROM inventory_clinical_plans WHERE organization_id=$1 AND patient_id=$2 AND ($3::boolean OR unit_id=ANY($4::uuid[])) ORDER BY updated_at DESC,id LIMIT 25`,
          [auth.organizationId, patient.id, canAccessAllUnits(auth), auth.unitIds],
        )
      ).rows;
      const plans = rows.map((r) => ({
        ...r,
        canEdit: Boolean(clinical && r.authorUserId === auth.user.id && r.status !== "ARCHIVED"),
      }));
      if (filter.data.planId) {
        const record = (
          await client.query(
            `SELECT ${headFields} FROM inventory_clinical_plans WHERE id=$1 AND organization_id=$2 AND patient_id=$3 AND ($4::boolean OR unit_id=ANY($5::uuid[])) FOR SHARE`,
            [
              filter.data.planId,
              auth.organizationId,
              patient.id,
              canAccessAllUnits(auth),
              auth.unitIds,
            ],
          )
        ).rows[0];
        if (!record) return fail("Plano não encontrado.", 404);
        const items = (
          await client.query(
            "SELECT definition FROM inventory_clinical_plan_items WHERE plan_id=$1 AND active ORDER BY position,id LIMIT 51",
            [record.id],
          )
        ).rows.map((r) => r.definition);
        const plan = treatmentPlanSchema.parse({
          startDate: record.startDate,
          previewDays: record.previewDays,
          items,
        });
        const preview = computeTreatmentPlan(plan);
        await recordClinicalAccess(auth, {
          unitId: record.unitId,
          patientId: patient.id,
          action: "READ",
          resourceIds: [record.id],
        });
        await client.query("COMMIT");
        return Response.json(
          {
            data: {
              record,
              plan,
              preview,
              canEdit: Boolean(
                clinical && record.authorUserId === auth.user.id && record.status !== "ARCHIVED",
              ),
            },
          },
          { headers },
        );
      }
      const [products, catalogItems, treatments, appointments, instances] = [
        await client.query(
          "SELECT id,name,sku FROM inventory_products WHERE organization_id=$1 AND active ORDER BY name,id LIMIT 100",
          [auth.organizationId],
        ),
        await client.query(
          "SELECT id,name,kind FROM inventory_engine_catalog_items WHERE organization_id=$1 AND active ORDER BY name,id LIMIT 100",
          [auth.organizationId],
        ),
        await client.query(
          `SELECT t.id,'Tratamento: '||p.name AS label FROM inventory_patient_treatments t JOIN inventory_products p ON p.id=t.product_id WHERE t.organization_id=$1 AND t.patient_id=$2 AND ($3::boolean OR t.unit_id=ANY($4::uuid[])) ORDER BY t.id LIMIT 100`,
          [auth.organizationId, patient.id, canAccessAllUnits(auth), auth.unitIds],
        ),
        await client.query(
          `SELECT id,care_type||' · '||starts_at::text AS label FROM inventory_care_appointments WHERE organization_id=$1 AND patient_id=$2 AND ($3::boolean OR unit_id=ANY($4::uuid[])) ORDER BY starts_at DESC,id LIMIT 100`,
          [auth.organizationId, patient.id, canAccessAllUnits(auth), auth.unitIds],
        ),
        await client.query(
          `SELECT i.id,d.title||' · '||i.created_at::text AS label FROM inventory_prescription_protocol_instances i JOIN inventory_encounter_documents d ON d.id=i.document_id WHERE i.organization_id=$1 AND d.patient_id=$2 AND ($3::boolean OR d.unit_id=ANY($4::uuid[])) ORDER BY i.created_at DESC,i.id LIMIT 100`,
          [auth.organizationId, patient.id, canAccessAllUnits(auth), auth.unitIds],
        ),
      ];
      await recordClinicalAccess(auth, {
        unitId: patient.primary_unit_id,
        patientId: patient.id,
        action: "READ",
        resourceIds: plans.map((p) => p.id),
      });
      await client.query("COMMIT");
      return Response.json(
        {
          data: {
            plans,
            canManage: Boolean(clinical && patient.active),
            targets: {
              products: products.rows,
              catalogItems: catalogItems.rows,
              treatments: treatments.rows,
              appointments: appointments.rows,
              prescriptionInstances: instances.rows,
            },
          },
        },
        { headers },
      );
    }
    if (!clinical || !patient.active)
      return fail("Plano exige um profissional habilitado e um paciente ativo.", 403);
    try {
      computed = computeTreatmentPlan(data.plan);
    } catch {
      return fail("Confira as quantidades, unidades e etapas do plano.", 400);
    }
    if (
      data.plan.items.some((item) => item.kind === "PRESCRIPTION" || item.formula) &&
      !canWriteClinicalDocument(professional.professional_council, "PRESCRIPTION")
    )
      return fail("Composição de receita exige profissional habilitado para prescrever.", 403);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${auth.organizationId}:${data.operationId}`,
    ]);
    const before = (
      await client.query(
        "SELECT * FROM inventory_clinical_plans WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [data.id, auth.organizationId],
      )
    ).rows[0];
    if (
      before &&
      (!can(auth, "patients.clinical.manage", before.unit_id) || before.patient_id !== patient.id)
    )
      return fail("Plano não encontrado.", 404);
    if (before && before.author_user_id !== auth.user.id)
      return fail("Somente o autor pode editar este plano.", 403);
    const hash = createHash("sha256")
      .update(JSON.stringify({ actor: auth.user.id, input: data }))
      .digest("hex");
    const previous = (
      await client.query(
        "SELECT request_hash,result FROM inventory_clinical_plan_events WHERE organization_id=$1 AND operation_id=$2",
        [auth.organizationId, data.operationId],
      )
    ).rows[0];
    if (previous) {
      if (previous.request_hash !== hash)
        return fail("Operação já utilizada com outros dados.", 409);
      await client.query("COMMIT");
      return Response.json({ data: previous.result }, { headers });
    }
    if ((before && before.version !== data.version) || (!before && data.version !== null))
      return fail("Plano alterado. Atualize antes de salvar.", 409);
    if (before?.status === "ARCHIVED") return fail("Plano arquivado não pode ser editado.", 409);
    const unitId: string = before?.unit_id ?? patient.primary_unit_id;
    if (
      (
        await client.query(
          "SELECT id FROM inventory_units WHERE id=ANY($1::uuid[]) AND organization_id=$2 AND active FOR SHARE",
          [[...new Set([unitId, patient.primary_unit_id])], auth.organizationId],
        )
      ).rowCount !== new Set([unitId, patient.primary_unit_id]).size
    )
      return fail("Unidade indisponível.", 403);
    // Validate all explicit references without inferring links from labels or similar names.
    for (const item of data.plan.items) {
      if (
        item.productId &&
        !(
          await client.query(
            "SELECT id FROM inventory_products WHERE id=$1 AND organization_id=$2 AND active FOR SHARE",
            [item.productId, auth.organizationId],
          )
        ).rowCount
      )
        return fail("Produto não encontrado.", 404);
      if (item.catalogItemId) {
        const target = (
          await client.query(
            "SELECT kind FROM inventory_engine_catalog_items WHERE id=$1 AND organization_id=$2 AND active FOR SHARE",
            [item.catalogItemId, auth.organizationId],
          )
        ).rows[0];
        if (!target) return fail("Item de catálogo não encontrado.", 404);
        if (item.kind === "PRESCRIPTION" && !["ACTIVE", "MEDICATION"].includes(target.kind))
          return fail("Catálogo incompatível com o item clínico.", 400);
        if (item.kind !== "PRESCRIPTION" && !["SERVICE", "PROCEDURE"].includes(target.kind))
          return fail("Catálogo incompatível com o item clínico.", 400);
      }
      if (
        item.existingTreatmentId &&
        !(
          await client.query(
            "SELECT id FROM inventory_patient_treatments WHERE id=$1 AND organization_id=$2 AND patient_id=$3 AND unit_id=$4 FOR SHARE",
            [item.existingTreatmentId, auth.organizationId, patient.id, unitId],
          )
        ).rowCount
      )
        return fail("Tratamento não encontrado.", 404);
      if (
        item.appointmentId &&
        !(
          await client.query(
            "SELECT id FROM inventory_care_appointments WHERE id=$1 AND organization_id=$2 AND patient_id=$3 AND unit_id=$4 FOR SHARE",
            [item.appointmentId, auth.organizationId, patient.id, unitId],
          )
        ).rowCount
      )
        return fail("Atendimento não encontrado.", 404);
      if (
        item.prescriptionInstanceId &&
        !(
          await client.query(
            "SELECT i.id FROM inventory_prescription_protocol_instances i JOIN inventory_encounter_documents d ON d.id=i.document_id WHERE i.id=$1 AND i.organization_id=$2 AND d.patient_id=$3 AND d.unit_id=$4 FOR SHARE OF i,d",
            [item.prescriptionInstanceId, auth.organizationId, patient.id, unitId],
          )
        ).rowCount
      )
        return fail("Instância de receita não encontrada.", 404);
    }
    const beforeSnapshot = before
      ? ((
          await client.query(
            "SELECT snapshot FROM inventory_clinical_plan_versions WHERE plan_id=$1 AND version=$2",
            [before.id, before.version],
          )
        ).rows[0]?.snapshot ?? null)
      : null;
    const version = (before?.version ?? 0) + 1;
    if (before)
      await client.query(
        "UPDATE inventory_clinical_plans SET title=$2,status=$3,start_date=$4,preview_days=$5,version=$6,updated_at=now() WHERE id=$1",
        [data.id, data.title, data.status, data.plan.startDate, data.plan.previewDays, version],
      );
    else
      await client.query(
        "INSERT INTO inventory_clinical_plans(id,organization_id,patient_id,unit_id,author_user_id,title,status,start_date,preview_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          data.id,
          auth.organizationId,
          patient.id,
          unitId,
          auth.user.id,
          data.title,
          data.status,
          data.plan.startDate,
          data.plan.previewDays,
        ],
      );
    await client.query("UPDATE inventory_clinical_plan_items SET active=false WHERE plan_id=$1", [
      data.id,
    ]);
    for (const [position, item] of data.plan.items.entries()) {
      const old = (
        await client.query(
          "SELECT plan_id FROM inventory_clinical_plan_items WHERE id=$1 FOR UPDATE",
          [item.id],
        )
      ).rows[0];
      if (old && old.plan_id !== data.id) return fail("Identificador de item já utilizado.", 409);
      await client.query(
        `INSERT INTO inventory_clinical_plan_items(id,plan_id,organization_id,kind,position,definition,product_id,catalog_item_id,existing_treatment_id,appointment_id,prescription_instance_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET kind=EXCLUDED.kind,position=EXCLUDED.position,definition=EXCLUDED.definition,product_id=EXCLUDED.product_id,catalog_item_id=EXCLUDED.catalog_item_id,existing_treatment_id=EXCLUDED.existing_treatment_id,appointment_id=EXCLUDED.appointment_id,prescription_instance_id=EXCLUDED.prescription_instance_id,active=true,updated_at=now()`,
        [
          item.id,
          data.id,
          auth.organizationId,
          item.kind,
          position,
          JSON.stringify(item),
          item.productId,
          item.catalogItemId,
          item.existingTreatmentId ?? null,
          item.appointmentId ?? null,
          item.prescriptionInstanceId ?? null,
        ],
      );
    }
    const snapshot = (
      await client.query(
        `SELECT jsonb_build_object('head',to_jsonb(p),'items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY position,id),'[]'::jsonb) FROM inventory_clinical_plan_items i WHERE i.plan_id=p.id AND i.active),'plan',$2::jsonb,'preview',$3::jsonb) snapshot FROM inventory_clinical_plans p WHERE id=$1`,
        [data.id, JSON.stringify(data.plan), JSON.stringify(computed)],
      )
    ).rows[0].snapshot;
    await client.query(
      "INSERT INTO inventory_clinical_plan_versions(plan_id,organization_id,unit_id,version,snapshot) VALUES($1,$2,$3,$4,$5)",
      [data.id, auth.organizationId, unitId, version, JSON.stringify(snapshot)],
    );
    const result = { id: data.id, version };
    await client.query(
      "INSERT INTO inventory_clinical_plan_events(plan_id,organization_id,unit_id,actor_user_id,operation_id,request_hash,before_data,after_data,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        data.id,
        auth.organizationId,
        unitId,
        auth.user.id,
        data.operationId,
        hash,
        beforeSnapshot ? JSON.stringify(beforeSnapshot) : null,
        JSON.stringify(snapshot),
        JSON.stringify(result),
      ],
    );
    await client.query("COMMIT");
    return Response.json({ data: result }, { headers, status: before ? 200 : 201 });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return fail(
      ["23505"].includes(code)
        ? "Conflito de identificação ou versão."
        : "Não foi possível processar o plano.",
      ["23505"].includes(code) ? 409 : ["23503", "23514", "P0001"].includes(code) ? 400 : 503,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
