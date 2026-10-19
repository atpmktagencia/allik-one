ALTER TABLE inventory_clinical_plans ADD COLUMN appointment_id uuid REFERENCES inventory_care_appointments(id);
--> statement-breakpoint
CREATE INDEX clinical_plans_encounter ON inventory_clinical_plans(organization_id,appointment_id);
--> statement-breakpoint
CREATE FUNCTION inventory_guard_plan_encounter() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a inventory_care_appointments%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND OLD.appointment_id IS NOT NULL AND NEW.appointment_id IS DISTINCT FROM OLD.appointment_id THEN
  RAISE EXCEPTION 'Clinical plan encounter binding is immutable';
 END IF;
 IF NEW.appointment_id IS NOT NULL THEN
  SELECT * INTO a FROM inventory_care_appointments WHERE id=NEW.appointment_id FOR UPDATE;
  IF a.id IS NULL OR a.organization_id<>NEW.organization_id OR a.patient_id<>NEW.patient_id OR a.unit_id<>NEW.unit_id OR a.status IN ('COMPLETED','CANCELED','NO_SHOW') THEN
   RAISE EXCEPTION 'Clinical plan requires matching editable encounter';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinical_plan_encounter_validate BEFORE INSERT OR UPDATE ON inventory_clinical_plans FOR EACH ROW EXECUTE FUNCTION inventory_guard_plan_encounter();
--> statement-breakpoint
CREATE TABLE inventory_clinical_request_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES inventory_organizations(id),
 unit_id uuid NOT NULL REFERENCES inventory_units(id),
 patient_id uuid NOT NULL REFERENCES inventory_patients(id),
 appointment_id uuid NOT NULL REFERENCES inventory_care_appointments(id),
 source_kind text NOT NULL CHECK(source_kind IN ('DOCUMENT','PLAN')),
 source_id uuid NOT NULL,
 source_version integer NOT NULL CHECK(source_version>=0),
 version integer NOT NULL CHECK(version>0),
 status text NOT NULL CHECK(status IN ('ISSUED','RETURNED','REVIEWED')),
 actor_user_id uuid NOT NULL REFERENCES inventory_users(id),
 operation_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 note text NOT NULL DEFAULT '' CHECK(char_length(note)<=1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,operation_id),
 UNIQUE(organization_id,source_kind,source_id,version)
);
--> statement-breakpoint
CREATE INDEX clinical_request_encounter ON inventory_clinical_request_events(organization_id,appointment_id,created_at);
--> statement-breakpoint
CREATE FUNCTION inventory_validate_clinical_request_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a inventory_care_appointments%ROWTYPE; prior inventory_clinical_request_events%ROWTYPE; source_ok boolean;
BEGIN
 SELECT * INTO a FROM inventory_care_appointments WHERE id=NEW.appointment_id;
 IF a.id IS NULL OR a.organization_id<>NEW.organization_id OR a.unit_id<>NEW.unit_id OR a.patient_id<>NEW.patient_id OR a.status IN ('CANCELED','NO_SHOW') OR a.professional_user_id IS DISTINCT FROM NEW.actor_user_id OR inventory_professional_registration_state(NEW.actor_user_id,NEW.organization_id) IS DISTINCT FROM 'OK' THEN RAISE EXCEPTION 'Invalid clinical request encounter scope'; END IF;
 IF NEW.source_kind='DOCUMENT' THEN
  SELECT EXISTS(SELECT 1 FROM inventory_encounter_documents d WHERE d.id=NEW.source_id AND d.organization_id=NEW.organization_id AND d.unit_id=NEW.unit_id AND d.patient_id=NEW.patient_id AND d.appointment_id=NEW.appointment_id AND d.status='FINAL' AND d.type IN ('EXAM_REQUEST','REFERRAL') AND d.version=NEW.source_version AND NOT EXISTS (SELECT 1 FROM inventory_clinical_document_amendments am JOIN inventory_encounter_documents replacement ON replacement.id=am.document_id WHERE am.parent_document_id=d.id AND am.kind='RECTIFICATION' AND replacement.status='FINAL')) INTO source_ok;
 ELSE
  SELECT EXISTS(SELECT 1 FROM inventory_clinical_plans p WHERE p.id=NEW.source_id AND p.organization_id=NEW.organization_id AND p.unit_id=NEW.unit_id AND p.patient_id=NEW.patient_id AND p.appointment_id=NEW.appointment_id AND p.status='ACTIVE' AND p.version=NEW.source_version) INTO source_ok;
 END IF;
 IF NOT source_ok THEN RAISE EXCEPTION 'Clinical request source must be current and finalized or active'; END IF;
 IF NOT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id JOIN inventory_patients p ON p.id=NEW.patient_id AND p.organization_id=m.organization_id WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.actor_user_id AND m.active AND u.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','CLINICIAN') AND (m.role='SUPER_ADMIN' OR (EXISTS(SELECT 1 FROM inventory_unit_access ua WHERE ua.membership_id=m.id AND ua.unit_id=NEW.unit_id) AND EXISTS(SELECT 1 FROM inventory_unit_access ua WHERE ua.membership_id=m.id AND ua.unit_id=p.primary_unit_id)))) THEN RAISE EXCEPTION 'Clinical request requires authorized clinical actor'; END IF;
 SELECT * INTO prior FROM inventory_clinical_request_events WHERE organization_id=NEW.organization_id AND source_kind=NEW.source_kind AND source_id=NEW.source_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>coalesce(prior.version,0)+1 OR NOT coalesce(
   (NEW.status='ISSUED' AND (prior.id IS NULL OR prior.source_version<>NEW.source_version))
   OR (prior.source_version=NEW.source_version AND
       ((prior.status='ISSUED' AND NEW.status='RETURNED') OR
        (prior.status='RETURNED' AND NEW.status='REVIEWED'))),
   false
 ) THEN RAISE EXCEPTION 'Invalid clinical request transition'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinical_request_event_validate BEFORE INSERT ON inventory_clinical_request_events FOR EACH ROW EXECUTE FUNCTION inventory_validate_clinical_request_event();
--> statement-breakpoint
CREATE TRIGGER clinical_request_event_immutable BEFORE UPDATE OR DELETE ON inventory_clinical_request_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER clinical_request_event_no_truncate BEFORE TRUNCATE ON inventory_clinical_request_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
