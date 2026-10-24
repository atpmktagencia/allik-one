-- REVIEW CANDIDATE ONLY. Not in drizzle/journal, not applied anywhere.
-- Additive operational handoff; originals, imports, review versions and results are reused.
-- After approval: test on disposable PostgreSQL before any Preview application.
BEGIN;
CREATE TABLE inventory_laboratory_automation_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation_id uuid NOT NULL UNIQUE,
 document_id uuid NOT NULL REFERENCES inventory_patient_documents(id),
 organization_id uuid NOT NULL REFERENCES inventory_organizations(id),
 patient_id uuid NOT NULL REFERENCES inventory_patients(id),
 unit_id uuid NOT NULL REFERENCES inventory_units(id),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 receipt_event_id uuid NOT NULL REFERENCES inventory_patient_document_classification_events(id),
 initiated_by_user_id uuid NOT NULL REFERENCES inventory_users(id),
 pipeline_version text NOT NULL CHECK(pipeline_version='laboratory-automation-1'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_id,pipeline_version)
);
CREATE TABLE inventory_laboratory_automation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES inventory_laboratory_automation_requests(id),
 operation_id uuid NOT NULL UNIQUE,
 revision integer NOT NULL CHECK(revision>0),
 action text NOT NULL CHECK(action IN ('STARTED','READY','FAILED','CANCELLED','RETRY_REQUESTED')),
 classification_event_id uuid REFERENCES inventory_patient_document_classification_events(id),
 attempt_id uuid,
 actor_kind text NOT NULL CHECK(actor_kind IN ('SYSTEM','HUMAN')),
 actor_user_id uuid REFERENCES inventory_users(id),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(request_id,revision),
 CHECK(jsonb_typeof(payload)='object' AND payload->'schemaVersion' IS NOT DISTINCT FROM '1'::jsonb AND pg_column_size(payload)<=8192),
 CHECK((actor_kind='SYSTEM' AND actor_user_id IS NULL AND action IN ('STARTED','READY','FAILED','CANCELLED')) OR
       (actor_kind='HUMAN' AND actor_user_id IS NOT NULL AND action IN ('RETRY_REQUESTED','CANCELLED'))),
 CHECK((action IN ('STARTED','READY','FAILED') AND attempt_id IS NOT NULL AND classification_event_id IS NOT NULL) OR
       (action IN ('CANCELLED','RETRY_REQUESTED') AND attempt_id IS NULL AND classification_event_id IS NULL))
);
CREATE UNIQUE INDEX laboratory_automation_attempt_once ON inventory_laboratory_automation_events(attempt_id) WHERE action='STARTED';
CREATE INDEX laboratory_automation_scope ON inventory_laboratory_automation_requests(organization_id,patient_id,unit_id,created_at);
CREATE INDEX laboratory_automation_latest ON inventory_laboratory_automation_events(request_id,revision DESC);

CREATE FUNCTION inventory_laboratory_automation_authorized(actor uuid,org uuid,doc_unit uuid,patient_unit uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id
 JOIN inventory_organizations o ON o.id=m.organization_id
 JOIN inventory_units n ON n.id=doc_unit AND n.organization_id=org
 JOIN inventory_units n2 ON n2.id=patient_unit AND n2.organization_id=org
 WHERE m.user_id=actor AND m.organization_id=org AND m.active AND u.active AND o.active AND n.active AND n2.active
 AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','CLINICIAN') AND (m.role='SUPER_ADMIN' OR
 (EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=doc_unit) AND
  EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=patient_unit))))
