CREATE TABLE "inventory_laboratory_import_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_laboratory_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"source_sha256" text NOT NULL,
	"status" text DEFAULT 'WAITING' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"draft" jsonb NOT NULL,
	"attempt_id" uuid,
	"processing_started_at" timestamp with time zone,
	"failure_code" text,
	"model" text,
	"latest_review_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_laboratory_imports_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_laboratory_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_laboratory_review_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"source_sha256" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reviewed_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_laboratory_import_events" ADD CONSTRAINT "inventory_laboratory_import_events_import_id_inventory_laboratory_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."inventory_laboratory_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_import_events" ADD CONSTRAINT "inventory_laboratory_import_events_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_import_events" ADD CONSTRAINT "inventory_laboratory_import_events_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_import_events" ADD CONSTRAINT "inventory_laboratory_import_events_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_import_events" ADD CONSTRAINT "inventory_laboratory_import_events_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_imports" ADD CONSTRAINT "inventory_laboratory_imports_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_imports" ADD CONSTRAINT "inventory_laboratory_imports_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_imports" ADD CONSTRAINT "inventory_laboratory_imports_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_imports" ADD CONSTRAINT "inventory_laboratory_imports_document_id_inventory_patient_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."inventory_patient_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_imports" ADD CONSTRAINT "inventory_laboratory_imports_created_by_user_id_inventory_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_imports" ADD CONSTRAINT "inventory_laboratory_imports_updated_by_user_id_inventory_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_results" ADD CONSTRAINT "inventory_laboratory_results_review_id_inventory_laboratory_review_versions_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."inventory_laboratory_review_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_results" ADD CONSTRAINT "inventory_laboratory_results_import_id_inventory_laboratory_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."inventory_laboratory_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_results" ADD CONSTRAINT "inventory_laboratory_results_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_results" ADD CONSTRAINT "inventory_laboratory_results_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_results" ADD CONSTRAINT "inventory_laboratory_results_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_review_versions" ADD CONSTRAINT "inventory_laboratory_review_versions_import_id_inventory_laboratory_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."inventory_laboratory_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_review_versions" ADD CONSTRAINT "inventory_laboratory_review_versions_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_review_versions" ADD CONSTRAINT "inventory_laboratory_review_versions_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_review_versions" ADD CONSTRAINT "inventory_laboratory_review_versions_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_laboratory_review_versions" ADD CONSTRAINT "inventory_laboratory_review_versions_reviewed_by_user_id_inventory_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "laboratory_event_import" ON "inventory_laboratory_import_events" USING btree ("import_id","created_at");--> statement-breakpoint
