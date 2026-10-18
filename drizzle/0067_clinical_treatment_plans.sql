CREATE TABLE "inventory_clinical_plan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_clinical_plan_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"product_id" uuid,
	"catalog_item_id" uuid,
	"existing_treatment_id" uuid,
	"appointment_id" uuid,
	"prescription_instance_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_clinical_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_clinical_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"start_date" date NOT NULL,
	"preview_days" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_events" ADD CONSTRAINT "inventory_clinical_plan_events_plan_id_inventory_clinical_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."inventory_clinical_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_events" ADD CONSTRAINT "inventory_clinical_plan_events_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_events" ADD CONSTRAINT "inventory_clinical_plan_events_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_events" ADD CONSTRAINT "inventory_clinical_plan_events_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_items" ADD CONSTRAINT "inventory_clinical_plan_items_plan_id_inventory_clinical_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."inventory_clinical_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_items" ADD CONSTRAINT "inventory_clinical_plan_items_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_items" ADD CONSTRAINT "inventory_clinical_plan_items_product_id_inventory_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."inventory_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_items" ADD CONSTRAINT "inventory_clinical_plan_items_catalog_item_id_inventory_engine_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_engine_catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_items" ADD CONSTRAINT "inventory_clinical_plan_items_existing_treatment_id_inventory_patient_treatments_id_fk" FOREIGN KEY ("existing_treatment_id") REFERENCES "public"."inventory_patient_treatments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_items" ADD CONSTRAINT "inventory_clinical_plan_items_appointment_id_inventory_care_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."inventory_care_appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_items" ADD CONSTRAINT "inventory_clinical_plan_items_prescription_instance_id_inventory_prescription_protocol_instances_id_fk" FOREIGN KEY ("prescription_instance_id") REFERENCES "public"."inventory_prescription_protocol_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_versions" ADD CONSTRAINT "inventory_clinical_plan_versions_plan_id_inventory_clinical_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."inventory_clinical_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_versions" ADD CONSTRAINT "inventory_clinical_plan_versions_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plan_versions" ADD CONSTRAINT "inventory_clinical_plan_versions_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plans" ADD CONSTRAINT "inventory_clinical_plans_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plans" ADD CONSTRAINT "inventory_clinical_plans_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plans" ADD CONSTRAINT "inventory_clinical_plans_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_plans" ADD CONSTRAINT "inventory_clinical_plans_author_user_id_inventory_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_plan_operation_unique" ON "inventory_clinical_plan_events" USING btree ("organization_id","operation_id");--> statement-breakpoint
