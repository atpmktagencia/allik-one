ALTER TABLE "inventory_patients" ADD COLUMN "allergy_status" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD COLUMN "allergy_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD COLUMN "allergy_reviewed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD CONSTRAINT "inventory_patients_allergy_reviewed_by_user_id_inventory_users_id_fk" FOREIGN KEY ("allergy_reviewed_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD CONSTRAINT "patient_allergy_assessment_valid" CHECK ("inventory_patients"."allergy_status" IN ('UNKNOWN','DENIED','REPORTED') AND (("inventory_patients"."allergy_reviewed_at" IS NULL AND "inventory_patients"."allergy_reviewed_by_user_id" IS NULL AND "inventory_patients"."allergy_status"='UNKNOWN') OR ("inventory_patients"."allergy_reviewed_at" IS NOT NULL AND "inventory_patients"."allergy_reviewed_by_user_id" IS NOT NULL)));--> statement-breakpoint
CREATE FUNCTION inventory_guard_allergy_assessment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE has_legacy boolean;
BEGIN
  has_legacy := CASE WHEN jsonb_typeof(NEW.private_data->'allergies')='array' THEN jsonb_array_length(NEW.private_data->'allergies')>0
    WHEN NEW.private_data ? 'allergies' AND NEW.private_data->'allergies'<>'null'::jsonb THEN true ELSE false END;
  -- A newly reported intake allergy invalidates the old denial, without erasing its audit history.
  IF TG_OP='UPDATE' AND OLD.allergy_status='DENIED' AND NEW.allergy_status='DENIED' AND has_legacy
    AND NEW.private_data IS DISTINCT FROM OLD.private_data THEN
    NEW.allergy_status:='UNKNOWN'; NEW.allergy_reviewed_at:=NULL; NEW.allergy_reviewed_by_user_id:=NULL;
  END IF;
  IF NEW.allergy_status='DENIED' AND (has_legacy OR EXISTS(SELECT 1 FROM inventory_patient_clinical_alerts a
    WHERE a.organization_id=NEW.organization_id AND a.patient_id=NEW.id AND a.type='ALLERGY' AND a.status='ACTIVE')) THEN
    RAISE EXCEPTION 'ALLERGY_DENIAL_CONFLICT' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER patient_allergy_assessment_guard BEFORE INSERT OR UPDATE ON inventory_patients FOR EACH ROW EXECUTE FUNCTION inventory_guard_allergy_assessment();
--> statement-breakpoint
CREATE FUNCTION inventory_guard_active_allergy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assessment text;
BEGIN
  IF NEW.type='ALLERGY' AND NEW.status='ACTIVE' THEN
    SELECT allergy_status INTO assessment FROM inventory_patients WHERE id=NEW.patient_id AND organization_id=NEW.organization_id FOR UPDATE;
    IF assessment='DENIED' THEN RAISE EXCEPTION 'ALLERGY_DENIAL_CONFLICT' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER patient_active_allergy_guard BEFORE INSERT OR UPDATE ON inventory_patient_clinical_alerts FOR EACH ROW EXECUTE FUNCTION inventory_guard_active_allergy();
