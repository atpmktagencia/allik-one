-- PROPOSAL ONLY: outside drizzle/, absent from migration journal. Do not execute yet.
-- One append-only classification stream; the original and UPLOADED event stay untouched.
CREATE TABLE inventory_patient_document_classification_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES inventory_patient_documents(id),
 organization_id uuid NOT NULL REFERENCES inventory_organizations(id),
 unit_id uuid NOT NULL REFERENCES inventory_units(id),
 patient_id uuid NOT NULL REFERENCES inventory_patients(id),
 source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
 classifier_version text NOT NULL CHECK (char_length(classifier_version) BETWEEN 1 AND 80),
 revision integer NOT NULL CHECK (revision > 0),
 actor_user_id uuid NOT NULL REFERENCES inventory_users(id),
 action text NOT NULL CHECK (action IN ('RECEIVED','STARTED','SUGGESTED','NEEDS_REVIEW','FAILED','CONFIRMED','CORRECTED','RETRY_REQUESTED')),
 attempt_id uuid,
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_id, revision)
);
CREATE INDEX patient_document_classification_scope
 ON inventory_patient_document_classification_events(organization_id,patient_id,unit_id,document_id,revision DESC);
CREATE UNIQUE INDEX patient_document_classification_received_once
 ON inventory_patient_document_classification_events(document_id,classifier_version) WHERE action='RECEIVED';
CREATE UNIQUE INDEX patient_document_classification_attempt_once
 ON inventory_patient_document_classification_events(attempt_id) WHERE action='STARTED';

CREATE FUNCTION inventory_guard_document_classification() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE d inventory_patient_documents%ROWTYPE;
 previous inventory_patient_document_classification_events%ROWTYPE;
 current_unit uuid;
BEGIN
 -- Serialize the stream, including two first-event transactions.
 SELECT * INTO d FROM inventory_patient_documents WHERE id=NEW.document_id FOR UPDATE;
 IF d.id IS NULL OR (NEW.organization_id,NEW.patient_id,NEW.unit_id,NEW.source_sha256)
  IS DISTINCT FROM (d.organization_id,d.patient_id,d.unit_id,d.sha256) THEN
  RAISE EXCEPTION 'Classification original scope mismatch';
 END IF;
 SELECT primary_unit_id INTO current_unit FROM inventory_patients
  WHERE id=d.patient_id AND organization_id=d.organization_id;
 IF NOT EXISTS (
  SELECT 1 FROM inventory_memberships m
  JOIN inventory_users u ON u.id=m.user_id
  JOIN inventory_organizations o ON o.id=m.organization_id
  JOIN inventory_units n ON n.id=d.unit_id AND n.organization_id=d.organization_id
  WHERE m.organization_id=d.organization_id AND m.user_id=NEW.actor_user_id
  AND m.active AND u.active AND o.active AND n.active
  AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','CLINICIAN')
  AND (m.role='SUPER_ADMIN' OR (
   EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=d.unit_id)
   AND EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=current_unit)
  ))
 ) THEN RAISE EXCEPTION 'Classification author unauthorized'; END IF;
 SELECT * INTO previous FROM inventory_patient_document_classification_events
  WHERE document_id=d.id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>coalesce(previous.revision,0)+1 THEN
  RAISE EXCEPTION 'Classification revision stale';
 END IF;
 IF previous.id IS NULL THEN
  IF NEW.action<>'RECEIVED' OR NEW.attempt_id IS NOT NULL THEN
   RAISE EXCEPTION 'Classification must start at receipt';
  END IF;
 ELSE
  IF NEW.classifier_version<>previous.classifier_version THEN
   RAISE EXCEPTION 'Classifier change requires separately approved reprocessing';
  END IF;
  IF NOT (
   (previous.action IN ('RECEIVED','RETRY_REQUESTED') AND NEW.action='STARTED') OR
   (previous.action='STARTED' AND NEW.action IN ('SUGGESTED','NEEDS_REVIEW','FAILED')) OR
   (previous.action IN ('RECEIVED','STARTED','SUGGESTED','NEEDS_REVIEW','FAILED','CONFIRMED','CORRECTED')
    AND NEW.action IN ('CONFIRMED','CORRECTED')) OR
   (previous.action='FAILED' AND NEW.action='RETRY_REQUESTED')
  ) THEN RAISE EXCEPTION 'Invalid classification transition'; END IF;
 END IF;
 IF NEW.action='STARTED' AND (NEW.attempt_id IS NULL OR
  (SELECT count(*) FROM inventory_patient_document_classification_events WHERE document_id=d.id AND action='STARTED')>=2)
 THEN RAISE EXCEPTION 'Classification attempt invalid or retry exhausted'; END IF;
 IF NEW.action IN ('SUGGESTED','NEEDS_REVIEW','FAILED')
  AND NEW.attempt_id IS DISTINCT FROM previous.attempt_id
 THEN RAISE EXCEPTION 'Classification response attempt mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER patient_document_classification_guard BEFORE INSERT
 ON inventory_patient_document_classification_events FOR EACH ROW
 EXECUTE FUNCTION inventory_guard_document_classification();
CREATE TRIGGER patient_document_classification_immutable BEFORE UPDATE OR DELETE
 ON inventory_patient_document_classification_events FOR EACH ROW
 EXECUTE FUNCTION inventory_reject_history_change();
CREATE TRIGGER patient_document_classification_no_truncate BEFORE TRUNCATE
 ON inventory_patient_document_classification_events FOR EACH STATEMENT
 EXECUTE FUNCTION inventory_reject_history_change();
-- Runtime SELECT/INSERT grants must be provisioned explicitly using existing restricted-role tooling.
-- No UPDATE, DELETE, TRUNCATE grant; no changes to original tables, no backfill.
