CREATE TABLE "inventory_integration_event_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"consumer_key" text,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_integration_inbox_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"consumer_key" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_integration_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_integration_event_audit" ADD CONSTRAINT "inventory_integration_event_audit_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_integration_event_audit" ADD CONSTRAINT "inventory_integration_event_audit_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_integration_event_audit" ADD CONSTRAINT "inventory_integration_event_audit_event_id_inventory_integration_outbox_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."inventory_integration_outbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_integration_event_audit" ADD CONSTRAINT "inventory_integration_event_audit_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_integration_inbox_receipts" ADD CONSTRAINT "inventory_integration_inbox_receipts_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_integration_inbox_receipts" ADD CONSTRAINT "inventory_integration_inbox_receipts_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_integration_inbox_receipts" ADD CONSTRAINT "inventory_integration_inbox_receipts_event_id_inventory_integration_outbox_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."inventory_integration_outbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_integration_inbox_receipts" ADD CONSTRAINT "inventory_integration_inbox_receipts_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_integration_outbox" ADD CONSTRAINT "inventory_integration_outbox_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_integration_outbox" ADD CONSTRAINT "inventory_integration_outbox_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_integration_outbox" ADD CONSTRAINT "inventory_integration_outbox_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_audit_event" ON "inventory_integration_event_audit" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_inbox_consumer_unique" ON "inventory_integration_inbox_receipts" USING btree ("event_id","consumer_key");--> statement-breakpoint
CREATE INDEX "integration_inbox_scope" ON "inventory_integration_inbox_receipts" USING btree ("organization_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_outbox_event_unique" ON "inventory_integration_outbox" USING btree ("organization_id","event_type","aggregate_type","aggregate_id","aggregate_version");--> statement-breakpoint
CREATE INDEX "integration_outbox_scope" ON "inventory_integration_outbox" USING btree ("organization_id","unit_id","created_at");--> statement-breakpoint
CREATE FUNCTION inventory_validate_integration_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e inventory_integration_outbox%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM inventory_units u JOIN inventory_organizations o ON o.id=u.organization_id WHERE u.id=NEW.unit_id AND u.organization_id=NEW.organization_id AND u.active AND o.active) OR NOT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE m.user_id=NEW.actor_user_id AND m.organization_id=NEW.organization_id AND m.active AND u.active AND (m.role='SUPER_ADMIN' OR EXISTS(SELECT 1 FROM inventory_unit_access a WHERE a.membership_id=m.id AND a.unit_id=NEW.unit_id))) THEN RAISE EXCEPTION 'Integration actor or unit outside organization'; END IF;
 IF TG_TABLE_NAME='inventory_integration_outbox' THEN
  IF NEW.schema_version<>1 OR NEW.aggregate_version<0 OR NEW.payload IS DISTINCT FROM jsonb_build_object('resourceId',NEW.aggregate_id::text,'resourceVersion',NEW.aggregate_version) THEN RAISE EXCEPTION 'Integration payload must contain only matching resource references'; END IF;
  IF NEW.event_type='PRESCRIPTION_FINALIZED' AND NEW.aggregate_type='PRESCRIPTION' THEN
   IF NOT EXISTS(SELECT 1 FROM inventory_encounter_documents d WHERE d.id=NEW.aggregate_id AND d.organization_id=NEW.organization_id AND d.unit_id=NEW.unit_id AND d.type='PRESCRIPTION' AND d.status='FINAL' AND d.version=NEW.aggregate_version AND d.author_user_id=NEW.actor_user_id) THEN RAISE EXCEPTION 'Final prescription source required'; END IF;
  ELSIF NEW.event_type='QUOTE_CREATED' AND NEW.aggregate_type='QUOTE' THEN
   IF NEW.aggregate_version<>1 OR NOT EXISTS(SELECT 1 FROM inventory_plan_quotes q JOIN inventory_plan_quote_versions v ON v.quote_id=q.id AND v.version=1 WHERE q.id=NEW.aggregate_id AND q.organization_id=NEW.organization_id AND q.unit_id=NEW.unit_id AND q.created_by_user_id=NEW.actor_user_id) THEN RAISE EXCEPTION 'First saved estimate source required'; END IF;
  ELSIF NEW.event_type='ITEM_ADMINISTERED' AND NEW.aggregate_type='ADMINISTRATION' THEN
   IF NEW.aggregate_version<>1 OR NOT EXISTS(SELECT 1 FROM inventory_patient_applications a JOIN inventory_patient_treatment_schedule s ON s.id=a.schedule_id AND s.organization_id=a.organization_id WHERE a.id=NEW.aggregate_id AND a.organization_id=NEW.organization_id AND a.unit_id=NEW.unit_id AND a.actor_user_id=NEW.actor_user_id AND s.status='CONSUMED') THEN RAISE EXCEPTION 'Completed administration source required'; END IF;
  ELSIF NEW.event_type='STOCK_CONSUMED' AND NEW.aggregate_type='STOCK_CONSUMPTION' THEN
   IF NEW.aggregate_version<>1 OR NOT EXISTS(SELECT 1 FROM inventory_open_presentation_events c JOIN inventory_open_presentations p ON p.id=c.open_presentation_id JOIN inventory_patient_applications a ON a.id=c.patient_application_id AND a.organization_id=p.organization_id AND a.unit_id=p.unit_id JOIN inventory_patient_treatment_schedule s ON s.id=a.schedule_id AND s.organization_id=a.organization_id WHERE c.id=NEW.aggregate_id AND c.type='CONSUME' AND c.actor_user_id=NEW.actor_user_id AND p.organization_id=NEW.organization_id AND p.unit_id=NEW.unit_id AND s.status='CONSUMED') THEN RAISE EXCEPTION 'Actual base-unit consumption source required'; END IF;
  ELSE RAISE EXCEPTION 'Unsupported integration lifecycle transition'; END IF;
 ELSE
  SELECT * INTO e FROM inventory_integration_outbox WHERE id=NEW.event_id;
  IF NOT FOUND OR e.organization_id<>NEW.organization_id OR e.unit_id<>NEW.unit_id THEN RAISE EXCEPTION 'Integration receipt or audit scope mismatch'; END IF;
  IF TG_TABLE_NAME='inventory_integration_inbox_receipts' THEN
   IF NEW.consumer_key !~'^[a-z][a-z0-9._-]{0,79}$' THEN RAISE EXCEPTION 'Invalid internal consumer key'; END IF;
  ELSE
   IF NEW.action='EMITTED' THEN
    IF NEW.consumer_key IS NOT NULL OR NEW.actor_user_id<>e.actor_user_id OR EXISTS(SELECT 1 FROM inventory_integration_event_audit a WHERE a.event_id=e.id AND a.action='EMITTED') THEN RAISE EXCEPTION 'Invalid emission audit'; END IF;
   ELSIF NEW.action='CONSUMED' THEN
    IF NEW.consumer_key IS NULL OR NOT EXISTS(SELECT 1 FROM inventory_integration_inbox_receipts r WHERE r.event_id=e.id AND r.consumer_key=NEW.consumer_key AND r.actor_user_id=NEW.actor_user_id) OR EXISTS(SELECT 1 FROM inventory_integration_event_audit a WHERE a.event_id=e.id AND a.action='CONSUMED' AND a.consumer_key=NEW.consumer_key) THEN RAISE EXCEPTION 'Invalid consumer receipt audit'; END IF;
   ELSE RAISE EXCEPTION 'Invalid integration audit action'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER integration_outbox_validate BEFORE INSERT ON inventory_integration_outbox FOR EACH ROW EXECUTE FUNCTION inventory_validate_integration_event();
