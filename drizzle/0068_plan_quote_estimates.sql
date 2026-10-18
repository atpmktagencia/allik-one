CREATE TABLE "inventory_plan_quote_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
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
CREATE TABLE "inventory_plan_quote_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_plan_quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_version" integer NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT_ESTIMATE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_plan_quote_events" ADD CONSTRAINT "inventory_plan_quote_events_quote_id_inventory_plan_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."inventory_plan_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_plan_quote_events" ADD CONSTRAINT "inventory_plan_quote_events_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_plan_quote_events" ADD CONSTRAINT "inventory_plan_quote_events_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_plan_quote_events" ADD CONSTRAINT "inventory_plan_quote_events_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_plan_quote_versions" ADD CONSTRAINT "inventory_plan_quote_versions_quote_id_inventory_plan_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."inventory_plan_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_plan_quote_versions" ADD CONSTRAINT "inventory_plan_quote_versions_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_plan_quote_versions" ADD CONSTRAINT "inventory_plan_quote_versions_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_plan_quotes" ADD CONSTRAINT "inventory_plan_quotes_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_plan_quotes" ADD CONSTRAINT "inventory_plan_quotes_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_plan_quotes" ADD CONSTRAINT "inventory_plan_quotes_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_plan_quotes" ADD CONSTRAINT "inventory_plan_quotes_plan_id_inventory_clinical_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."inventory_clinical_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_plan_quotes" ADD CONSTRAINT "inventory_plan_quotes_created_by_user_id_inventory_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_quote_operation_unique" ON "inventory_plan_quote_events" USING btree ("organization_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_quote_revision_unique" ON "inventory_plan_quote_versions" USING btree ("quote_id","version");--> statement-breakpoint
CREATE INDEX "plan_quotes_patient" ON "inventory_plan_quotes" USING btree ("organization_id","patient_id","plan_id");--> statement-breakpoint
CREATE FUNCTION inventory_validate_plan_quote() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE q inventory_plan_quotes%ROWTYPE; p inventory_clinical_plans%ROWTYPE; e jsonb; line jsonb; price_snapshot jsonb; actor_id uuid; role_name text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Estimates preserve their history'; END IF;
 IF TG_TABLE_NAME='inventory_plan_quotes' THEN
  SELECT * INTO p FROM inventory_clinical_plans WHERE id=NEW.plan_id;
  IF p.id IS NULL OR p.organization_id<>NEW.organization_id OR p.patient_id<>NEW.patient_id OR p.unit_id<>NEW.unit_id OR NEW.plan_version<>p.version OR p.status='ARCHIVED' OR NEW.status<>'DRAFT_ESTIMATE' OR NEW.version<1 OR (TG_OP='INSERT' AND NEW.version<>1) THEN RAISE EXCEPTION 'Invalid estimate source or scope'; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_clinical_plan_versions v WHERE v.plan_id=p.id AND v.version=NEW.plan_version) THEN RAISE EXCEPTION 'Missing clinical source revision'; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE m.user_id=NEW.created_by_user_id AND m.organization_id=NEW.organization_id AND m.active AND u.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','UNIT_MANAGER','FINANCE','CLINICIAN')) THEN RAISE EXCEPTION 'Invalid quote author'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.id,NEW.organization_id,NEW.patient_id,NEW.unit_id,NEW.plan_id,NEW.created_by_user_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.patient_id,OLD.unit_id,OLD.plan_id,OLD.created_by_user_id,OLD.created_at) OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Estimate origin or revision is immutable'; END IF;
 ELSE
  SELECT * INTO q FROM inventory_plan_quotes WHERE id=NEW.quote_id;
  IF q.id IS NULL OR q.organization_id<>NEW.organization_id OR q.unit_id<>NEW.unit_id THEN RAISE EXCEPTION 'Invalid quote history scope'; END IF;
  IF TG_TABLE_NAME='inventory_plan_quote_versions' THEN
   e=NEW.snapshot->'estimate';actor_id=(NEW.snapshot->>'actorUserId')::uuid;
   SELECT m.role INTO role_name FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE m.user_id=actor_id AND m.organization_id=q.organization_id AND m.active AND u.active;
   IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(e->'discountBps') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'complete') IS DISTINCT FROM 'boolean' OR jsonb_typeof(e->'referenceDate') IS DISTINCT FROM 'string' OR role_name IS NULL OR role_name NOT IN ('SUPER_ADMIN','PARTNER_ADMIN','UNIT_MANAGER','FINANCE','CLINICIAN') OR NEW.version<>q.version OR NEW.snapshot->'head' IS DISTINCT FROM to_jsonb(q) OR e->>'unitId' IS DISTINCT FROM q.unit_id::text OR e->>'unitName' IS DISTINCT FROM (SELECT name FROM inventory_units WHERE id=q.unit_id) OR (e->>'planVersion')::int IS DISTINCT FROM q.plan_version OR (e->>'sourcePlanVersion')::int IS DISTINCT FROM q.plan_version OR (e->>'discountBps')::int NOT BETWEEN 0 AND 10000 OR ((e->>'discountBps')::int>0 AND role_name<>'SUPER_ADMIN') OR e->>'referenceDate' !~ '^\d{4}-\d{2}-\d{2}$' OR jsonb_typeof(e->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(e->'lines') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid estimate snapshot'; END IF;
   SELECT * INTO p FROM inventory_clinical_plans WHERE id=q.plan_id;
   IF role_name='CLINICIAN' AND actor_id<>p.author_user_id THEN RAISE EXCEPTION 'Clinical quote requires source authorship'; END IF;
   IF NOT EXISTS(SELECT 1 FROM inventory_clinical_plan_versions v WHERE v.plan_id=q.plan_id AND v.version=q.plan_version) THEN RAISE EXCEPTION 'Invalid source plan revision'; END IF;
   FOR line IN SELECT value FROM jsonb_array_elements(e->'lines') LOOP
    IF line->>'priceId' IS NOT NULL THEN
     SELECT v.snapshot INTO price_snapshot FROM inventory_engine_unit_sale_price_versions v WHERE v.price_id=(line->>'priceId')::uuid AND v.version=(line->>'priceVersion')::int AND v.organization_id=q.organization_id AND v.unit_id=q.unit_id;
     IF price_snapshot IS NULL OR coalesce(line->>'targetType','') NOT IN ('PRODUCT','CATALOG') OR line->>'unit' IS DISTINCT FROM price_snapshot->>'selling_unit' OR (line->>'unitPrice' IS NOT NULL AND (line->>'unitPrice' !~ '^(0|[1-9]\d{0,9})\.\d{2}$' OR (line->>'unitPrice')::numeric IS DISTINCT FROM (price_snapshot->>'amount')::numeric)) OR line->>'priceSource' IS DISTINCT FROM price_snapshot->>'source' OR line->>'validFrom' IS DISTINCT FROM price_snapshot->>'valid_from' OR line->>'validUntil' IS DISTINCT FROM price_snapshot->>'valid_until' OR (line->>'targetType'='PRODUCT' AND line->>'targetId' IS DISTINCT FROM price_snapshot->>'product_id') OR (line->>'targetType'='CATALOG' AND line->>'targetId' IS DISTINCT FROM price_snapshot->>'catalog_item_id') THEN RAISE EXCEPTION 'Invalid frozen sale price provenance'; END IF;
    ELSIF line->>'priceVersion' IS NOT NULL THEN RAISE EXCEPTION 'Invalid price revision reference'; END IF;
    IF line->>'status'='UNRESOLVED' AND (line->>'selected')::boolean AND (e->>'complete')::boolean THEN RAISE EXCEPTION 'Unresolved estimate cannot be complete'; END IF;
   END LOOP;
   IF NOT (e->>'complete')::boolean AND (e->>'total' IS NOT NULL OR e->>'subtotal' IS NOT NULL OR e->>'discountAmount' IS NOT NULL) THEN RAISE EXCEPTION 'Unresolved estimate totals remain unknown'; END IF;
  ELSE
   IF NEW.request_hash !~'^[0-9a-f]{64}$' OR NEW.after_data->>'actorUserId' IS DISTINCT FROM NEW.actor_user_id::text OR NOT EXISTS(SELECT 1 FROM inventory_plan_quote_versions v WHERE v.quote_id=q.id AND v.version=q.version AND v.snapshot=NEW.after_data) OR NEW.result->>'id' IS DISTINCT FROM q.id::text OR (NEW.result->>'version')::int IS DISTINCT FROM q.version THEN RAISE EXCEPTION 'Invalid estimate audit'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER plan_quotes_validate BEFORE INSERT OR UPDATE OR DELETE ON inventory_plan_quotes FOR EACH ROW EXECUTE FUNCTION inventory_validate_plan_quote();
--> statement-breakpoint
CREATE TRIGGER plan_quote_versions_validate BEFORE INSERT ON inventory_plan_quote_versions FOR EACH ROW EXECUTE FUNCTION inventory_validate_plan_quote();
--> statement-breakpoint
CREATE TRIGGER plan_quote_events_validate BEFORE INSERT ON inventory_plan_quote_events FOR EACH ROW EXECUTE FUNCTION inventory_validate_plan_quote();
--> statement-breakpoint
CREATE TRIGGER plan_quote_versions_immutable BEFORE UPDATE OR DELETE ON inventory_plan_quote_versions FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER plan_quote_events_immutable BEFORE UPDATE OR DELETE ON inventory_plan_quote_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER plan_quotes_no_truncate BEFORE TRUNCATE ON inventory_plan_quotes FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER plan_quote_versions_no_truncate BEFORE TRUNCATE ON inventory_plan_quote_versions FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER plan_quote_events_no_truncate BEFORE TRUNCATE ON inventory_plan_quote_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE FUNCTION inventory_require_plan_quote_seal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_version integer;
BEGIN
 SELECT version INTO current_version FROM inventory_plan_quotes WHERE id=NEW.id;
 IF NOT EXISTS(SELECT 1 FROM inventory_plan_quote_versions v JOIN inventory_plan_quote_events e ON e.quote_id=v.quote_id AND e.after_data=v.snapshot WHERE v.quote_id=NEW.id AND v.version=current_version) THEN RAISE EXCEPTION 'Estimate snapshot and audit commit together'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER plan_quote_requires_seal AFTER INSERT OR UPDATE ON inventory_plan_quotes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_require_plan_quote_seal();
