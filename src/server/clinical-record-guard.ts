import "@tanstack/react-start/server-only";
import type { PoolClient } from "pg";

// Call only while holding the appointment row lock; clinical writes use the same lock.
export async function hasClinicalRecords(client: PoolClient, appointmentId: string) {
  const result = await client.query(
    `SELECT EXISTS(SELECT 1 FROM inventory_clinical_notes WHERE appointment_id=$1)
      OR EXISTS(SELECT 1 FROM inventory_encounter_prescriptions WHERE appointment_id=$1)
      OR EXISTS(SELECT 1 FROM inventory_encounter_documents WHERE appointment_id=$1) AS present`,
    [appointmentId],
  );
  return result.rows[0].present === true;
}