CREATE INDEX "laboratory_import_patient" ON "inventory_laboratory_imports" USING btree ("organization_id","patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "laboratory_result_ordinal" ON "inventory_laboratory_results" USING btree ("review_id","ordinal");--> statement-breakpoint
CREATE INDEX "laboratory_result_patient" ON "inventory_laboratory_results" USING btree ("organization_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "laboratory_review_version" ON "inventory_laboratory_review_versions" USING btree ("import_id","version");
--> statement-breakpoint
ALTER TABLE inventory_laboratory_imports ADD COLUMN extracted_payload jsonb;
--> statement-breakpoint
CREATE FUNCTION inventory_validate_laboratory_record() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j inventory_laboratory_imports%ROWTYPE; r inventory_laboratory_review_versions%ROWTYPE; actor uuid; current_unit uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Laboratory history cannot be deleted'; END IF;
 IF TG_TABLE_NAME='inventory_laboratory_imports' THEN
  SELECT primary_unit_id INTO current_unit FROM inventory_patients WHERE id=NEW.patient_id AND organization_id=NEW.organization_id;
  IF NOT EXISTS(SELECT 1 FROM inventory_patient_documents d WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.patient_id=NEW.patient_id AND d.unit_id=NEW.unit_id AND d.sha256=NEW.source_sha256 AND d.content_type='application/pdf') THEN RAISE EXCEPTION 'Laboratory PDF scope or hash mismatch'; END IF;
  actor:=NEW.updated_by_user_id;
  IF NEW.status NOT IN ('WAITING','PROCESSING','READY_REVIEW','VALIDATED','FAILED') OR NEW.version<0 OR jsonb_typeof(NEW.draft) IS DISTINCT FROM 'object' OR pg_column_size(NEW.draft)>524288 THEN RAISE EXCEPTION 'Invalid laboratory import'; END IF;
  IF TG_OP='INSERT' THEN
   IF NEW.unit_id IS DISTINCT FROM current_unit OR NEW.version<>0 OR NEW.status<>'WAITING' OR NEW.created_by_user_id<>actor OR NEW.latest_review_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid laboratory creation'; END IF;
  ELSE
   IF (NEW.id,NEW.organization_id,NEW.unit_id,NEW.patient_id,NEW.document_id,NEW.source_sha256,NEW.created_by_user_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.unit_id,OLD.patient_id,OLD.document_id,OLD.source_sha256,OLD.created_by_user_id,OLD.created_at) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Laboratory origin immutable or stale version'; END IF;
   IF OLD.extracted_payload IS NOT NULL AND NEW.extracted_payload IS DISTINCT FROM OLD.extracted_payload THEN RAISE EXCEPTION 'Raw extraction is immutable'; END IF;
   IF OLD.extracted_payload IS NULL AND NEW.extracted_payload IS NOT NULL AND NOT(OLD.status='PROCESSING' AND NEW.status='READY_REVIEW') THEN RAISE EXCEPTION 'Raw extraction requires successful processing'; END IF;
   IF NOT ((OLD.status IN ('WAITING','FAILED') AND NEW.status IN ('PROCESSING','READY_REVIEW')) OR (OLD.status='PROCESSING' AND NEW.status IN ('PROCESSING','READY_REVIEW','FAILED')) OR (OLD.status='READY_REVIEW' AND NEW.status IN ('READY_REVIEW','VALIDATED')) OR (OLD.status='VALIDATED' AND NEW.status='READY_REVIEW')) THEN RAISE EXCEPTION 'Invalid laboratory transition'; END IF;
   IF NEW.status='VALIDATED' AND (NEW.latest_review_id IS NOT DISTINCT FROM OLD.latest_review_id OR NOT EXISTS(SELECT 1 FROM inventory_laboratory_review_versions v WHERE v.id=NEW.latest_review_id AND v.import_id=NEW.id AND v.source_sha256=NEW.source_sha256 AND v.snapshot=NEW.draft)) THEN RAISE EXCEPTION 'Validation requires a new matching immutable review'; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id JOIN inventory_organizations o ON o.id=m.organization_id WHERE m.organization_id=NEW.organization_id AND m.user_id=actor AND m.active AND u.active AND o.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','CLINICIAN') AND (m.role='SUPER_ADMIN' OR (EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=NEW.unit_id) AND EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=current_unit)))) THEN RAISE EXCEPTION 'Unauthorized laboratory author'; END IF;
 ELSE
  SELECT * INTO j FROM inventory_laboratory_imports WHERE id=NEW.import_id;
  IF j.id IS NULL OR (NEW.organization_id,NEW.unit_id,NEW.patient_id) IS DISTINCT FROM (j.organization_id,j.unit_id,j.patient_id) THEN RAISE EXCEPTION 'Laboratory history scope mismatch'; END IF;
  IF TG_TABLE_NAME='inventory_laboratory_review_versions' THEN
   IF NOT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE m.organization_id=j.organization_id AND m.user_id=NEW.reviewed_by_user_id AND m.active AND u.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','CLINICIAN')) THEN RAISE EXCEPTION 'Unauthorized laboratory reviewer'; END IF;
   IF NEW.source_sha256<>j.source_sha256 OR j.status<>'READY_REVIEW' OR NEW.version<1 OR coalesce(NEW.snapshot->>'patientConfirmed','false')<>'true' OR jsonb_typeof(NEW.snapshot->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.snapshot->'rows') NOT BETWEEN 1 AND 200 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.snapshot->'rows') x WHERE coalesce(x->>'name','')='' OR coalesce(x->>'result','')='' OR coalesce(x->>'verified','false')<>'true' OR coalesce(x->>'uncertainty','')<>'') THEN RAISE EXCEPTION 'Laboratory review is not confirmed'; END IF;
  ELSIF TG_TABLE_NAME='inventory_laboratory_results' THEN
   SELECT * INTO r FROM inventory_laboratory_review_versions WHERE id=NEW.review_id;
   IF r.id IS NULL OR r.import_id<>j.id OR NEW.ordinal<0 OR r.snapshot->'rows'->NEW.ordinal IS DISTINCT FROM NEW.payload THEN RAISE EXCEPTION 'Result must match sealed review'; END IF;
  ELSE
   IF NEW.actor_user_id<>j.updated_by_user_id OR NEW.metadata->>'importVersion' IS DISTINCT FROM j.version::text OR NEW.action NOT IN ('OPENED','DRAFT_SAVED','PROCESSING_STARTED','EXTRACTION_READY','EXTRACTION_FAILED','VALIDATED','REOPENED') THEN RAISE EXCEPTION 'Laboratory event actor or version mismatch'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER laboratory_import_guard BEFORE INSERT OR UPDATE OR DELETE ON inventory_laboratory_imports FOR EACH ROW EXECUTE FUNCTION inventory_validate_laboratory_record();