CREATE INDEX "clinical_plan_items_plan" ON "inventory_clinical_plan_items" USING btree ("plan_id","active","position");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_plan_revision_unique" ON "inventory_clinical_plan_versions" USING btree ("plan_id","version");--> statement-breakpoint
CREATE INDEX "clinical_plans_patient" ON "inventory_clinical_plans" USING btree ("organization_id","patient_id");--> statement-breakpoint
CREATE FUNCTION inventory_validate_clinical_plan() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p inventory_clinical_plans%ROWTYPE; j jsonb; k text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Clinical plans preserve their history'; END IF;
 IF TG_TABLE_NAME='inventory_clinical_plans' THEN
  IF NEW.status NOT IN ('DRAFT','ACTIVE','ARCHIVED') OR NEW.version<1 OR length(NEW.title) NOT BETWEEN 2 AND 200 OR NEW.preview_days NOT BETWEEN 1 AND 366 THEN RAISE EXCEPTION 'Invalid clinical plan'; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_patients x JOIN inventory_units u ON u.id=NEW.unit_id WHERE x.id=NEW.patient_id AND x.organization_id=NEW.organization_id AND u.organization_id=NEW.organization_id AND (TG_OP='UPDATE' OR x.primary_unit_id=NEW.unit_id)) THEN RAISE EXCEPTION 'Invalid clinical plan scope'; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE m.user_id=NEW.author_user_id AND m.organization_id=NEW.organization_id AND m.active AND u.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','CLINICIAN') AND inventory_professional_registration_state(u.id,m.organization_id)='OK') THEN RAISE EXCEPTION 'Invalid clinical plan author'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.id,NEW.organization_id,NEW.patient_id,NEW.unit_id,NEW.author_user_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.patient_id,OLD.unit_id,OLD.author_user_id,OLD.created_at) OR NEW.version<>OLD.version+1 OR OLD.status='ARCHIVED') THEN RAISE EXCEPTION 'Clinical plan origin or revision is immutable'; END IF;
 ELSIF TG_TABLE_NAME='inventory_clinical_plan_items' THEN
  SELECT * INTO p FROM inventory_clinical_plans WHERE id=NEW.plan_id;
  IF EXISTS(SELECT 1 FROM inventory_clinical_plan_versions v WHERE v.plan_id=p.id AND v.version=p.version) THEN RAISE EXCEPTION 'Current clinical items require a new aggregate revision'; END IF;
  IF p.id IS NULL OR NEW.organization_id<>p.organization_id OR NEW.position NOT BETWEEN 0 AND 49 OR NEW.kind NOT IN ('PRESCRIPTION','PROCEDURE','CONSULTATION','INJECTABLE_SESSION','SERVICE','RETURN') OR jsonb_typeof(NEW.definition)<>'object' OR NEW.definition->>'id' IS DISTINCT FROM NEW.id::text OR NEW.definition->>'kind' IS DISTINCT FROM NEW.kind THEN RAISE EXCEPTION 'Invalid clinical plan item'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id,NEW.organization_id,NEW.plan_id) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.plan_id) THEN RAISE EXCEPTION 'Clinical item origin is immutable'; END IF;
  IF (NEW.product_id IS NOT NULL AND NEW.catalog_item_id IS NOT NULL) OR (NEW.definition->>'productId') IS DISTINCT FROM NEW.product_id::text OR (NEW.definition->>'catalogItemId') IS DISTINCT FROM NEW.catalog_item_id::text OR (NEW.definition->>'existingTreatmentId') IS DISTINCT FROM NEW.existing_treatment_id::text OR (NEW.definition->>'appointmentId') IS DISTINCT FROM NEW.appointment_id::text OR (NEW.definition->>'prescriptionInstanceId') IS DISTINCT FROM NEW.prescription_instance_id::text THEN RAISE EXCEPTION 'Invalid clinical item references'; END IF;
  IF NEW.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_products x WHERE x.id=NEW.product_id AND x.organization_id=p.organization_id AND (NOT NEW.active OR x.active)) THEN RAISE EXCEPTION 'Invalid clinical product'; END IF;
  IF NEW.catalog_item_id IS NOT NULL THEN
   SELECT kind INTO k FROM inventory_engine_catalog_items x WHERE x.id=NEW.catalog_item_id AND x.organization_id=p.organization_id AND (NOT NEW.active OR x.active);
   IF k IS NULL OR (NEW.kind='PRESCRIPTION' AND k NOT IN ('ACTIVE','MEDICATION')) OR (NEW.kind<>'PRESCRIPTION' AND k NOT IN ('SERVICE','PROCEDURE')) THEN RAISE EXCEPTION 'Invalid clinical catalog type'; END IF;
  END IF;
  IF NEW.existing_treatment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_patient_treatments x WHERE x.id=NEW.existing_treatment_id AND x.organization_id=p.organization_id AND x.patient_id=p.patient_id AND x.unit_id=p.unit_id) THEN RAISE EXCEPTION 'Invalid treatment reference'; END IF;
  IF NEW.appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_care_appointments x WHERE x.id=NEW.appointment_id AND x.organization_id=p.organization_id AND x.patient_id=p.patient_id AND x.unit_id=p.unit_id) THEN RAISE EXCEPTION 'Invalid appointment reference'; END IF;
  IF NEW.prescription_instance_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_prescription_protocol_instances x JOIN inventory_encounter_documents d ON d.id=x.document_id WHERE x.id=NEW.prescription_instance_id AND x.organization_id=p.organization_id AND d.patient_id=p.patient_id AND d.unit_id=p.unit_id) THEN RAISE EXCEPTION 'Invalid clinical instance reference'; END IF;
 ELSE
  SELECT * INTO p FROM inventory_clinical_plans WHERE id=NEW.plan_id;
  IF p.id IS NULL OR NEW.organization_id<>p.organization_id OR NEW.unit_id<>p.unit_id THEN RAISE EXCEPTION 'Invalid clinical plan history scope'; END IF;
  IF TG_TABLE_NAME='inventory_clinical_plan_versions' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY position,id),'[]'::jsonb) INTO j FROM inventory_clinical_plan_items i WHERE i.plan_id=p.id AND i.active;
   IF jsonb_array_length(j) NOT BETWEEN 1 AND 50 OR (SELECT count(*)<>count(DISTINCT position) FROM inventory_clinical_plan_items i WHERE i.plan_id=p.id AND i.active) OR NEW.version<>p.version OR NEW.snapshot->'head' IS DISTINCT FROM to_jsonb(p) OR NEW.snapshot->'items' IS DISTINCT FROM j OR NEW.snapshot->'plan' IS DISTINCT FROM jsonb_build_object('startDate',p.start_date::text,'previewDays',p.preview_days,'items',(SELECT coalesce(jsonb_agg(i.definition ORDER BY position,id),'[]'::jsonb) FROM inventory_clinical_plan_items i WHERE i.plan_id=p.id AND i.active)) OR jsonb_typeof(NEW.snapshot->'preview') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid clinical plan revision snapshot'; END IF;
  ELSE
   IF NEW.actor_user_id<>p.author_user_id OR NEW.request_hash!~'^[0-9a-f]{64}$' OR NOT EXISTS(SELECT 1 FROM inventory_clinical_plan_versions v WHERE v.plan_id=p.id AND v.version=p.version AND v.snapshot=NEW.after_data) OR NEW.result->>'id' IS DISTINCT FROM p.id::text OR (NEW.result->>'version')::int<>p.version THEN RAISE EXCEPTION 'Invalid clinical plan audit'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinical_plans_validate BEFORE INSERT OR UPDATE OR DELETE ON inventory_clinical_plans FOR EACH ROW EXECUTE FUNCTION inventory_validate_clinical_plan();
