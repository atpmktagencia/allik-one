import "@tanstack/react-start/server-only";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  integrationEventProducerInputSchema as eventSchema,
  type IntegrationEventProducerInput,
  supportedIntegrationEventProducerTypes,
} from "../data/integration-event";
const uuid = z.string().uuid();
export type IntegrationEventInput = IntegrationEventProducerInput;
export type IntegrationEvent = IntegrationEventInput & { id: string; schemaVersion: 1 };
const consumerSchema = z
  .object({
    organizationId: uuid,
    unitId: uuid,
    actorUserId: uuid,
    eventId: uuid,
    consumerKey: z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/),
  })
  .strict();
/** Internal producer only. SAVEPOINT requires an existing caller-owned transaction. No delivery/network effects. */
export async function appendIntegrationEvent(
  client: PoolClient,
  value: IntegrationEventInput,
): Promise<{ id: string; replayed: boolean }> {
  const e = eventSchema.parse(value);
  if (!(supportedIntegrationEventProducerTypes as readonly string[]).includes(e.eventType))
    throw new Error("Unsupported integration lifecycle transition");
  if (e.payload.resourceId !== e.aggregateId || e.payload.resourceVersion !== e.aggregateVersion)
    throw new Error("Event resource mismatch");
  await client.query("SAVEPOINT integration_event_append");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      JSON.stringify([
        e.organizationId,
        e.eventType,
        e.aggregateType,
        e.aggregateId,
        e.aggregateVersion,
      ]),
    ]);
    const previous = (
      await client.query(
        "SELECT id,unit_id,actor_user_id,payload FROM inventory_integration_outbox WHERE organization_id=$1 AND event_type=$2 AND aggregate_type=$3 AND aggregate_id=$4 AND aggregate_version=$5",
        [e.organizationId, e.eventType, e.aggregateType, e.aggregateId, e.aggregateVersion],
      )
    ).rows[0];
    if (previous) {
      if (
        previous.unit_id !== e.unitId ||
        previous.actor_user_id !== e.actorUserId ||
        previous.payload.resourceId !== e.payload.resourceId ||
        previous.payload.resourceVersion !== e.payload.resourceVersion
      )
        throw new Error("Integration event identity conflict");
      await client.query("RELEASE SAVEPOINT integration_event_append");
      return { id: previous.id, replayed: true };
    }
    const result = await client.query<{ id: string }>(
      "INSERT INTO inventory_integration_outbox(organization_id,unit_id,actor_user_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [
        e.organizationId,
        e.unitId,
        e.actorUserId,
        e.eventType,
        e.aggregateType,
        e.aggregateId,
        e.aggregateVersion,
        e.payload,
      ],
    );
    const id = result.rows[0]!.id;
    await client.query(
      "INSERT INTO inventory_integration_event_audit(organization_id,unit_id,event_id,actor_user_id,action) VALUES($1,$2,$3,$4,'EMITTED')",
      [e.organizationId, e.unitId, id, e.actorUserId],
    );
    await client.query("RELEASE SAVEPOINT integration_event_append");
    return { id, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT integration_event_append");
    await client.query("RELEASE SAVEPOINT integration_event_append");
    throw error;
  }
}
/** Explicit trusted in-process adapter. All adapter effects must use this client; no external calls. */
export async function consumeIntegrationEvent(
  pool: Pool,
  value: z.infer<typeof consumerSchema>,
  adapter: (client: PoolClient, event: Readonly<IntegrationEvent>) => Promise<void>,
): Promise<{ replayed: boolean }> {
  const c = consumerSchema.parse(value),
    client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      JSON.stringify([c.organizationId, c.eventId, c.consumerKey]),
    ]);
    const row = (
      await client.query(
        "SELECT id,organization_id,unit_id,actor_user_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload FROM inventory_integration_outbox WHERE id=$1 AND organization_id=$2 AND unit_id=$3",
        [c.eventId, c.organizationId, c.unitId],
      )
    ).rows[0];
    if (!row) throw new Error("Integration event not found in scope");
    const actor = await client.query(
      "SELECT m.id FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id JOIN inventory_organizations o ON o.id=m.organization_id JOIN inventory_units ou ON ou.id=$3 AND ou.organization_id=o.id WHERE m.user_id=$1 AND m.organization_id=$2 AND m.active AND u.active AND o.active AND ou.active AND (m.role='SUPER_ADMIN' OR EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=$3))",
      [c.actorUserId, c.organizationId, c.unitId],
    );
    if (!actor.rowCount) throw new Error("Integration consumer actor not authorized");
    const prior = (
      await client.query(
        "SELECT id,organization_id,unit_id FROM inventory_integration_inbox_receipts WHERE event_id=$1 AND consumer_key=$2",
        [c.eventId, c.consumerKey],
      )
    ).rows[0];
    if (prior) {
      if (prior.organization_id !== c.organizationId || prior.unit_id !== c.unitId)
        throw new Error("Receipt scope conflict");
      await client.query("COMMIT");
      return { replayed: true };
    }
    const event: IntegrationEvent = eventSchema.parse({
      organizationId: row.organization_id,
      unitId: row.unit_id,
      actorUserId: row.actor_user_id,
      eventType: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      aggregateVersion: row.aggregate_version,
      payload: row.payload,
    }) as IntegrationEvent;
    event.id = row.id;
    event.schemaVersion = 1;
    Object.freeze(event.payload);
    Object.freeze(event);
    await adapter(client, event);
    await client.query(
      "INSERT INTO inventory_integration_inbox_receipts(organization_id,unit_id,event_id,consumer_key,actor_user_id) VALUES($1,$2,$3,$4,$5)",
      [c.organizationId, c.unitId, c.eventId, c.consumerKey, c.actorUserId],
    );
    await client.query(
      "INSERT INTO inventory_integration_event_audit(organization_id,unit_id,event_id,consumer_key,actor_user_id,action) VALUES($1,$2,$3,$4,$5,'CONSUMED')",
      [c.organizationId, c.unitId, c.eventId, c.consumerKey, c.actorUserId],
    );
    await client.query("COMMIT");
    return { replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