$$;
CREATE FUNCTION inventory_guard_laboratory_automation_request() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE d inventory_patient_documents%ROWTYPE; r inventory_patient_document_classification_events%ROWTYPE; pu uuid;
BEGIN
 SELECT * INTO d FROM inventory_patient_documents WHERE id=NEW.document_id;
 SELECT * INTO r FROM inventory_patient_document_classification_events WHERE id=NEW.receipt_event_id;
 SELECT primary_unit_id INTO pu FROM inventory_patients WHERE id=d.patient_id AND organization_id=d.organization_id AND active;
 IF d.id IS NULL OR pu IS NULL OR d.unit_id IS DISTINCT FROM pu OR (NEW.organization_id,NEW.patient_id,NEW.unit_id,NEW.source_sha256)
 IS DISTINCT FROM (d.organization_id,d.patient_id,d.unit_id,d.sha256) OR d.content_type<>'application/pdf' THEN
 RAISE EXCEPTION 'Automation original scope mismatch'; END IF;
 -- Enrollment must commit WITH the new original/receipt: no historical scan or time-window backfill.
 IF d.created_at IS DISTINCT FROM transaction_timestamp() OR NEW.created_at IS DISTINCT FROM transaction_timestamp()
 OR r.created_at IS DISTINCT FROM transaction_timestamp() OR r.document_id IS DISTINCT FROM d.id
 OR r.organization_id IS DISTINCT FROM d.organization_id OR r.patient_id IS DISTINCT FROM d.patient_id
 OR r.unit_id IS DISTINCT FROM d.unit_id OR r.source_sha256 IS DISTINCT FROM d.sha256 OR r.action IS DISTINCT FROM 'RECEIVED' THEN
 RAISE EXCEPTION 'Automation requires a new receipt in the same transaction'; END IF;
 IF NEW.initiated_by_user_id IS DISTINCT FROM d.uploaded_by_user_id OR NOT inventory_laboratory_automation_authorized(NEW.initiated_by_user_id,d.organization_id,d.unit_id,pu) THEN
 RAISE EXCEPTION 'Automation initiator unauthorized'; END IF;
 IF EXISTS(SELECT 1 FROM inventory_laboratory_imports i WHERE i.document_id=d.id) THEN
 RAISE EXCEPTION 'Existing import cannot be enrolled automatically'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION inventory_guard_laboratory_automation_event() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE q inventory_laboratory_automation_requests%ROWTYPE; previous inventory_laboratory_automation_events%ROWTYPE;
 c inventory_patient_document_classification_events%ROWTYPE; j inventory_laboratory_imports%ROWTYPE;
 pu uuid; prior text; attempts integer; pages integer[]; count_pages integer;