--> statement-breakpoint
CREATE TRIGGER laboratory_review_guard BEFORE INSERT ON inventory_laboratory_review_versions FOR EACH ROW EXECUTE FUNCTION inventory_validate_laboratory_record();
--> statement-breakpoint
CREATE TRIGGER laboratory_result_guard BEFORE INSERT ON inventory_laboratory_results FOR EACH ROW EXECUTE FUNCTION inventory_validate_laboratory_record();
--> statement-breakpoint
CREATE TRIGGER laboratory_event_guard BEFORE INSERT ON inventory_laboratory_import_events FOR EACH ROW EXECUTE FUNCTION inventory_validate_laboratory_record();
--> statement-breakpoint
CREATE TRIGGER laboratory_review_immutable BEFORE UPDATE OR DELETE ON inventory_laboratory_review_versions FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER laboratory_result_immutable BEFORE UPDATE OR DELETE ON inventory_laboratory_results FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER laboratory_event_immutable BEFORE UPDATE OR DELETE ON inventory_laboratory_import_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER laboratory_import_no_truncate BEFORE TRUNCATE ON inventory_laboratory_imports FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER laboratory_review_no_truncate BEFORE TRUNCATE ON inventory_laboratory_review_versions FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER laboratory_result_no_truncate BEFORE TRUNCATE ON inventory_laboratory_results FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER laboratory_event_no_truncate BEFORE TRUNCATE ON inventory_laboratory_import_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE FUNCTION inventory_require_laboratory_seal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='inventory_laboratory_imports' THEN
  IF NOT EXISTS(SELECT 1 FROM inventory_laboratory_import_events e WHERE e.import_id=NEW.id AND e.actor_user_id=NEW.updated_by_user_id AND e.metadata->>'importVersion'=NEW.version::text) THEN RAISE EXCEPTION 'Laboratory update requires audit in same transaction'; END IF;
 ELSE
  IF (SELECT count(*) FROM inventory_laboratory_results WHERE review_id=NEW.id)<>jsonb_array_length(NEW.snapshot->'rows') OR NOT EXISTS(SELECT 1 FROM inventory_laboratory_imports i WHERE i.id=NEW.import_id AND i.status='VALIDATED' AND i.latest_review_id=NEW.id) THEN RAISE EXCEPTION 'Laboratory review and results must commit together'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER laboratory_import_seal AFTER INSERT OR UPDATE ON inventory_laboratory_imports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_require_laboratory_seal();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER laboratory_review_seal AFTER INSERT ON inventory_laboratory_review_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_require_laboratory_seal();
