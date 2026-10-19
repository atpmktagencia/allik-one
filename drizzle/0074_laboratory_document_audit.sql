-- Preserve originals and upload identity; intentional duplicates require immutable justification.
ALTER TABLE inventory_patient_document_events ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE inventory_patient_document_events ADD CONSTRAINT patient_document_event_metadata_object CHECK (jsonb_typeof(metadata)='object');
--> statement-breakpoint
CREATE INDEX patient_document_content_identity ON inventory_patient_documents(organization_id,patient_id,sha256);
--> statement-breakpoint
ALTER TABLE inventory_patient_prescriptions ADD COLUMN sha256 text;
--> statement-breakpoint
ALTER TABLE inventory_patient_prescriptions ADD CONSTRAINT patient_prescription_sha256_valid CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
-- document_id retains its original encounter-document foreign key. Other private originals
-- use a separate source identity, verified against the same tenant, patient and historical unit.
ALTER TABLE inventory_clinical_access_events ADD COLUMN source_kind text, ADD COLUMN source_id uuid;
--> statement-breakpoint
ALTER TABLE inventory_clinical_access_events DROP CONSTRAINT clinical_access_action_valid;
--> statement-breakpoint
ALTER TABLE inventory_clinical_access_events ADD CONSTRAINT clinical_access_action_valid CHECK (action IN ('READ','PRINT','PDF_SOURCE','SIGNED_DOWNLOAD','DOCUMENT_OPEN','DOCUMENT_DOWNLOAD'));
--> statement-breakpoint
ALTER TABLE inventory_clinical_access_events ADD CONSTRAINT clinical_access_source_valid CHECK (
 (source_kind IS NULL AND source_id IS NULL)
 OR (source_kind IS NOT NULL AND source_kind IN ('GENERAL_DOCUMENT','UPLOADED_PRESCRIPTION') AND source_id IS NOT NULL AND document_id IS NULL)
);
--> statement-breakpoint
CREATE FUNCTION inventory_guard_clinical_access_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.action IN ('DOCUMENT_OPEN','DOCUMENT_DOWNLOAD') AND NEW.source_id IS NULL THEN
  RAISE EXCEPTION 'Private document access requires source identity' USING ERRCODE='23514';
 END IF;
 IF NEW.source_kind='GENERAL_DOCUMENT' AND NOT EXISTS(
  SELECT 1 FROM inventory_patient_documents d WHERE d.id=NEW.source_id AND d.organization_id=NEW.organization_id AND d.patient_id=NEW.patient_id AND d.unit_id=NEW.unit_id
 ) THEN RAISE EXCEPTION 'General document access source mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.source_kind='UPLOADED_PRESCRIPTION' AND NOT EXISTS(
  SELECT 1 FROM inventory_patient_prescriptions d JOIN inventory_patient_treatments t ON t.id=d.treatment_id AND t.organization_id=d.organization_id AND t.patient_id=d.patient_id
  WHERE d.id=NEW.source_id AND d.organization_id=NEW.organization_id AND d.patient_id=NEW.patient_id AND t.unit_id=NEW.unit_id
 ) THEN RAISE EXCEPTION 'Uploaded prescription access source mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinical_access_event_source BEFORE INSERT ON inventory_clinical_access_events FOR EACH ROW EXECUTE FUNCTION inventory_guard_clinical_access_source();
--> statement-breakpoint
-- A verified identity is never silently replaced or backfilled. Legacy NULL remains explicit.
CREATE FUNCTION inventory_guard_prescription_original_hash() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.sha256 IS DISTINCT FROM OLD.sha256 THEN
  RAISE EXCEPTION 'Prescription original hash is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patient_prescription_original_hash_immutable BEFORE UPDATE ON inventory_patient_prescriptions FOR EACH ROW EXECUTE FUNCTION inventory_guard_prescription_original_hash();
