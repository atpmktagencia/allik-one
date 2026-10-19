import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticate, can, canAccessAllUnits } from "./auth";
import { getPool } from "./db";
import { recordClinicalAccess, recordClinicalListAccess } from "./clinical-access-audit";
import { renderPlanQuoteProposal } from "../data/plan-quote-proposal";
import { treatmentPlanSchema } from "../data/treatment-plan";
import { computePlanQuote, planQuoteOverrideSchema } from "../data/plan-quote";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
const uuid = z.string().uuid();
const base = {
  planId: uuid,
  patientId: uuid.optional(),
  expectedPlanVersion: z.number().int().positive(),
  overrides: z.array(planQuoteOverrideSchema).max(500).default([]),
  discountBps: z.number().int().min(0).max(10000).default(0),
};
const input = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("PREVIEW") }).strict(),
  z
    .object({
      ...base,
      action: z.literal("SAVE_ESTIMATE"),
      id: uuid,
      version: z.number().int().positive().nullable(),
      operationId: uuid,
      expectedPreviewHash: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .strict(),
]);
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function pick(value: unknown, fields: string[]) {
  const row = object(value);
  return Object.fromEntries(
    fields
      .filter(
        (k) =>
          Object.hasOwn(row, k) &&
          (row[k] === null || ["string", "number", "boolean"].includes(typeof row[k])),
      )
      .map((k) => [k, row[k]]),
  );
}
export function planQuoteSnapshotDto(value: unknown) {
  const row = object(value),
    estimate = object(row["estimate"] ?? value);
  return {
    ...pick(estimate, [
      "knownSubtotal",
      "subtotal",
      "discountAmount",
      "total",
      "complete",
      "referenceDate",
      "unitId",
      "planVersion",
      "sourcePlanVersion",
      "unitName",
      "previewHash",
      "discountBps",
    ]),
    overrides: Array.isArray(estimate["overrides"])
      ? estimate["overrides"].map((v) => pick(v, ["candidateKey", "selected", "quantity", "unit"]))
      : [],
    lines: Array.isArray(estimate["lines"])
      ? estimate["lines"].map((v) => ({
          ...pick(v, [
            "candidateKey",
            "chargeGroup",
            "targetType",
            "targetId",
            "label",
            "billingMode",
            "selected",
            "isOptional",
            "canExclude",
            "status",
            "reason",
            "quantity",
            "unit",
            "unitPrice",
            "subtotal",
            "priceId",
            "priceVersion",
            "priceSource",
            "validFrom",
            "validUntil",
          ]),
          mappingIds: Array.isArray(object(v)["mappingIds"])
            ? (object(v)["mappingIds"] as unknown[]).filter(
                (v) => typeof v === "string" && uuid.safeParse(v).success,
              )
            : [],
        }))
      : [],
  };
}
const columns = `q.id,q.patient_id AS "patientId",q.unit_id AS "unitId",q.plan_id AS "planId",q.plan_version AS "planVersion",q.version,q.status,q.created_at AS "createdAt",q.updated_at AS "updatedAt"`;
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 262144) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
    const all = new Uint8Array(size);
    let off = 0;
    for (const chunk of chunks) {
      all.set(chunk, off);
      off += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
export async function planQuotesResponse(request: Request, attempt = 0): Promise<Response> {
  const auth = await authenticate(request);
  if (!auth) return fail("Entre para consultar as estimativas.", 401);
  if (!auth.user.id || auth.preview || auth.integration || !can(auth, "quotes.manage"))
    return fail("Use uma conta individual autorizada para orçamentos.", 403);
  if (!["GET", "POST"].includes(request.method)) return fail("Método não permitido.", 405);
  const url = new URL(request.url);
  if (request.method === "POST" && request.headers.get("origin") !== url.origin)
    return fail("Origem não autorizada.", 403);
  const query = z
    .object({
      patientId: uuid.optional(),
      planId: uuid.optional(),
      quoteId: uuid.optional(),
      revision: z.coerce.number().int().positive().optional(),
      format: z.literal("proposal").optional(),
      unitId: uuid.optional(),
    })
    .strict()
    .safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) return fail("Filtros inválidos.", 400);
  const filter = query.data;
  let d: z.infer<typeof input> | undefined;
  if (request.method === "POST") {
    const parsed = input.safeParse(await readBody(request));
    if (!parsed.success) return fail("Confira a estimativa e os ajustes comerciais.", 400);
    d = parsed.data;
    if (d.discountBps && auth.role !== "SUPER_ADMIN")
      return fail("Desconto exige SUPER_ADMIN.", 403);
  }
  const client = await getPool().connect();
  let released = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    if (
      filter.unitId &&
      (!can(auth, "quotes.manage", filter.unitId) ||
        !(
          await client.query("SELECT id FROM inventory_units WHERE id=$1 AND organization_id=$2", [
            filter.unitId,
            auth.organizationId,
          ])
        ).rowCount)
    )
      return fail("Unidade não autorizada.", 403);
    const all = canAccessAllUnits(auth),
      flags = {
        canPreview: true,
        canSave: true,
        canDiscount: auth.role === "SUPER_ADMIN",
        canReadClinical:
          can(auth, "patients.private.read") && can(auth, "patients.clinical.manage"),
      };
    if (!d && !filter.planId) {
      if (filter.quoteId || filter.revision || filter.format)
        return fail("Informe o plano da estimativa.", 400);
      const rows = (
        await client.query(
          `SELECT ${columns},p.full_name AS "patientName",u.name AS "unitName",v.snapshot->'estimate'->>'total' AS total,(v.snapshot->'estimate'->>'complete')::boolean AS complete FROM inventory_plan_quotes q JOIN inventory_clinical_plans cp ON cp.id=q.plan_id AND cp.organization_id=q.organization_id JOIN inventory_patients p ON p.id=q.patient_id AND p.organization_id=q.organization_id JOIN inventory_units u ON u.id=q.unit_id JOIN inventory_plan_quote_versions v ON v.quote_id=q.id AND v.version=q.version WHERE q.organization_id=$1 AND ($2::boolean OR (q.unit_id=ANY($3::uuid[]) AND cp.unit_id=ANY($3::uuid[]) AND p.primary_unit_id=ANY($3::uuid[]))) AND ($4::uuid IS NULL OR q.patient_id=$4) AND ($5::uuid IS NULL OR q.unit_id=$5) ORDER BY q.updated_at DESC,q.id LIMIT 25`,
          [auth.organizationId, all, auth.unitIds, filter.patientId ?? null, filter.unitId ?? null],
        )
      ).rows;
      await recordClinicalListAccess(
        auth,
        rows.map((row) => ({ unitId: row.unitId, patientId: row.patientId })),
      );
      await client.query("COMMIT");
      return Response.json({ data: { estimates: rows, ...flags } }, { headers });
    }
    const planId = d?.planId ?? filter.planId!;
    const source = (
      await client.query(
        `SELECT cp.*,p.primary_unit_id,p.active AS patient_active,p.full_name AS patient_name,u.name AS unit_name,u.active AS unit_active,cu.active AS current_unit_active FROM inventory_clinical_plans cp JOIN inventory_patients p ON p.id=cp.patient_id AND p.organization_id=cp.organization_id JOIN inventory_units u ON u.id=cp.unit_id AND u.organization_id=cp.organization_id JOIN inventory_units cu ON cu.id=p.primary_unit_id AND cu.organization_id=cp.organization_id WHERE cp.id=$1 AND cp.organization_id=$2 FOR SHARE OF cp,p,u,cu`,
        [planId, auth.organizationId],
      )
    ).rows[0];
    if (
      !source ||
      !can(auth, "quotes.manage", source.unit_id) ||
      !can(auth, "quotes.manage", source.primary_unit_id) ||
      (filter.patientId && filter.patientId !== source.patient_id) ||
      (d?.patientId && d.patientId !== source.patient_id)
    )
      return fail("Plano não encontrado.", 404);
    const canWrite = auth.role !== "CLINICIAN" || source.author_user_id === auth.user.id;
    const context = {
      ...flags,
      canPreview: canWrite && source.status !== "ARCHIVED",
      canSave: canWrite && source.status !== "ARCHIVED",
      unitId: source.unit_id,
      unitName: source.unit_name,
      planVersion: source.version,
    };
    if (!d) {
      if (filter.quoteId) {
        const record = (
          await client.query(
            `SELECT ${columns} FROM inventory_plan_quotes q WHERE q.id=$1 AND q.organization_id=$2 AND q.plan_id=$3 AND q.patient_id=$4`,
            [filter.quoteId, auth.organizationId, planId, source.patient_id],
          )
        ).rows[0];
        if (!record) return fail("Estimativa não encontrada.", 404);
        const revision = filter.revision ?? record.version;
        const stored = (
          await client.query(
            "SELECT snapshot FROM inventory_plan_quote_versions WHERE quote_id=$1 AND organization_id=$2 AND unit_id=$3 AND version=$4",
            [record.id, auth.organizationId, source.unit_id, revision],
          )
        ).rows[0];
        if (!stored) return fail("Revisão não encontrada.", 404);
        await recordClinicalAccess(auth, {
          unitId: source.unit_id,
          patientId: source.patient_id,
          action: "READ",
          resourceIds: [record.id],
        });
        await client.query("COMMIT");
        if (filter.format === "proposal")
          return new Response(
            renderPlanQuoteProposal(planQuoteSnapshotDto(stored.snapshot), {
              quoteId: record.id,
              revision,
              patientName: source.patient_name,
            }),
            {
              headers: {
                ...headers,
                "Content-Type": "text/html; charset=utf-8",
                "Referrer-Policy": "no-referrer",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy":
                  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
              },
            },
          );
        return Response.json(
          {
            data: {
              canExport: true,
              record,
              snapshot: planQuoteSnapshotDto(stored.snapshot),
              revision,
              ...context,
            },
          },
          { headers },
        );
      }
      if (filter.format) return fail("Selecione uma estimativa salva para gerar a proposta.", 400);
      const estimates = (
        await client.query(
          `SELECT ${columns} FROM inventory_plan_quotes q WHERE q.organization_id=$1 AND q.plan_id=$2 AND q.patient_id=$3 ORDER BY q.updated_at DESC,q.id LIMIT 25`,
          [auth.organizationId, planId, source.patient_id],
        )
      ).rows;
      await recordClinicalAccess(auth, {
        unitId: source.unit_id,
        patientId: source.patient_id,
        action: "READ",
        resourceIds: estimates.map((row) => row.id),
      });
      await client.query("COMMIT");
      return Response.json({ data: { estimates, ...context } }, { headers });
    }
    if (!canWrite)
      return fail("Somente o autor clínico pode preparar estimativas deste plano.", 403);
    let before: Record<string, unknown> | undefined;
    const hash = createHash("sha256")
      .update(JSON.stringify({ actor: auth.user.id, input: d }))
      .digest("hex");
    if (d.action === "SAVE_ESTIMATE") {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${auth.organizationId}:${d.operationId}`,
      ]);
      before = (
        await client.query(
          "SELECT * FROM inventory_plan_quotes WHERE id=$1 AND organization_id=$2 FOR UPDATE",
          [d.id, auth.organizationId],
        )
      ).rows[0];
      if (
        before &&
        (before["plan_id"] !== planId ||
          before["patient_id"] !== source.patient_id ||
          before["unit_id"] !== source.unit_id)
      )
        return fail("Estimativa não encontrada.", 404);
      const previous = (
        await client.query(
          "SELECT request_hash,result FROM inventory_plan_quote_events WHERE organization_id=$1 AND operation_id=$2",
          [auth.organizationId, d.operationId],
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== hash)
          return fail("Operação reutilizada com outros dados.", 409);
        await client.query("COMMIT");
        return Response.json({ data: previous.result }, { headers });
      }
      if ((before && before["version"] !== d.version) || (!before && d.version !== null))
        return fail("Estimativa alterada. Atualize antes de salvar.", 409);
    }
    if (
      source.status === "ARCHIVED" ||
      !source.patient_active ||
      !source.unit_active ||
      !source.current_unit_active
    )
      return fail("Plano ou unidade indisponível para nova estimativa.", 409);
    if (source.version !== d.expectedPlanVersion)
      return fail("Plano alterado. Atualize e recalcule explicitamente.", 409);
    const revision = (
      await client.query(
        "SELECT snapshot FROM inventory_clinical_plan_versions WHERE plan_id=$1 AND organization_id=$2 AND version=$3",
        [planId, auth.organizationId, source.version],
      )
    ).rows[0];
    if (!revision) return fail("Revisão clínica indisponível.", 409);
    const plan = treatmentPlanSchema.parse(revision.snapshot.plan);
    const sourceIds = [
      ...new Set(plan.items.map((i) => i.catalogItemId).filter((id): id is string => Boolean(id))),
    ];
    const mappings = (
      await client.query(
        `SELECT id,source_item_id AS "sourceItemId",target_product_id AS "targetProductId",target_item_id AS "targetItemId",billing_mode AS "billingMode",charge_group AS "chargeGroup",active FROM inventory_engine_commercial_mappings WHERE organization_id=$1 AND active AND source_item_id=ANY($2::uuid[]) ORDER BY id LIMIT 501 FOR SHARE`,
        [auth.organizationId, sourceIds],
      )
    ).rows;
    if (mappings.length > 500) return fail("Há vínculos demais para uma estimativa segura.", 409);
    const productIds = [
        ...new Set(
          [...plan.items.map((i) => i.productId), ...mappings.map((m) => m.targetProductId)].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      ],
      catalogIds = [
        ...new Set(
          [...sourceIds, ...mappings.map((m) => m.targetItemId)].filter((id): id is string =>
            Boolean(id),
          ),
        ),
      ];
    const products = (
      await client.query(
        "SELECT id,name,active FROM inventory_products WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE",
        [auth.organizationId, productIds],
      )
    ).rows;
    const catalogItems = (
      await client.query(
        "SELECT id,name,kind,active FROM inventory_engine_catalog_items WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE",
        [auth.organizationId, catalogIds],
      )
    ).rows;
    const prices = (
      await client.query(
        `SELECT id,unit_id AS "unitId",product_id AS "productId",catalog_item_id AS "catalogItemId",amount::text,selling_unit AS "sellingUnit",source,valid_from::text AS "validFrom",valid_until::text AS "validUntil",availability,active,version FROM inventory_engine_unit_sale_prices WHERE organization_id=$1 AND unit_id=$2 AND (product_id=ANY($3::uuid[]) OR catalog_item_id=ANY($4::uuid[])) ORDER BY id FOR SHARE`,
        [auth.organizationId, source.unit_id, productIds, catalogIds],
      )
    ).rows;
    const referenceDate = (
      await client.query("SELECT (now() AT TIME ZONE 'America/Fortaleza')::date::text date")
    ).rows[0].date;
    let estimate;
    try {
      estimate = {
        ...computePlanQuote({
          plan,
          unitId: source.unit_id,
          referenceDate,
          mappings,
          products,
          catalogItems,
          prices,
          overrides: d.overrides,
          discountBps: d.discountBps,
        }),
        referenceDate,
        unitId: source.unit_id,
        planVersion: source.version,
        sourcePlanVersion: source.version,
        unitName: source.unit_name,
        discountBps: d.discountBps,
        overrides: d.overrides,
      };
    } catch {
      return fail("Confira os ajustes, as unidades e os vínculos comerciais.", 400);
    }
    const previewHash = createHash("sha256").update(JSON.stringify(estimate)).digest("hex");
    estimate = { ...estimate, previewHash };
    if (d.action === "SAVE_ESTIMATE" && d.expectedPreviewHash !== previewHash)
      return fail("Preços ou vínculos alterados; recalcule a estimativa antes de salvar.", 409);
    if (d.action === "PREVIEW") {
      await recordClinicalAccess(auth, {
        unitId: source.unit_id,
        patientId: source.patient_id,
        action: "READ",
        resourceIds: [planId],
      });
      await client.query("COMMIT");
      return Response.json({ data: planQuoteSnapshotDto(estimate) }, { headers });
    }
    const version = Number(before?.["version"] ?? 0) + 1;
    if (before)
      await client.query(
        "UPDATE inventory_plan_quotes SET plan_version=$2,version=$3,updated_at=now() WHERE id=$1",
        [d.id, source.version, version],
      );
    else
      await client.query(
        "INSERT INTO inventory_plan_quotes(id,organization_id,patient_id,unit_id,plan_id,plan_version,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          d.id,
          auth.organizationId,
          source.patient_id,
          source.unit_id,
          planId,
          source.version,
          auth.user.id,
        ],
      );
    const snapshot = (
      await client.query(
        "SELECT jsonb_build_object('head',to_jsonb(q),'estimate',$2::jsonb,'actorUserId',$3::text) snapshot FROM inventory_plan_quotes q WHERE id=$1",
        [d.id, JSON.stringify(estimate), auth.user.id],
      )
    ).rows[0].snapshot;
    await client.query(
      "INSERT INTO inventory_plan_quote_versions(quote_id,organization_id,unit_id,version,snapshot) VALUES($1,$2,$3,$4,$5)",
      [d.id, auth.organizationId, source.unit_id, version, JSON.stringify(snapshot)],
    );
    const previousSnapshot = before
      ? ((
          await client.query(
            "SELECT snapshot FROM inventory_plan_quote_versions WHERE quote_id=$1 AND version=$2",
            [d.id, before["version"]],
          )
        ).rows[0]?.snapshot ?? null)
      : null;
    const result = { id: d.id, version };
    await client.query(
      "INSERT INTO inventory_plan_quote_events(quote_id,organization_id,unit_id,actor_user_id,operation_id,request_hash,before_data,after_data,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        d.id,
        auth.organizationId,
        source.unit_id,
        auth.user.id,
        d.operationId,
        hash,
        previousSnapshot ? JSON.stringify(previousSnapshot) : null,
        JSON.stringify(snapshot),
        JSON.stringify(result),
      ],
    );
    await client.query("COMMIT");
    return Response.json({ data: result }, { headers, status: before ? 200 : 201 });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (
      d?.action === "SAVE_ESTIMATE" &&
      attempt < 1 &&
      ["23505", "40001", "40P01"].includes(code)
    ) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      released = true;
      const retryHeaders = new Headers(request.headers);
      retryHeaders.delete("content-length");
      return planQuotesResponse(
        new Request(request.url, {
          method: "POST",
          headers: retryHeaders,
          body: JSON.stringify(d),
        }),
        attempt + 1,
      );
    }
    return fail(
      ["23505", "40001", "40P01"].includes(code)
        ? "Conflito de versão. Atualize e tente novamente."
        : "Não foi possível processar a estimativa.",
      ["23505", "40001", "40P01"].includes(code)
        ? 409
        : ["23503", "23514", "P0001"].includes(code)
          ? 400
          : 503,
    );
  } finally {
    if (!released) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  }
}
