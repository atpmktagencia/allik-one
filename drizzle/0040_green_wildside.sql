ALTER TABLE "inventory_clinical_note_changes" DROP CONSTRAINT "clinical_note_change_action_valid";--> statement-breakpoint
ALTER TABLE "inventory_clinical_note_changes" ADD CONSTRAINT "clinical_note_change_action_valid" CHECK ("inventory_clinical_note_changes"."action" IN ('CREATE','UPDATE','REASSIGN','FINALIZE'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_protect_clinical_note() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinical notes cannot be deleted';
  END IF;
  IF OLD.status = 'FINAL' THEN
    RAISE EXCEPTION 'final clinical notes are immutable';
  END IF;
  IF NEW.organization_id <> OLD.organization_id OR NEW.unit_id <> OLD.unit_id
     OR NEW.appointment_id <> OLD.appointment_id OR NEW.patient_id <> OLD.patient_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'clinical note identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
