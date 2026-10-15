-- Preserve existing records; never rewrite historical attribution.
CREATE FUNCTION inventory_guard_clinical_appointment_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.patient_id,NEW.professional_user_id,NEW.unit_id,NEW.organization_id)
     IS DISTINCT FROM ROW(OLD.patient_id,OLD.professional_user_id,OLD.unit_id,OLD.organization_id)
     AND (EXISTS(SELECT 1 FROM inventory_clinical_notes WHERE appointment_id=OLD.id)
       OR EXISTS(SELECT 1 FROM inventory_encounter_prescriptions WHERE appointment_id=OLD.id)
       OR EXISTS(SELECT 1 FROM inventory_encounter_documents WHERE appointment_id=OLD.id))
  THEN RAISE EXCEPTION 'clinical appointment identity is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinical_appointment_identity_guard BEFORE UPDATE ON inventory_care_appointments
FOR EACH ROW EXECUTE FUNCTION inventory_guard_clinical_appointment_identity();
--> statement-breakpoint
CREATE FUNCTION inventory_guard_clinical_record_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE appointment inventory_care_appointments%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.appointment_id,NEW.patient_id,NEW.author_user_id,NEW.author_name,NEW.professional_council,NEW.council_number,NEW.council_region,NEW.organization_id,NEW.unit_id)
    IS DISTINCT FROM ROW(OLD.appointment_id,OLD.patient_id,OLD.author_user_id,OLD.author_name,OLD.professional_council,OLD.council_number,OLD.council_region,OLD.organization_id,OLD.unit_id)
  THEN RAISE EXCEPTION 'clinical record identity and author are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    -- Serialize with appointment updates, including direct SQL writes.
    SELECT * INTO appointment FROM inventory_care_appointments WHERE id=NEW.appointment_id FOR UPDATE;
    IF NOT FOUND OR ROW(NEW.patient_id,NEW.author_user_id,NEW.organization_id,NEW.unit_id)
      IS DISTINCT FROM ROW(appointment.patient_id,appointment.professional_user_id,appointment.organization_id,appointment.unit_id)
    THEN RAISE EXCEPTION 'clinical record identity mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinical_note_identity_guard BEFORE INSERT OR UPDATE ON inventory_clinical_notes FOR EACH ROW EXECUTE FUNCTION inventory_guard_clinical_record_identity();
--> statement-breakpoint
CREATE TRIGGER clinical_prescription_identity_guard BEFORE INSERT OR UPDATE ON inventory_encounter_prescriptions FOR EACH ROW EXECUTE FUNCTION inventory_guard_clinical_record_identity();
--> statement-breakpoint
CREATE TRIGGER clinical_document_identity_guard BEFORE INSERT OR UPDATE ON inventory_encounter_documents FOR EACH ROW EXECUTE FUNCTION inventory_guard_clinical_record_identity();
