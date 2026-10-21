-- Authorized Preview-only smoke test. No provider calls, new originals or committed classifications.
-- Test INSERTs are contained in a subtransaction rolled back by the intentional ZX001 exception.
DO $$
DECLARE d inventory_patient_documents%ROWTYPE; attempt uuid=gen_random_uuid(); first_operation uuid=gen_random_uuid(); rejected boolean;
BEGIN
 IF current_user<>'allik_runtime' OR current_database()<>'neondb' OR current_setting('neon.branch_id',true) IS DISTINCT FROM 'br-winter-hill-b69uz195' OR current_setting('neon.endpoint_id',true) IS DISTINCT FROM 'ep-hidden-cloud-b6hskjjt' THEN RAISE EXCEPTION 'Synthetic Preview runtime required'; END IF;
 IF (SELECT count(*) FROM inventory_patient_document_classification_events)<>0 THEN RAISE EXCEPTION 'Expected unused F2 table; do not test over existing classifications'; END IF;
 SELECT doc.* INTO d FROM inventory_patient_documents doc WHERE doc.organization_id='a1100000-0000-4000-8000-000000000001' AND doc.patient_id='90319847-c7a6-4adc-a08a-47cf5e2aef21' AND doc.unit_id='a1100000-0000-4000-8000-000000000101' AND EXISTS(SELECT 1 FROM inventory_patient_document_events e WHERE e.document_id=doc.id AND e.action='UPLOADED' AND e.metadata->>'intent'='RECEIPT') ORDER BY doc.id LIMIT 1;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Known synthetic receipt missing'; END IF;
 BEGIN
  INSERT INTO inventory_patient_document_classification_events(document_id,organization_id,unit_id,patient_id,source_sha256,classifier_version,revision,operation_id,actor_kind,actor_user_id,system_identity,action,attempt_id,payload) VALUES(d.id,d.organization_id,d.unit_id,d.patient_id,d.sha256,'document-classifier-1',1,first_operation,'SYSTEM',NULL,'document-classifier','RECEIVED',NULL,'{"schemaVersion":1}'::jsonb);
  INSERT INTO inventory_patient_document_classification_events(document_id,organization_id,unit_id,patient_id,source_sha256,classifier_version,revision,operation_id,actor_kind,actor_user_id,system_identity,action,attempt_id,payload) VALUES(d.id,d.organization_id,d.unit_id,d.patient_id,d.sha256,'document-classifier-1',2,gen_random_uuid(),'SYSTEM',NULL,'document-classifier','STARTED',attempt,'{"schemaVersion":1,"model":"offline-schema-smoke-no-provider"}'::jsonb);
  rejected=false;
  BEGIN
   INSERT INTO inventory_patient_document_classification_events(document_id,organization_id,unit_id,patient_id,source_sha256,classifier_version,revision,operation_id,actor_kind,actor_user_id,system_identity,action,attempt_id,payload) VALUES(d.id,d.organization_id,d.unit_id,d.patient_id,d.sha256,'document-classifier-1',3,gen_random_uuid(),'HUMAN','f394c45e-cdf3-4355-b522-7d06437c3c5b'::uuid,NULL,'CONFIRMED',NULL,'{"schemaVersion":1,"categories":["EXAM_REQUEST"],"reason":"Teste sintético controlado da migration","originalReviewed":true,"identityConfirmed":true,"resultEventId":"00000000-0000-4000-8000-000000000001"}'::jsonb);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN rejected=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Smoke test failed: confirmation_without_result'; END IF;
  INSERT INTO inventory_patient_document_classification_events(document_id,organization_id,unit_id,patient_id,source_sha256,classifier_version,revision,operation_id,actor_kind,actor_user_id,system_identity,action,attempt_id,payload) VALUES(d.id,d.organization_id,d.unit_id,d.patient_id,d.sha256,'document-classifier-1',3,gen_random_uuid(),'HUMAN','f394c45e-cdf3-4355-b522-7d06437c3c5b'::uuid,NULL,'MANUAL_CLASSIFIED',NULL,'{"schemaVersion":1,"categories":["EXAM_REQUEST"],"reason":"Teste sintético controlado da migration","originalReviewed":true,"identityConfirmed":true}'::jsonb);
  rejected=false;
  BEGIN
   INSERT INTO inventory_patient_document_classification_events(document_id,organization_id,unit_id,patient_id,source_sha256,classifier_version,revision,operation_id,actor_kind,actor_user_id,system_identity,action,attempt_id,payload) VALUES(d.id,d.organization_id,d.unit_id,d.patient_id,d.sha256,'document-classifier-1',4,gen_random_uuid(),'SYSTEM',NULL,'document-classifier','SUGGESTED',attempt,'{"schemaVersion":1,"result":{"categories":[{"category":"EXAM_REQUEST","evidence":[{"page":1,"quote":"Evidência sintética de teste, sem inferência"}]}],"abstention":"NONE"},"evidenceStatus":"SUPPORTED"}'::jsonb);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN rejected=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Smoke test failed: late_response'; END IF;
  rejected=false;
  BEGIN
   INSERT INTO inventory_patient_document_classification_events(document_id,organization_id,unit_id,patient_id,source_sha256,classifier_version,revision,operation_id,actor_kind,actor_user_id,system_identity,action,attempt_id,payload) VALUES(d.id,gen_random_uuid(),d.unit_id,d.patient_id,d.sha256,'document-classifier-1',4,gen_random_uuid(),'HUMAN','f394c45e-cdf3-4355-b522-7d06437c3c5b'::uuid,NULL,'CORRECTED',NULL,'{"schemaVersion":1,"categories":["EXAM_REQUEST"],"reason":"Teste sintético controlado da migration","originalReviewed":true,"identityConfirmed":true}'::jsonb);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN rejected=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Smoke test failed: cross_organization'; END IF;
  rejected=false;
  BEGIN
   INSERT INTO inventory_patient_document_classification_events(document_id,organization_id,unit_id,patient_id,source_sha256,classifier_version,revision,operation_id,actor_kind,actor_user_id,system_identity,action,attempt_id,payload) VALUES(d.id,d.organization_id,d.unit_id,d.patient_id,d.sha256,'document-classifier-1',4,gen_random_uuid(),'HUMAN','f394c45e-cdf3-4355-b522-7d06437c3c5b'::uuid,NULL,'CORRECTED',NULL,'{"schemaVersion":1,"categories":["DIAGNOSIS"]}'::jsonb);
  EXCEPTION WHEN SQLSTATE '23514' THEN rejected=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Smoke test failed: invalid_payload'; END IF;
  rejected=false;
  BEGIN
   INSERT INTO inventory_patient_document_classification_events(document_id,organization_id,unit_id,patient_id,source_sha256,classifier_version,revision,operation_id,actor_kind,actor_user_id,system_identity,action,attempt_id,payload) VALUES(d.id,d.organization_id,d.unit_id,d.patient_id,d.sha256,'document-classifier-1',4,first_operation,'HUMAN','f394c45e-cdf3-4355-b522-7d06437c3c5b'::uuid,NULL,'CORRECTED',NULL,'{"schemaVersion":1,"categories":["EXAM_REQUEST"],"reason":"Teste sintético controlado da migration","originalReviewed":true,"identityConfirmed":true}'::jsonb);
  EXCEPTION WHEN SQLSTATE '23505' THEN rejected=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Smoke test failed: duplicate_operation'; END IF;
  IF (SELECT count(*) FROM inventory_patient_document_classification_events WHERE document_id=d.id)<>3 THEN RAISE EXCEPTION 'Unexpected committed test state'; END IF;
  IF EXISTS(SELECT 1 FROM inventory_patient_document_classification_events WHERE document_id=d.id AND actor_kind='SYSTEM' AND actor_user_id IS NOT NULL) THEN RAISE EXCEPTION 'Automatic authorship mismatch'; END IF;
  RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='Intentional rollback of synthetic smoke events';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
 END;
 IF (SELECT count(*) FROM inventory_patient_document_classification_events)<>0 THEN RAISE EXCEPTION 'Smoke events must not persist'; END IF;
END $$;