BEGIN
 SELECT * INTO q FROM inventory_laboratory_automation_requests WHERE id=NEW.request_id;
 IF q.id IS NULL THEN RAISE EXCEPTION 'Unknown automation request'; END IF;
 -- Same lock order as F2; a concurrent human correction cannot race a completion commit.
 PERFORM pg_advisory_xact_lock(hashtextextended('patient-document-classification:'||q.document_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('laboratory-automation:'||q.id::text,0));
 SELECT * INTO previous FROM inventory_laboratory_automation_events WHERE request_id=q.id ORDER BY revision DESC LIMIT 1;
 prior:=coalesce(previous.action,'ENROLLED');
 IF NEW.created_at IS DISTINCT FROM transaction_timestamp() THEN RAISE EXCEPTION 'Automation event timestamp must be current'; END IF;
 IF NEW.revision<>coalesce(previous.revision,0)+1 OR NOT (
 (prior IN ('ENROLLED','RETRY_REQUESTED') AND NEW.action='STARTED') OR
 (prior='STARTED' AND NEW.action IN ('READY','FAILED')) OR
 (prior='FAILED' AND NEW.action='RETRY_REQUESTED') OR
 (prior IN ('ENROLLED','STARTED','READY','FAILED','RETRY_REQUESTED') AND NEW.action='CANCELLED')) THEN
 RAISE EXCEPTION 'Automation stale revision or invalid transition'; END IF;
 SELECT primary_unit_id INTO pu FROM inventory_patients WHERE id=q.patient_id AND organization_id=q.organization_id AND active;
 IF NEW.actor_kind='HUMAN' AND NOT inventory_laboratory_automation_authorized(NEW.actor_user_id,q.organization_id,q.unit_id,pu) THEN
 RAISE EXCEPTION 'Automation decision unauthorized'; END IF;
 IF NEW.action<>'CANCELLED' AND (pu IS NULL OR q.unit_id IS DISTINCT FROM pu OR NOT inventory_laboratory_automation_authorized(q.initiated_by_user_id,q.organization_id,q.unit_id,pu)) THEN
 RAISE EXCEPTION 'Automation delegated access revoked'; END IF;
 SELECT count(*) INTO attempts FROM inventory_laboratory_automation_events WHERE request_id=q.id AND action='STARTED';
 IF NEW.action IN ('STARTED','RETRY_REQUESTED') AND attempts>=2 THEN RAISE EXCEPTION 'Automation attempts exhausted'; END IF;
 IF NEW.action IN ('CANCELLED','RETRY_REQUESTED') THEN
  IF NEW.payload-ARRAY['schemaVersion','reason']<>'{}'::jsonb OR jsonb_typeof(NEW.payload->'reason') IS DISTINCT FROM 'string'
   OR char_length(trim(NEW.payload->>'reason')) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Automation reason required'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO c FROM inventory_patient_document_classification_events WHERE document_id=q.document_id ORDER BY revision DESC LIMIT 1;
 IF c.id IS DISTINCT FROM NEW.classification_event_id OR c.organization_id IS DISTINCT FROM q.organization_id
 OR c.patient_id IS DISTINCT FROM q.patient_id OR c.unit_id IS DISTINCT FROM q.unit_id OR c.source_sha256 IS DISTINCT FROM q.source_sha256
 OR c.action IS DISTINCT FROM 'SUGGESTED' OR c.payload->>'evidenceStatus' IS DISTINCT FROM 'SUPPORTED'
 OR c.payload#>>'{result,abstention}' IS DISTINCT FROM 'NONE'
 OR jsonb_array_length(c.payload#>'{result,categories}')<>1
 OR c.payload#>>'{result,categories,0,category}' IS DISTINCT FROM 'LAB_RESULT' THEN
 RAISE EXCEPTION 'Automation classification changed or unsupported'; END IF;
 IF NEW.action='STARTED' THEN
  SELECT * INTO j FROM inventory_laboratory_imports WHERE document_id=q.document_id FOR UPDATE;
  IF j.id IS NOT NULL AND (prior<>'RETRY_REQUESTED' OR j.status<>'FAILED' OR j.latest_review_id IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM inventory_laboratory_automation_events e WHERE e.request_id=q.id AND e.action='STARTED' AND e.attempt_id=j.attempt_id)) THEN
   RAISE EXCEPTION 'Manual or unrelated import already exists'; END IF;
  IF NEW.payload-ARRAY['schemaVersion','model','pages','independentTotalPages']<>'{}'::jsonb
  OR jsonb_typeof(NEW.payload->'model') IS DISTINCT FROM 'string'
  OR coalesce(NEW.payload->>'model','') !~ '^[a-zA-Z0-9_./-]{1,120}$'
  OR jsonb_typeof(NEW.payload->'pages') IS DISTINCT FROM 'array'
  OR jsonb_typeof(NEW.payload->'independentTotalPages') IS DISTINCT FROM 'number'
  OR coalesce(NEW.payload->>'independentTotalPages','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Invalid automation start payload'; END IF;
  count_pages:=(NEW.payload->>'independentTotalPages')::integer;
  IF count_pages NOT BETWEEN 1 AND 20 OR jsonb_array_length(NEW.payload->'pages')<>count_pages THEN RAISE EXCEPTION 'Invalid independent page scope'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.payload->'pages') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'number' OR x::text !~ '^[0-9]+$') THEN RAISE EXCEPTION 'Automation pages require integer JSON numbers'; END IF;
  SELECT array_agg(x::integer ORDER BY x::integer) INTO pages FROM jsonb_array_elements_text(NEW.payload->'pages') x;
  IF pages IS DISTINCT FROM ARRAY(SELECT generate_series(1,count_pages)) OR pages IS DISTINCT FROM
   ARRAY(SELECT DISTINCT (x->>'page')::integer FROM jsonb_array_elements(c.payload#>'{result,categories,0,evidence}') x ORDER BY 1) THEN
   RAISE EXCEPTION 'Automation page scope differs from classification'; END IF;
 ELSIF NEW.action='READY' THEN
  IF NEW.payload-ARRAY['schemaVersion','importId']<>'{}'::jsonb OR jsonb_typeof(NEW.payload->'importId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid automation ready payload'; END IF;
  SELECT * INTO j FROM inventory_laboratory_imports WHERE id=(NEW.payload->>'importId')::uuid FOR UPDATE;
  IF j.id IS NULL OR (j.organization_id,j.patient_id,j.unit_id,j.document_id,j.source_sha256)
   IS DISTINCT FROM (q.organization_id,q.patient_id,q.unit_id,q.document_id,q.source_sha256)
   OR j.status<>'READY_REVIEW' OR j.latest_review_id IS NOT NULL OR j.attempt_id IS DISTINCT FROM NEW.attempt_id THEN
   RAISE EXCEPTION 'Automation completion requires the same unconfirmed draft'; END IF;
 ELSIF NEW.action='FAILED' THEN
  IF NEW.payload-ARRAY['schemaVersion','failureCode']<>'{}'::jsonb OR NOT coalesce(NEW.payload->>'failureCode'=ANY(
   ARRAY['TIMEOUT','PROVIDER_FAILURE','SOURCE_UNAVAILABLE','SOURCE_INTEGRITY','BUDGET_STOP']),false) THEN RAISE EXCEPTION 'Invalid automation failure payload'; END IF;
 END IF;
 IF NEW.action IN ('READY','FAILED') AND (NEW.attempt_id IS DISTINCT FROM previous.attempt_id OR NEW.classification_event_id IS DISTINCT FROM previous.classification_event_id) THEN
 RAISE EXCEPTION 'Automation late response rejected'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER laboratory_automation_request_guard BEFORE INSERT ON inventory_laboratory_automation_requests FOR EACH ROW EXECUTE FUNCTION inventory_guard_laboratory_automation_request();
CREATE TRIGGER laboratory_automation_event_guard BEFORE INSERT ON inventory_laboratory_automation_events FOR EACH ROW EXECUTE FUNCTION inventory_guard_laboratory_automation_event();
CREATE TRIGGER laboratory_automation_request_immutable BEFORE UPDATE OR DELETE ON inventory_laboratory_automation_requests FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
CREATE TRIGGER laboratory_automation_event_immutable BEFORE UPDATE OR DELETE ON inventory_laboratory_automation_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
CREATE TRIGGER laboratory_automation_request_no_truncate BEFORE TRUNCATE ON inventory_laboratory_automation_requests FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
CREATE TRIGGER laboratory_automation_event_no_truncate BEFORE TRUNCATE ON inventory_laboratory_automation_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
REVOKE ALL ON inventory_laboratory_automation_requests,inventory_laboratory_automation_events FROM PUBLIC;
-- Restricted runtime provisioning only after schema review/testing and explicit Preview approval.
REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON inventory_laboratory_automation_requests,inventory_laboratory_automation_events FROM allik_runtime;
GRANT SELECT,INSERT ON inventory_laboratory_automation_requests,inventory_laboratory_automation_events TO allik_runtime;
COMMIT;
-- NO destructive down SQL. Operational rollback: disable F3 dispatch, retain both tables,
-- events, imports and existing guards. No DELETE/TRUNCATE/DROP or automatic data backfill.
