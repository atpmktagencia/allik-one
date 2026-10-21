-- F2 revised candidate. Tested only in disposable PostgreSQL; NOT authorized for Preview/production.
-- Outside the migration journal: no automatic build/deployment execution, no down migration.
CREATE FUNCTION inventory_classification_categories_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR jsonb_array_length(v) NOT BETWEEN 1 AND 7 THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}'<>ALL(ARRAY['LAB_RESULT','EXAM_REQUEST','IMAGE_REPORT','MEDICAL_PRESCRIPTION','MEDICAL_REPORT','MEDICAL_CERTIFICATE','OTHER']))
  AND jsonb_array_length(v)=(SELECT count(DISTINCT x) FROM jsonb_array_elements(v)x);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION inventory_classification_payload_valid(action text,p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item jsonb; evidence jsonb; result jsonb; categories jsonb;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN RETURN false; END IF;
 CASE action
 WHEN 'RECEIVED' THEN RETURN p-ARRAY['schemaVersion']='{}'::jsonb;
 WHEN 'STARTED' THEN RETURN p-ARRAY['schemaVersion','model']='{}'::jsonb AND jsonb_typeof(p->'model')='string' AND p->>'model' ~ '^[a-zA-Z0-9_./-]{1,120}$';
 WHEN 'FAILED' THEN RETURN p-ARRAY['schemaVersion','failureCode']='{}'::jsonb AND p->>'failureCode'=ANY(ARRAY['TIMEOUT','PROVIDER_FAILURE','SOURCE_UNAVAILABLE','AMBIGUOUS_RESPONSE']);
 WHEN 'RETRY_REQUESTED' THEN RETURN p-ARRAY['schemaVersion','reason']='{}'::jsonb AND jsonb_typeof(p->'reason')='string' AND char_length(trim(p->>'reason')) BETWEEN 10 AND 500;
 WHEN 'MANUAL_CLASSIFIED','CORRECTED','CONFIRMED' THEN
  IF NOT inventory_classification_categories_valid(p->'categories') OR p->'originalReviewed' IS DISTINCT FROM 'true'::jsonb OR p->'identityConfirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(p->'reason') IS DISTINCT FROM 'string' OR char_length(trim(p->>'reason')) NOT BETWEEN 10 AND 500 THEN RETURN false; END IF;
  IF action='CONFIRMED' THEN RETURN p-ARRAY['schemaVersion','categories','reason','originalReviewed','identityConfirmed','resultEventId']='{}'::jsonb AND (p->>'resultEventId')::uuid IS NOT NULL; END IF;
  RETURN p-ARRAY['schemaVersion','categories','reason','originalReviewed','identityConfirmed']='{}'::jsonb;
 WHEN 'SUGGESTED','NEEDS_REVIEW' THEN
  IF p-ARRAY['schemaVersion','result','evidenceStatus']<>'{}'::jsonb THEN RETURN false; END IF;
  IF action='SUGGESTED' AND p->>'evidenceStatus' IS DISTINCT FROM 'SUPPORTED' THEN RETURN false; END IF;
  IF action='NEEDS_REVIEW' AND NOT coalesce(p->>'evidenceStatus'=ANY(ARRAY['UNAVAILABLE','AMBIGUOUS','IDENTITY_MISMATCH']),false) THEN RETURN false; END IF;
  result=p->'result'; categories=result->'categories';
  IF jsonb_typeof(result) IS DISTINCT FROM 'object' OR result-ARRAY['categories','abstention']<>'{}'::jsonb OR jsonb_typeof(categories) IS DISTINCT FROM 'array' OR jsonb_array_length(categories)>7 OR NOT coalesce(result->>'abstention'=ANY(ARRAY['NONE','ILLEGIBLE','AMBIGUOUS','UNRECOGNIZED','INCOMPLETE']),false) THEN RETURN false; END IF;
  IF action='SUGGESTED' AND (result->>'abstention'<>'NONE' OR jsonb_array_length(categories)=0) THEN RETURN false; END IF;
  IF jsonb_array_length(categories)=0 AND result->>'abstention'='NONE' THEN RETURN false; END IF;
  IF (SELECT count(DISTINCT x->>'category') FROM jsonb_array_elements(categories)x)<>jsonb_array_length(categories) THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(categories) LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['category','evidence']<>'{}'::jsonb OR NOT inventory_classification_categories_valid(jsonb_build_array(item->'category')) OR jsonb_typeof(item->'evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'evidence') NOT BETWEEN 1 AND 20 THEN RETURN false; END IF;
   FOR evidence IN SELECT * FROM jsonb_array_elements(item->'evidence') LOOP
    IF jsonb_typeof(evidence) IS DISTINCT FROM 'object' OR evidence-ARRAY['page','quote']<>'{}'::jsonb OR jsonb_typeof(evidence->'page') IS DISTINCT FROM 'number' OR (evidence->>'page') !~ '^[0-9]+$' OR (evidence->>'page')::integer NOT BETWEEN 1 AND 100 OR jsonb_typeof(evidence->'quote') IS DISTINCT FROM 'string' OR char_length(trim(evidence->>'quote')) NOT BETWEEN 1 AND 600 THEN RETURN false; END IF;
   END LOOP;
  END LOOP;
  RETURN true;
 ELSE RETURN false;
 END CASE;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE inventory_patient_document_classification_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES inventory_patient_documents(id),
 organization_id uuid NOT NULL REFERENCES inventory_organizations(id),
 unit_id uuid NOT NULL REFERENCES inventory_units(id),
 patient_id uuid NOT NULL REFERENCES inventory_patients(id),
 source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
 classifier_version text NOT NULL CHECK (classifier_version='document-classifier-1'),
 revision integer NOT NULL CHECK (revision>0),
 operation_id uuid NOT NULL UNIQUE,
 actor_kind text NOT NULL CHECK (actor_kind IN ('SYSTEM','HUMAN')),
 actor_user_id uuid REFERENCES inventory_users(id),
 system_identity text,
 action text NOT NULL CHECK (action IN ('RECEIVED','STARTED','SUGGESTED','NEEDS_REVIEW','FAILED','CONFIRMED','MANUAL_CLASSIFIED','CORRECTED','RETRY_REQUESTED')),
 attempt_id uuid,
 payload jsonb NOT NULL CHECK (octet_length(payload::text)<=65536 AND coalesce(inventory_classification_payload_valid(action,payload),false)),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_id,revision),
 CHECK ((actor_kind='SYSTEM' AND actor_user_id IS NULL AND system_identity IS NOT DISTINCT FROM 'document-classifier' AND action IN ('RECEIVED','STARTED','SUGGESTED','NEEDS_REVIEW','FAILED')) OR (actor_kind='HUMAN' AND actor_user_id IS NOT NULL AND system_identity IS NULL AND action IN ('CONFIRMED','MANUAL_CLASSIFIED','CORRECTED','RETRY_REQUESTED'))),
 CHECK ((action IN ('STARTED','SUGGESTED','NEEDS_REVIEW','FAILED') AND attempt_id IS NOT NULL) OR (action NOT IN ('STARTED','SUGGESTED','NEEDS_REVIEW','FAILED') AND attempt_id IS NULL))
);
CREATE INDEX patient_document_classification_scope ON inventory_patient_document_classification_events(organization_id,patient_id,unit_id,document_id,revision DESC);
CREATE UNIQUE INDEX patient_document_classification_received_once ON inventory_patient_document_classification_events(document_id,classifier_version) WHERE action='RECEIVED';
CREATE UNIQUE INDEX patient_document_classification_attempt_once ON inventory_patient_document_classification_events(attempt_id) WHERE action='STARTED';
CREATE FUNCTION inventory_guard_document_classification() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE d inventory_patient_documents%ROWTYPE; previous inventory_patient_document_classification_events%ROWTYPE; current_unit uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('patient-document-classification:'||NEW.document_id::text,0));
 SELECT * INTO d FROM inventory_patient_documents WHERE id=NEW.document_id;
 IF d.id IS NULL OR (NEW.organization_id,NEW.patient_id,NEW.unit_id,NEW.source_sha256) IS DISTINCT FROM (d.organization_id,d.patient_id,d.unit_id,d.sha256) THEN RAISE EXCEPTION 'Classification original scope mismatch'; END IF;
 SELECT primary_unit_id INTO current_unit FROM inventory_patients WHERE id=d.patient_id AND organization_id=d.organization_id;
 IF NEW.actor_kind='HUMAN' AND NOT EXISTS(
  SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id JOIN inventory_organizations o ON o.id=m.organization_id JOIN inventory_units n ON n.id=d.unit_id AND n.organization_id=d.organization_id
  WHERE m.organization_id=d.organization_id AND m.user_id=NEW.actor_user_id AND m.active AND u.active AND o.active AND n.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','CLINICIAN') AND (m.role='SUPER_ADMIN' OR (EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=d.unit_id) AND EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=current_unit)))
 ) THEN RAISE EXCEPTION 'Classification author unauthorized'; END IF;
 SELECT * INTO previous FROM inventory_patient_document_classification_events WHERE document_id=d.id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>coalesce(previous.revision,0)+1 THEN RAISE EXCEPTION 'Classification revision stale'; END IF;
 IF previous.id IS NULL THEN
  IF NEW.action<>'RECEIVED' THEN RAISE EXCEPTION 'Classification must start at receipt'; END IF;
 ELSE
  IF NEW.classifier_version<>previous.classifier_version THEN RAISE EXCEPTION 'Classifier change requires separately approved reprocessing'; END IF;
  IF NOT (
   (previous.action IN ('RECEIVED','RETRY_REQUESTED') AND NEW.action='STARTED') OR
   (previous.action='STARTED' AND NEW.action IN ('SUGGESTED','NEEDS_REVIEW','FAILED')) OR
   (previous.action='SUGGESTED' AND NEW.action='CONFIRMED') OR
   (previous.action IN ('RECEIVED','STARTED','FAILED','NEEDS_REVIEW','SUGGESTED','RETRY_REQUESTED') AND NEW.action='MANUAL_CLASSIFIED') OR
   (previous.action IN ('SUGGESTED','NEEDS_REVIEW','CONFIRMED','MANUAL_CLASSIFIED','CORRECTED') AND NEW.action='CORRECTED') OR
   (previous.action='FAILED' AND NEW.action='RETRY_REQUESTED')
  ) THEN RAISE EXCEPTION 'Invalid classification transition'; END IF;
 END IF;
 IF NEW.action='STARTED' AND (SELECT count(*) FROM inventory_patient_document_classification_events WHERE document_id=d.id AND action='STARTED')>=2 THEN RAISE EXCEPTION 'Classification retry exhausted'; END IF;
 IF NEW.action IN ('SUGGESTED','NEEDS_REVIEW','FAILED') AND NEW.attempt_id IS DISTINCT FROM previous.attempt_id THEN RAISE EXCEPTION 'Classification response attempt mismatch'; END IF;
 IF NEW.action='CONFIRMED' AND (
  NEW.payload->>'resultEventId' IS DISTINCT FROM previous.id::text OR
  (SELECT jsonb_agg(x ORDER BY x::text) FROM jsonb_array_elements(NEW.payload->'categories')x) IS DISTINCT FROM
  (SELECT jsonb_agg(x->'category' ORDER BY (x->'category')::text) FROM jsonb_array_elements(previous.payload->'result'->'categories')x)
 ) THEN RAISE EXCEPTION 'Confirmation must match verifiable suggestion'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER patient_document_classification_guard BEFORE INSERT ON inventory_patient_document_classification_events FOR EACH ROW EXECUTE FUNCTION inventory_guard_document_classification();
CREATE TRIGGER patient_document_classification_immutable BEFORE UPDATE OR DELETE ON inventory_patient_document_classification_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
CREATE TRIGGER patient_document_classification_no_truncate BEFORE TRUNCATE ON inventory_patient_document_classification_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
-- SELECT/INSERT only via explicit restricted-role provisioning after approval.
-- No down migration. Rollback after first use retains this table, all events and guards.
