CREATE TABLE "inventory_patient_document_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_patient_document_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_patient_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"title" text NOT NULL,
	"categories" text[] NOT NULL,
	"issued_on" date,
	"blob_pathname" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_patient_documents_blob_pathname_unique" UNIQUE("blob_pathname")
);
--> statement-breakpoint
ALTER TABLE "inventory_patient_document_categories" ADD CONSTRAINT "inventory_patient_document_categories_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_document_categories" ADD CONSTRAINT "inventory_patient_document_categories_created_by_user_id_inventory_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_document_events" ADD CONSTRAINT "inventory_patient_document_events_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_document_events" ADD CONSTRAINT "inventory_patient_document_events_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_document_events" ADD CONSTRAINT "inventory_patient_document_events_document_id_inventory_patient_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."inventory_patient_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_document_events" ADD CONSTRAINT "inventory_patient_document_events_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_documents" ADD CONSTRAINT "inventory_patient_documents_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_documents" ADD CONSTRAINT "inventory_patient_documents_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_documents" ADD CONSTRAINT "inventory_patient_documents_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_documents" ADD CONSTRAINT "inventory_patient_documents_uploaded_by_user_id_inventory_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patient_document_category_name_unique" ON "inventory_patient_document_categories" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "patient_document_event_history" ON "inventory_patient_document_events" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "patient_documents_patient_date" ON "inventory_patient_documents" USING btree ("organization_id","patient_id","created_at");--> statement-breakpoint
CREATE FUNCTION inventory_validate_patient_document() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE category text; d inventory_patient_documents%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='inventory_patient_document_categories' THEN
  IF char_length(trim(NEW.name)) NOT BETWEEN 2 AND 80 OR NOT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id JOIN inventory_organizations o ON o.id=m.organization_id WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.created_by_user_id AND m.active AND u.active AND o.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN')) THEN RAISE EXCEPTION 'Tenant category requires active authorized administrator'; END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='inventory_patient_documents' THEN
  IF NOT EXISTS(SELECT 1 FROM inventory_patients p JOIN inventory_units n ON n.id=NEW.unit_id AND n.organization_id=p.organization_id JOIN inventory_organizations o ON o.id=p.organization_id JOIN inventory_memberships m ON m.organization_id=p.organization_id JOIN inventory_users u ON u.id=m.user_id WHERE p.id=NEW.patient_id AND p.organization_id=NEW.organization_id AND p.primary_unit_id=NEW.unit_id AND p.active AND n.active AND o.active AND m.user_id=NEW.uploaded_by_user_id AND m.active AND u.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','CLINICIAN') AND (m.role='SUPER_ADMIN' OR EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=NEW.unit_id))) THEN RAISE EXCEPTION 'Patient document tenant, unit or individual clinical author invalid'; END IF;
  IF char_length(trim(NEW.title)) NOT BETWEEN 2 AND 200 OR char_length(trim(NEW.original_filename)) NOT BETWEEN 1 AND 180 OR NEW.content_type NOT IN ('application/pdf','image/jpeg','image/png') OR NEW.size_bytes NOT BETWEEN 1 AND 10485760 OR NEW.sha256 !~'^[0-9a-f]{64}$' OR NEW.blob_pathname NOT LIKE 'patient-documents/'||NEW.organization_id::text||'/'||NEW.patient_id::text||'/'||NEW.id::text||'.%' OR cardinality(NEW.categories) NOT BETWEEN 1 AND 8 OR cardinality(NEW.categories)<>(SELECT count(DISTINCT x) FROM unnest(NEW.categories)x) THEN RAISE EXCEPTION 'Invalid immutable patient file metadata'; END IF;
  FOREACH category IN ARRAY NEW.categories LOOP
   IF category IS NULL OR (category<>ALL(ARRAY['PRESCRIPTION','MEDICAL_PRESCRIPTION','MEDICAL_OPINION','EXAM_REQUEST','LAB_RESULT','IMAGE_REPORT','MEDICAL_CERTIFICATE','REFERRAL','MEDICAL_REPORT','CONSENT','CLINICAL_PLAN','QUOTE','QUESTIONNAIRE','OTHER']) AND NOT EXISTS(SELECT 1 FROM inventory_patient_document_categories c WHERE c.id::text=category AND c.organization_id=NEW.organization_id)) THEN RAISE EXCEPTION 'Category outside tenant catalog'; END IF;
  END LOOP;
 ELSE
  SELECT * INTO d FROM inventory_patient_documents WHERE id=NEW.document_id;
  IF d.id IS NULL OR NEW.organization_id<>d.organization_id OR NEW.unit_id<>d.unit_id OR NEW.actor_user_id<>d.uploaded_by_user_id OR NEW.action<>'UPLOADED' THEN RAISE EXCEPTION 'Upload audit must match file and source actor'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patient_document_category_validate BEFORE INSERT ON inventory_patient_document_categories FOR EACH ROW EXECUTE FUNCTION inventory_validate_patient_document();
--> statement-breakpoint
CREATE TRIGGER patient_document_validate BEFORE INSERT ON inventory_patient_documents FOR EACH ROW EXECUTE FUNCTION inventory_validate_patient_document();
--> statement-breakpoint
CREATE TRIGGER patient_document_event_validate BEFORE INSERT ON inventory_patient_document_events FOR EACH ROW EXECUTE FUNCTION inventory_validate_patient_document();
--> statement-breakpoint
CREATE UNIQUE INDEX patient_document_uploaded_once ON inventory_patient_document_events(document_id,action);
--> statement-breakpoint
CREATE TRIGGER patient_document_category_immutable BEFORE UPDATE OR DELETE ON inventory_patient_document_categories FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER patient_document_immutable BEFORE UPDATE OR DELETE ON inventory_patient_documents FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER patient_document_event_immutable BEFORE UPDATE OR DELETE ON inventory_patient_document_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER patient_document_category_no_truncate BEFORE TRUNCATE ON inventory_patient_document_categories FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER patient_document_no_truncate BEFORE TRUNCATE ON inventory_patient_documents FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER patient_document_event_no_truncate BEFORE TRUNCATE ON inventory_patient_document_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE FUNCTION inventory_require_patient_document_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM inventory_patient_document_events e WHERE e.document_id=NEW.id AND e.organization_id=NEW.organization_id AND e.unit_id=NEW.unit_id AND e.actor_user_id=NEW.uploaded_by_user_id AND e.action='UPLOADED') THEN RAISE EXCEPTION 'Patient upload and immutable audit must commit together'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER patient_document_requires_audit AFTER INSERT ON inventory_patient_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_require_patient_document_audit();