--> statement-breakpoint
CREATE TRIGGER integration_inbox_validate BEFORE INSERT ON inventory_integration_inbox_receipts FOR EACH ROW EXECUTE FUNCTION inventory_validate_integration_event();
--> statement-breakpoint
CREATE TRIGGER integration_audit_validate BEFORE INSERT ON inventory_integration_event_audit FOR EACH ROW EXECUTE FUNCTION inventory_validate_integration_event();
--> statement-breakpoint
CREATE TRIGGER integration_outbox_immutable BEFORE UPDATE OR DELETE ON inventory_integration_outbox FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER integration_inbox_immutable BEFORE UPDATE OR DELETE ON inventory_integration_inbox_receipts FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER integration_audit_immutable BEFORE UPDATE OR DELETE ON inventory_integration_event_audit FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER integration_outbox_no_truncate BEFORE TRUNCATE ON inventory_integration_outbox FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER integration_inbox_no_truncate BEFORE TRUNCATE ON inventory_integration_inbox_receipts FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER integration_audit_no_truncate BEFORE TRUNCATE ON inventory_integration_event_audit FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE FUNCTION inventory_require_integration_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='inventory_integration_outbox' THEN
  IF NOT EXISTS(SELECT 1 FROM inventory_integration_event_audit a WHERE a.event_id=NEW.id AND a.action='EMITTED') THEN RAISE EXCEPTION 'Outbox emission and audit must commit together'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM inventory_integration_event_audit a WHERE a.event_id=NEW.event_id AND a.action='CONSUMED' AND a.consumer_key=NEW.consumer_key AND a.actor_user_id=NEW.actor_user_id) THEN RAISE EXCEPTION 'Consumer receipt and audit must commit together'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER integration_outbox_requires_audit AFTER INSERT ON inventory_integration_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_require_integration_audit();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER integration_inbox_requires_audit AFTER INSERT ON inventory_integration_inbox_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_require_integration_audit();
