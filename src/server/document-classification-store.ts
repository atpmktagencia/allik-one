import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { PoolClient } from "pg";
import { authenticate, can, type AuthContext } from "./auth";
import {
  classificationBoundary,
  classificationConfiguration,
  classifierEnabled,
} from "./document-classifier";
import { recordClinicalAccess } from "./clinical-access-audit";
import { randomUUID } from "node:crypto";
import { getPool } from "./db";
import {
  classificationWrite,
  humanClassificationCommand,
  systemClassificationCommand,
  type ClassificationWrite,
} from "../lib/document-classification-events";
import { DOCUMENT_CLASSIFIER_VERSION } from "../lib/patient-document-classification";

class ClassificationError extends Error {
  constructor(readonly status: number) {
    super("Classification request rejected");
  }
}
async function scopedDocument(
  client: PoolClient,
  auth: AuthContext,
  input: { documentId: string; patientId: string; unitId: string },
) {
  if (
    !auth.user.id ||
    auth.preview ||
    auth.integration ||
    !["SUPER_ADMIN", "PARTNER_ADMIN", "CLINICIAN"].includes(auth.role)
  )
    throw new ClassificationError(403);
  const row = (
    await client.query(
      `SELECT d.*,p.primary_unit_id FROM inventory_patient_documents d JOIN inventory_patients p ON p.id=d.patient_id AND p.organization_id=d.organization_id JOIN inventory_units n ON n.id=d.unit_id AND n.organization_id=d.organization_id JOIN inventory_organizations o ON o.id=d.organization_id WHERE d.id=$1 AND d.organization_id=$2 AND d.patient_id=$3 AND d.unit_id=$4 AND p.active AND n.active AND o.active`,
      [input.documentId, auth.organizationId, input.patientId, input.unitId],
    )
  ).rows[0];
  if (!row) throw new ClassificationError(404);
  for (const unit of [row.unit_id, row.primary_unit_id])
    if (!can(auth, "patients.private.read", unit) || !can(auth, "patients.clinical.manage", unit))
      throw new ClassificationError(403);
  // Recheck current membership at the database boundary; caller cannot invent a role or unit list.
  const member = (
    await client.query(
      `SELECT m.role FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE m.id=$1 AND m.organization_id=$2 AND m.user_id=$3 AND m.active AND u.active AND m.role=$4 AND (m.role='SUPER_ADMIN' OR (EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=$5) AND EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=$6)))`,
      [
        auth.membershipId,
        auth.organizationId,
        auth.user.id,
        auth.role,
        row.unit_id,
        row.primary_unit_id,
      ],
    )
  ).rows[0];
  if (!member) throw new ClassificationError(403);
  return row;
}
export async function appendClassificationEvent(
  client: PoolClient,
  data: ClassificationWrite,
  organizationId: string,
  sourceHash: string,
  actor: { kind: "SYSTEM" | "HUMAN"; userId: string | null },
) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('patient-document-classification:'||$1::text,0))",
    [data.documentId],
  );
  const old = (
    await client.query(
      `SELECT * FROM inventory_patient_document_classification_events WHERE operation_id=$1`,
      [data.operationId],
    )
  ).rows[0];
  if (old) {
    const equal = (
      await client.query(`SELECT $1::jsonb=$2::jsonb same`, [
        old.payload,
        JSON.stringify(data.command.payload),
      ])
    ).rows[0].same;
    if (
      old.document_id !== data.documentId ||
      old.organization_id !== organizationId ||
      old.patient_id !== data.patientId ||
      old.unit_id !== data.unitId ||
      old.actor_kind !== actor.kind ||
      old.actor_user_id !== actor.userId ||
      old.action !== data.command.action ||
      old.attempt_id !== data.attemptId ||
      !equal
    )
      throw new ClassificationError(409);
    return old;
  }
  const latest = (
    await client.query(
      `SELECT revision,action,id,payload,attempt_id FROM inventory_patient_document_classification_events WHERE document_id=$1 ORDER BY revision DESC LIMIT 1`,
      [data.documentId],
    )
  ).rows[0];
  if ((latest?.revision ?? 0) !== data.expectedRevision) throw new ClassificationError(409);
  const action = data.command.action;
  const allowed: Record<string, string[]> = {
    RECEIVED: ["STARTED", "MANUAL_CLASSIFIED"],
    STARTED: ["SUGGESTED", "NEEDS_REVIEW", "FAILED", "MANUAL_CLASSIFIED"],
    SUGGESTED: ["CONFIRMED", "MANUAL_CLASSIFIED", "CORRECTED"],
    NEEDS_REVIEW: ["MANUAL_CLASSIFIED", "CORRECTED"],
    FAILED: ["MANUAL_CLASSIFIED", "RETRY_REQUESTED"],
    RETRY_REQUESTED: ["STARTED", "MANUAL_CLASSIFIED"],
    CONFIRMED: ["CORRECTED"],
    MANUAL_CLASSIFIED: ["CORRECTED"],
    CORRECTED: ["CORRECTED"],
  };
  if (latest ? !allowed[latest.action]?.includes(action) : action !== "RECEIVED")
    throw new ClassificationError(409);
  if (
    ["SUGGESTED", "NEEDS_REVIEW", "FAILED"].includes(action) &&
    latest?.attempt_id !== data.attemptId
  )
    throw new ClassificationError(409);
  if (data.command.action === "CONFIRMED") {
    const expected = latest?.payload?.result?.categories
      ?.map((c: { category: string }) => c.category)
      .sort();
    if (
      data.command.payload.resultEventId !== latest?.id ||
      JSON.stringify([...data.command.payload.categories].sort()) !== JSON.stringify(expected)
    )
      throw new ClassificationError(409);
  }

  return (
    await client.query(
      `INSERT INTO inventory_patient_document_classification_events(document_id,organization_id,unit_id,patient_id,source_sha256,classifier_version,revision,operation_id,actor_kind,actor_user_id,system_identity,action,attempt_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        data.documentId,
        organizationId,
        data.unitId,
        data.patientId,
        sourceHash,
        DOCUMENT_CLASSIFIER_VERSION,
        data.expectedRevision + 1,
        data.operationId,
        actor.kind,
        actor.userId,
        actor.kind === "SYSTEM" ? "document-classifier" : null,
        data.command.action,
        data.attemptId,
        JSON.stringify(data.command.payload),
      ],
    )
  ).rows[0];
}
/** Internal worker-only boundary. Never exported through a route or accepted by the human HTTP handler.
 * No provider call, scheduling, upload hook or GET side effect is implemented here.
 */
export async function appendSystemClassification(organizationId: string, raw: unknown) {
  z.string().uuid().parse(organizationId);
  const data = classificationWrite.parse(raw);
  systemClassificationCommand.parse(data.command);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const doc = (
      await client.query(
        `SELECT d.* FROM inventory_patient_documents d JOIN inventory_patients p ON p.id=d.patient_id AND p.organization_id=d.organization_id JOIN inventory_units n ON n.id=d.unit_id AND n.organization_id=d.organization_id JOIN inventory_organizations o ON o.id=d.organization_id WHERE d.id=$1 AND d.patient_id=$2 AND d.unit_id=$3 AND d.organization_id=$4 AND p.active AND n.active AND o.active`,
        [data.documentId, data.patientId, data.unitId, organizationId],
      )
    ).rows[0];
    if (!doc) throw new ClassificationError(404);
    const result = await appendClassificationEvent(client, data, doc.organization_id, doc.sha256, {
      kind: "SYSTEM",
      userId: null,
    });
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
const scope = z
  .object({
    documentId: z.string().uuid(),
    patientId: z.string().uuid(),
    unitId: z.string().uuid(),
  })
  .strict();
const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
/** Authenticated human/read boundary. System commands are never accepted from HTTP. */
export async function documentClassificationResponse(request: Request) {
  if (!classificationBoundary()) return new Response(null, { status: 404 });
  const auth = await authenticate(request);
  if (!auth)
    return Response.json({ error: "Acesso negado" }, { status: 401, headers: responseHeaders });
  if (!["GET", "POST"].includes(request.method)) return new Response(null, { status: 405 });
  const url = new URL(request.url);
  if (request.method === "POST" && request.headers.get("origin") !== url.origin)
    return new Response(null, { status: 403 });
  const client = await getPool().connect();
  let released = false;
  try {
    await client.query("BEGIN");
    if (request.method === "GET") {
      const input = scope.parse(Object.fromEntries(url.searchParams));
      await scopedDocument(client, auth, input);
      const result = await client.query(
        `SELECT * FROM inventory_patient_document_classification_events WHERE document_id=$1 AND organization_id=$2 AND patient_id=$3 AND unit_id=$4 ORDER BY revision DESC LIMIT 21`,
        [input.documentId, auth.organizationId, input.patientId, input.unitId],
      );
      await recordClinicalAccess(
        auth,
        {
          patientId: input.patientId,
          unitId: input.unitId,
          sourceKind: "GENERAL_DOCUMENT",
          sourceId: input.documentId,
          action: "READ",
          resourceIds: [input.documentId],
        },
        client,
      );
      await client.query("COMMIT");
      return Response.json(
        {
          data: {
            events: result.rows.slice(0, 20).reverse(),
            hasMore: result.rows.length > 20,
            configuration: {
              ...classificationConfiguration(),
              enabled: classifierEnabled(),
              execution: "vercel-waitUntil-or-awaited",
            },
          },
        },
        { headers: responseHeaders },
      );
    }
    const text = await request.text();
    if (text.length > 65536) throw new ClassificationError(413);
    const raw = JSON.parse(text);
    if (raw.action === "RESUME" || raw.action === "RECOVER") {
      const input = z
        .object({
          action: z.enum(["RESUME", "RECOVER"]),
          documentId: z.string().uuid(),
          patientId: z.string().uuid(),
          unitId: z.string().uuid(),
          expectedRevision: z.number().int().min(1),
        })
        .strict()
        .parse(raw);
      const doc = await scopedDocument(client, auth, input);
      const last = (
        await client.query(
          "SELECT * FROM inventory_patient_document_classification_events WHERE document_id=$1 ORDER BY revision DESC LIMIT 1",
          [input.documentId],
        )
      ).rows[0];
      if (!last || last.revision !== input.expectedRevision) throw new ClassificationError(409);
      if (input.action === "RECOVER") {
        if (last.action !== "STARTED" || Date.now() - new Date(last.created_at).getTime() < 180000)
          throw new ClassificationError(409);
        await appendClassificationEvent(
          client,
          {
            ...input,
            operationId: randomUUID(),
            attemptId: last.attempt_id,
            command: {
              action: "FAILED",
              payload: { schemaVersion: 1, failureCode: "AMBIGUOUS_RESPONSE" },
            },
          },
          auth.organizationId,
          doc.sha256,
          { kind: "SYSTEM", userId: null },
        );
      } else if (!["RECEIVED", "RETRY_REQUESTED"].includes(last.action))
        throw new ClassificationError(409);
      await client.query("COMMIT");
      client.release();
      released = true;
      if (input.action === "RESUME")
        await (
          await import("./document-classification-worker")
        ).dispatchClassification(request, input.documentId);
      return Response.json({ data: { ok: true } }, { headers: responseHeaders });
    }
    const data = classificationWrite.parse(raw);
    humanClassificationCommand.parse(data.command);
    const doc = await scopedDocument(client, auth, data);
    if (
      data.expectedRevision === 0 &&
      data.command.action === "MANUAL_CLASSIFIED" &&
      !(
        await client.query(
          "SELECT 1 FROM inventory_patient_document_classification_events WHERE document_id=$1 LIMIT 1",
          [data.documentId],
        )
      ).rowCount
    ) {
      await registerClassificationReceipt(
        client,
        auth.organizationId,
        data.documentId,
        data.patientId,
        data.unitId,
        doc.sha256,
      );
      data.expectedRevision = 1;
    }
    const event = await appendClassificationEvent(client, data, auth.organizationId, doc.sha256, {
      kind: "HUMAN",
      userId: auth.user.id,
    });
    await client.query("COMMIT");
    client.release();
    released = true;
    if (data.command.action === "RETRY_REQUESTED")
      await (
        await import("./document-classification-worker")
      ).dispatchClassification(request, data.documentId);
    return Response.json({ data: { event } }, { headers: responseHeaders });
  } catch (e) {
    await client.query("ROLLBACK");
    const status =
      e instanceof ClassificationError
        ? e.status
        : e instanceof z.ZodError || e instanceof SyntaxError
          ? 400
          : 409;
    return Response.json(
      { error: "Classificação não autorizada, inválida ou desatualizada." },
      { status, headers: responseHeaders },
    );
  } finally {
    if (!released) client.release();
  }
}

export async function registerClassificationReceipt(
  client: PoolClient,
  organizationId: string,
  documentId: string,
  patientId: string,
  unitId: string,
  hash: string,
) {
  return appendClassificationEvent(
    client,
    {
      documentId,
      patientId,
      unitId,
      operationId: documentId,
      expectedRevision: 0,
      attemptId: null,
      command: { action: "RECEIVED", payload: { schemaVersion: 1 } },
    },
    organizationId,
    hash,
    { kind: "SYSTEM", userId: null },
  );
}