--> statement-breakpoint
CREATE TRIGGER clinical_plan_items_validate BEFORE INSERT OR UPDATE OR DELETE ON inventory_clinical_plan_items FOR EACH ROW EXECUTE FUNCTION inventory_validate_clinical_plan();
--> statement-breakpoint
CREATE TRIGGER clinical_plan_versions_validate BEFORE INSERT ON inventory_clinical_plan_versions FOR EACH ROW EXECUTE FUNCTION inventory_validate_clinical_plan();
--> statement-breakpoint
CREATE TRIGGER clinical_plan_events_validate BEFORE INSERT ON inventory_clinical_plan_events FOR EACH ROW EXECUTE FUNCTION inventory_validate_clinical_plan();
--> statement-breakpoint
CREATE TRIGGER clinical_plan_versions_immutable BEFORE UPDATE OR DELETE ON inventory_clinical_plan_versions FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER clinical_plan_events_immutable BEFORE UPDATE OR DELETE ON inventory_clinical_plan_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER clinical_plans_no_truncate BEFORE TRUNCATE ON inventory_clinical_plans FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER clinical_plan_items_no_truncate BEFORE TRUNCATE ON inventory_clinical_plan_items FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER clinical_plan_versions_no_truncate BEFORE TRUNCATE ON inventory_clinical_plan_versions FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER clinical_plan_events_no_truncate BEFORE TRUNCATE ON inventory_clinical_plan_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();

--> statement-breakpoint
CREATE FUNCTION inventory_require_clinical_plan_seal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_version integer;
BEGIN
 SELECT version INTO current_version FROM inventory_clinical_plans WHERE id=NEW.id;
 IF NOT EXISTS(SELECT 1 FROM inventory_clinical_plan_versions v JOIN inventory_clinical_plan_events e ON e.plan_id=v.plan_id AND e.after_data=v.snapshot WHERE v.plan_id=NEW.id AND v.version=current_version) THEN RAISE EXCEPTION 'Clinical plan revision and audit must commit together'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER clinical_plan_requires_seal AFTER INSERT OR UPDATE ON inventory_clinical_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_require_clinical_plan_seal();
