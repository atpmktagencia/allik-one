import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { PoolClient } from "pg";
import { can, type AuthContext } from "./auth";
import { recordClinicalAccess } from "./clinical-access-audit";
import {
  laboratoryAutomationEnrollment,
  laboratoryAutomationTransition,
  type LaboratoryAutomationState,
} from "../lib/laboratory-automation";
import { laboratoryAutomationEventWrite } from "../lib/laboratory-automation-events";

export class AutomationError extends Error {
  constructor(readonly status: number) {
    super("Laboratory automation request rejected");
  }
}
const scopeSchema = z
  .object({
    documentId: z.string().uuid(),
    patientId: z.string().uuid(),
    unitId: z.string().uuid(),
  })
  .strict();
const systemScope = scopeSchema.extend({ organizationId: z.string().uuid() }).strict();
type Context = z.infer<typeof systemScope>;
type Actor = { kind: "SYSTEM"; userId: null } | { kind: "HUMAN"; auth: AuthContext };

/** Fail rather than silently releasing transaction locks through autocommit. */
async function requireTransaction(c: PoolClient) {
  await c.query("SAVEPOINT laboratory_automation_boundary");
  await c.query("RELEASE SAVEPOINT laboratory_automation_boundary");
}

/** Caller supplies a transaction. No route, dispatch, cookie, provider or automatic retry. */
async function scopedDocument(
  c: PoolClient,
  organizationId: string,
  scope: z.infer<typeof scopeSchema>,
) {
  const doc = (
    await c.query(
      `SELECT d.*,p.primary_unit_id FROM inventory_patient_documents d JOIN inventory_patients p ON p.id=d.patient_id AND p.organization_id=d.organization_id JOIN inventory_units n ON n.id=d.unit_id AND n.organization_id=d.organization_id JOIN inventory_units pu ON pu.id=p.primary_unit_id AND pu.organization_id=d.organization_id JOIN inventory_organizations o ON o.id=d.organization_id WHERE d.id=$1 AND d.organization_id=$2 AND d.patient_id=$3 AND d.unit_id=$4 AND d.content_type='application/pdf' AND p.active AND n.active AND pu.active AND o.active FOR SHARE OF d,p,n,pu,o`,
      [scope.documentId, organizationId, scope.patientId, scope.unitId],
    )
  ).rows[0];
  if (!doc) throw new AutomationError(404);
  return doc;
}
async function humanScope(c: PoolClient, auth: AuthContext, scope: z.infer<typeof scopeSchema>) {
  if (
    !auth.user.id ||
    !auth.membershipId ||
    auth.preview ||
    auth.integration ||
    !["SUPER_ADMIN", "PARTNER_ADMIN", "CLINICIAN"].includes(auth.role)
  )
    throw new AutomationError(403);
  const doc = await scopedDocument(c, auth.organizationId, scope);
  for (const unit of [doc.unit_id, doc.primary_unit_id])
    if (!can(auth, "patients.private.read", unit) || !can(auth, "patients.clinical.manage", unit))
      throw new AutomationError(403);
  const member = (
    await c.query(
      `SELECT m.id,inventory_professional_registration_state(u.id,m.organization_id) registry_state FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE m.id=$1 AND m.organization_id=$2 AND m.user_id=$3 AND m.role=$4 AND m.active AND u.active AND (m.role='SUPER_ADMIN' OR (EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=$5) AND EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=$6))) FOR SHARE OF m,u`,
      [
        auth.membershipId,
        auth.organizationId,
        auth.user.id,
        auth.role,
        doc.unit_id,
        doc.primary_unit_id,
      ],
    )
  ).rows[0];
  if (!member || ["DUPLICATE", "INVALID"].includes(member.registry_state))
    throw new AutomationError(403);
  return doc;
}
async function delegatedScope(
  c: PoolClient,
  context: Context,
  initiator: string,
  checkPrimary = true,
) {
  const doc = await scopedDocument(c, context.organizationId, context);
  if (checkPrimary && doc.unit_id !== doc.primary_unit_id) throw new AutomationError(409);
  const member = (
    await c.query(
      `SELECT m.id,inventory_professional_registration_state(u.id,m.organization_id) registry_state FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active AND u.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','CLINICIAN') AND (m.role='SUPER_ADMIN' OR (EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=$3) AND EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=$4))) FOR SHARE OF m,u`,
      [context.organizationId, initiator, doc.unit_id, doc.primary_unit_id],
    )
  ).rows[0];
  if (!member || ["DUPLICATE", "INVALID"].includes(member.registry_state))
    throw new AutomationError(403);
  return doc;
}
function sameJson(a: unknown, b: unknown): boolean {
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object")
    return JSON.stringify(a) === JSON.stringify(b);
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameJson(v, b[i]))
    );
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>,
    keys = Object.keys(x).sort();
  return (
    JSON.stringify(keys) === JSON.stringify(Object.keys(y).sort()) &&
    keys.every((k) => sameJson(x[k], y[k]))
  );
}
async function lock(c: PoolClient, documentId: string, requestId?: string) {
  await c.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('patient-document-classification:'||$1::text,0))",
    [documentId],
  );
  if (requestId)
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('laboratory-automation:'||$1::text,0))",
      [requestId],
    );
}
export async function enrollLaboratoryAutomation(c: PoolClient, auth: AuthContext, raw: unknown) {
  await requireTransaction(c);
  const data = laboratoryAutomationEnrollment.parse(raw);
  if (data.organizationId !== auth.organizationId || data.initiatedByUserId !== auth.user.id)
    throw new AutomationError(403);
  await lock(c, data.documentId);
  const doc = await humanScope(c, auth, data);
  if (
    doc.sha256 !== data.sourceSha256 ||
    doc.unit_id !== doc.primary_unit_id ||
    doc.uploaded_by_user_id !== auth.user.id
  )
    throw new AutomationError(409);
  const old = (
    await c.query("SELECT * FROM inventory_laboratory_automation_requests WHERE operation_id=$1", [
      data.operationId,
    ])
  ).rows[0];
  if (old) {
    if (
      old.document_id !== data.documentId ||
      old.organization_id !== data.organizationId ||
      old.patient_id !== data.patientId ||
      old.unit_id !== data.unitId ||
      old.source_sha256 !== data.sourceSha256 ||
      old.receipt_event_id !== data.receiptEventId ||
      old.initiated_by_user_id !== data.initiatedByUserId ||
      old.pipeline_version !== data.pipelineVersion
    )
      throw new AutomationError(409);
    return old;
  }
  if (
    (
      await c.query(
        "SELECT 1 FROM inventory_laboratory_automation_requests WHERE document_id=$1 AND pipeline_version=$2",
        [data.documentId, data.pipelineVersion],
      )
    ).rowCount
  )
    throw new AutomationError(409);
  return (
    await c.query(
      `INSERT INTO inventory_laboratory_automation_requests(operation_id,document_id,organization_id,patient_id,unit_id,source_sha256,receipt_event_id,initiated_by_user_id,pipeline_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        data.operationId,
        data.documentId,
        data.organizationId,
        data.patientId,
        data.unitId,
        data.sourceSha256,
        data.receiptEventId,
        data.initiatedByUserId,
        data.pipelineVersion,
      ],
    )
  ).rows[0];
}

/** SYSTEM is an internal-only service boundary, never parsed from an HTTP request. */
export async function appendLaboratoryAutomationEvent(
  c: PoolClient,
  rawContext: Context,
  raw: unknown,
  actor: Actor,
) {
  await requireTransaction(c);
  const context = systemScope.parse(rawContext),
    data = laboratoryAutomationEventWrite.parse(raw);
  const action = data.command.action;
  if (actor.kind === "HUMAN" && !["RETRY_REQUESTED", "CANCELLED"].includes(action))
    throw new AutomationError(403);
  if (actor.kind === "SYSTEM" && action === "RETRY_REQUESTED") throw new AutomationError(403);
  if (actor.kind === "HUMAN" && actor.auth.organizationId !== context.organizationId)
    throw new AutomationError(403);
  await lock(c, context.documentId, data.requestId);
  const request = (
    await c.query(
      `SELECT * FROM inventory_laboratory_automation_requests WHERE id=$1 AND organization_id=$2 AND patient_id=$3 AND unit_id=$4 AND document_id=$5`,
      [
        data.requestId,
        context.organizationId,
        context.patientId,
        context.unitId,
        context.documentId,
      ],
    )
  ).rows[0];
  if (!request) throw new AutomationError(404);
  if (actor.kind === "HUMAN") await humanScope(c, actor.auth, context);
  // Cancellation must remain possible after access revocation; its trusted system context
  // is still tied to the immutable original, never an arbitrary request ID.
  if (action !== "CANCELLED") {
    const doc = await delegatedScope(c, context, request.initiated_by_user_id);
    if (doc.sha256 !== request.source_sha256) throw new AutomationError(409);
  }
  const userId = actor.kind === "HUMAN" ? actor.auth.user.id : null;
  const old = (
    await c.query("SELECT * FROM inventory_laboratory_automation_events WHERE operation_id=$1", [
      data.operationId,
    ])
  ).rows[0];
  if (old) {
    if (
      old.request_id !== request.id ||
      old.revision !== data.expectedRevision + 1 ||
      old.actor_kind !== actor.kind ||
      old.actor_user_id !== userId ||
      old.action !== action ||
      old.classification_event_id !== data.classificationEventId ||
      old.attempt_id !== data.attemptId ||
      !sameJson(old.payload, data.command.payload)
    )
      throw new AutomationError(409);
    return old;
  }
  const latest = (
    await c.query(
      "SELECT * FROM inventory_laboratory_automation_events WHERE request_id=$1 ORDER BY revision DESC LIMIT 1",
      [request.id],
    )
  ).rows[0];
  if ((latest?.revision ?? 0) !== data.expectedRevision) throw new AutomationError(409);
  const attempts = Number(
    (
      await c.query(
        "SELECT count(*) n FROM inventory_laboratory_automation_events WHERE request_id=$1 AND action='STARTED'",
        [request.id],
      )
    ).rows[0].n,
  );
  const classification = (
    await c.query(
      "SELECT id FROM inventory_patient_document_classification_events WHERE document_id=$1 AND organization_id=$2 AND patient_id=$3 AND unit_id=$4 ORDER BY revision DESC LIMIT 1",
      [context.documentId, context.organizationId, context.patientId, context.unitId],
    )
  ).rows[0];
  if (
    !laboratoryAutomationTransition({
      previous: (latest?.action ?? "ENROLLED") as LaboratoryAutomationState,
      next: action,
      actor: actor.kind,
      startedAttempts: attempts,
      sameClassification:
        classification?.id === data.classificationEventId &&
        (action === "STARTED" || latest?.classification_event_id === data.classificationEventId),
      sameAttempt: latest?.attempt_id === data.attemptId,
    })
  )
    throw new AutomationError(409);
  // Database guard independently enforces state, classification revision and attempt.
  // A delayed duplicate returns its old event above; it never reapplies an import change.
  return (
    await c.query(
      `INSERT INTO inventory_laboratory_automation_events(request_id,operation_id,revision,action,classification_event_id,attempt_id,actor_kind,actor_user_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        request.id,
        data.operationId,
        data.expectedRevision + 1,
        action,
        data.classificationEventId,
        data.attemptId,
        actor.kind,
        userId,
        JSON.stringify(data.command.payload),
      ],
    )
  ).rows[0];
}

export async function readLaboratoryAutomation(c: PoolClient, auth: AuthContext, raw: unknown) {
  await requireTransaction(c);
  const input = scopeSchema.parse(raw);
  await humanScope(c, auth, input);
  const request =
    (
      await c.query(
        "SELECT * FROM inventory_laboratory_automation_requests WHERE document_id=$1 AND organization_id=$2 AND patient_id=$3 AND unit_id=$4",
        [input.documentId, auth.organizationId, input.patientId, input.unitId],
      )
    ).rows[0] ?? null;
  const events = request
    ? (
        await c.query(
          "SELECT * FROM inventory_laboratory_automation_events WHERE request_id=$1 ORDER BY revision DESC LIMIT 21",
          [request.id],
        )
      ).rows.reverse()
    : [];
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
    c,
  );
  return { request, events };
}
