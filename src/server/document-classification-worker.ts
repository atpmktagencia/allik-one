import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { get } from "@vercel/blob";
import type { PoolClient } from "pg";
import { systemClassificationCommand } from "../lib/document-classification-events";
import { getPool } from "./db";
import { verifiedOriginal } from "./private-original";
import { appendClassificationEvent } from "./document-classification-store";
import {
  classificationConfiguration,
  classifierEnabled,
  classifyDocument,
} from "./document-classifier";

type ReceiptDoc = {
  id: string;
  organization_id: string;
  patient_id: string;
  unit_id: string;
  sha256: string;
  blob_pathname: string;
  size_bytes: number;
  content_type: string;
  full_name: string;
  revision: number;
};
type Telemetry = {
  documentId: string;
  attemptId: string;
  failureCode?: string;
  [key: string]: unknown;
};
async function append(
  client: PoolClient,
  doc: ReceiptDoc,
  action: string,
  payload: unknown,
  attemptId: string | null,
  expectedRevision: number,
) {
  await client.query("BEGIN");
  try {
    const result = await appendClassificationEvent(
      client,
      {
        documentId: doc.id,
        patientId: doc.patient_id,
        unitId: doc.unit_id,
        operationId: randomUUID(),
        expectedRevision,
        attemptId,
        command: systemClassificationCommand.parse({ action, payload }),
      },
      doc.organization_id,
      doc.sha256,
      { kind: "SYSTEM", userId: null },
    );
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}
/** Global database session locks bound actual provider concurrency across instances.
 * Each worker uses one client for both its slot and events, avoiding pool exhaustion.
 * Persisted RECEIVED is the recoverable queue; GET never dispatches it.
 */
export async function drainClassificationQueue(organizationId: string) {
  if (!classifierEnabled()) return [] as Telemetry[];
  const config = classificationConfiguration();
  if (!config.ready) return [] as Telemetry[];
  let connection: PoolClient | null = null;
  let slot: string | null = null;
  const invocationDeadline = Date.now() + 180000;
  const acquireDeadline = Math.min(Date.now() + 90000, invocationDeadline - 75000);
  while (Date.now() < acquireDeadline && classifierEnabled()) {
    connection = await getPool().connect();
    for (let i = 0; i < 2; i++) {
      const key = `allik-doc-classifier-slot:${i}`;
      if (
        (await connection.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) ok", [key]))
          .rows[0].ok
      ) {
        slot = key;
        break;
      }
    }
    if (slot) break;
    connection.release();
    connection = null;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!connection || !slot) return [] as Telemetry[];
  const client = connection;
  const traces: Telemetry[] = [];
  try {
    const deadline = invocationDeadline;
    for (
      let count = 0;
      count < 12 && Date.now() < deadline - 65000 && classifierEnabled();
      count++
    ) {
      const doc = (
        await client.query(
          `SELECT d.*,p.full_name,e.revision FROM inventory_patient_documents d JOIN inventory_patients p ON p.id=d.patient_id AND p.organization_id=d.organization_id JOIN inventory_units n ON n.id=d.unit_id AND n.organization_id=d.organization_id JOIN inventory_organizations o ON o.id=d.organization_id CROSS JOIN LATERAL(SELECT action,revision FROM inventory_patient_document_classification_events e WHERE e.document_id=d.id AND e.organization_id=d.organization_id ORDER BY revision DESC LIMIT 1)e WHERE d.organization_id=$1 AND e.action IN ('RECEIVED','RETRY_REQUESTED') AND p.active AND n.active AND o.active ORDER BY d.created_at LIMIT 1`,
          [organizationId],
        )
      ).rows[0];
      if (!doc) break;
      const attempt = randomUUID();
      try {
        await append(
          client,
          doc,
          "STARTED",
          { schemaVersion: 1, model: config.model },
          attempt,
          doc.revision,
        );
      } catch {
        continue;
      }
      let trace: Telemetry = { documentId: doc.id, attemptId: attempt };
      try {
        const blob = await get(doc.blob_pathname, { access: "private" });
        if (!blob || blob.statusCode !== 200) throw Error("SOURCE_UNAVAILABLE");
        const bytes = await verifiedOriginal(blob.stream, doc.size_bytes, doc.sha256);
        const result = await classifyDocument(bytes, doc.content_type, doc.full_name);
        trace = { ...trace, ...result.telemetry };
        await append(client, doc, result.action, result.payload, attempt, doc.revision + 1);
      } catch (e) {
        const message = e instanceof Error ? e.message : "";
        const failureCode =
          message === "TIMEOUT"
            ? "TIMEOUT"
            : message === "SOURCE_UNAVAILABLE"
              ? "SOURCE_UNAVAILABLE"
              : "PROVIDER_FAILURE";
        trace = { ...trace, failureCode };
        try {
          await append(
            client,
            doc,
            "FAILED",
            { schemaVersion: 1, failureCode },
            attempt,
            doc.revision + 1,
          );
        } catch {
          trace["discardedLateResponse"] = true;
        }
      }
      traces.push(trace);
      console.info(JSON.stringify({ event: "DOCUMENT_CLASSIFICATION_TELEMETRY", ...trace }));
      // Stop this invocation on unexpected provider outcomes or unmeasurable/excessive spend.
      if (
        trace.failureCode ||
        trace["estimatedCostUsd"] === null ||
        Number(trace["estimatedCostUsd"]) > 0.04
      )
        break;
    }
    return traces;
  } finally {
    let destroy = false;
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [slot]).catch(() => {
      destroy = true;
    });
    client.release(destroy);
  }
}
export async function dispatchClassification(request: Request, documentId?: string) {
  if (!classifierEnabled()) return null;
  if (!documentId) return null;
  const source = (
    await getPool().query("SELECT organization_id FROM inventory_patient_documents WHERE id=$1", [
      documentId,
    ])
  ).rows[0];
  if (!source) return null;
  const task = drainClassificationQueue(source.organization_id).catch(() => [] as Telemetry[]);
  // Explicit wait is for controlled tests/benchmark; it does not authorize or duplicate a job.
  if (request.headers.get("prefer") === "wait=classification" || process.env["VERCEL"] !== "1")
    return (await task).find((t) => t.documentId === documentId) ?? null;
  waitUntil(task);
  return null;
}
