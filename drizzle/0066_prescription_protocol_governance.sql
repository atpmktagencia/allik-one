CREATE TABLE "inventory_prescription_protocol_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"protocol_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_prescription_protocol_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"protocol_id" uuid NOT NULL,
	"grantee_user_id" uuid NOT NULL,
	"granted_by_user_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_prescription_protocol_instances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"source_protocol_id" uuid,
	"source_version" integer,
	"formula" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_versions" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_versions" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_versions" ADD COLUMN "visibility" text DEFAULT 'PRIVATE' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_versions" ADD COLUMN "status" text DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_versions" ADD COLUMN "unit_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocols" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocols" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocols" ADD COLUMN "visibility" text DEFAULT 'PRIVATE' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocols" ADD COLUMN "status" text DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocols" ADD COLUMN "unit_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_events" ADD CONSTRAINT "inventory_prescription_protocol_events_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_events" ADD CONSTRAINT "inventory_prescription_protocol_events_protocol_id_inventory_prescription_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."inventory_prescription_protocols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_events" ADD CONSTRAINT "inventory_prescription_protocol_events_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_grants" ADD CONSTRAINT "inventory_prescription_protocol_grants_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_grants" ADD CONSTRAINT "inventory_prescription_protocol_grants_protocol_id_inventory_prescription_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."inventory_prescription_protocols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_grants" ADD CONSTRAINT "inventory_prescription_protocol_grants_grantee_user_id_inventory_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_grants" ADD CONSTRAINT "inventory_prescription_protocol_grants_granted_by_user_id_inventory_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_instances" ADD CONSTRAINT "inventory_prescription_protocol_instances_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_instances" ADD CONSTRAINT "inventory_prescription_protocol_instances_appointment_id_inventory_care_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."inventory_care_appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_instances" ADD CONSTRAINT "inventory_prescription_protocol_instances_document_id_inventory_encounter_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."inventory_encounter_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_instances" ADD CONSTRAINT "inventory_prescription_protocol_instances_author_user_id_inventory_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_instances" ADD CONSTRAINT "inventory_prescription_protocol_instances_source_protocol_id_inventory_prescription_protocols_id_fk" FOREIGN KEY ("source_protocol_id") REFERENCES "public"."inventory_prescription_protocols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prescription_protocol_grantee_unique" ON "inventory_prescription_protocol_grants" USING btree ("protocol_id","grantee_user_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_validate_prescription_protocol() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE unit_value jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Protocols cannot be deleted'; END IF;
 IF NEW.visibility NOT IN ('PRIVATE','ORGANIZATION','INSTITUTIONAL') OR NEW.status NOT IN ('DRAFT','PENDING','APPROVED') OR length(NEW.category)>100 OR length(NEW.description)>2000 OR jsonb_typeof(NEW.unit_ids)<>'array' OR jsonb_array_length(NEW.unit_ids)>100 THEN RAISE EXCEPTION 'Invalid model metadata'; END IF;
 IF NEW.visibility<>'INSTITUTIONAL' AND NEW.status<>'DRAFT' THEN RAISE EXCEPTION 'Only institutional models have approval states'; END IF;
 FOR unit_value IN SELECT value FROM jsonb_array_elements(NEW.unit_ids) LOOP
  IF jsonb_typeof(unit_value)<>'string' OR NOT EXISTS(SELECT 1 FROM inventory_units u WHERE u.id::text=unit_value#>>'{}' AND u.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invalid model unit scope'; END IF;
 END LOOP;
 IF TG_TABLE_NAME='inventory_prescription_protocols' THEN
  IF NEW.version<1 OR jsonb_typeof(NEW.formula)<>'object' OR length(NEW.title) NOT BETWEEN 2 AND 160 THEN RAISE EXCEPTION 'Invalid protocol'; END IF;
  IF TG_OP='INSERT' AND (NEW.version<>1 OR NEW.status<>'DRAFT') THEN RAISE EXCEPTION 'Invalid initial protocol state'; END IF;
  IF TG_OP='UPDATE' THEN
   IF (NEW.id,NEW.organization_id,NEW.author_user_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.author_user_id,OLD.created_at) OR NEW.version<>OLD.version+1 OR OLD.archived THEN RAISE EXCEPTION 'Invalid protocol origin or version'; END IF;
   IF OLD.visibility='INSTITUTIONAL' AND OLD.status='APPROVED' AND (NEW.title,NEW.formula,NEW.category,NEW.description,NEW.visibility,NEW.status,NEW.unit_ids) IS DISTINCT FROM (OLD.title,OLD.formula,OLD.category,OLD.description,OLD.visibility,OLD.status,OLD.unit_ids) THEN RAISE EXCEPTION 'Approved institutional content is immutable'; END IF;
   IF OLD.status='PENDING' AND (NEW.title,NEW.formula,NEW.category,NEW.description,NEW.visibility,NEW.unit_ids) IS DISTINCT FROM (OLD.title,OLD.formula,OLD.category,OLD.description,OLD.visibility,OLD.unit_ids) THEN RAISE EXCEPTION 'Pending content is immutable'; END IF;
   IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='DRAFT' AND NEW.status='PENDING') OR (OLD.status='PENDING' AND NEW.status IN ('APPROVED','DRAFT'))) THEN RAISE EXCEPTION 'Invalid approval transition'; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_memberships m WHERE m.user_id=NEW.author_user_id AND m.organization_id=NEW.organization_id AND m.active) THEN RAISE EXCEPTION 'Invalid protocol author'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM inventory_prescription_protocols p WHERE p.id=NEW.protocol_id AND (p.organization_id,p.author_user_id,p.version,p.title,p.formula,p.archived,p.category,p.description,p.visibility,p.status,p.unit_ids) IS NOT DISTINCT FROM (NEW.organization_id,NEW.author_user_id,NEW.version,NEW.title,NEW.formula,NEW.archived,NEW.category,NEW.description,NEW.visibility,NEW.status,NEW.unit_ids)) THEN RAISE EXCEPTION 'Invalid protocol snapshot'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION inventory_validate_protocol_governance() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Protocol governance cannot be deleted'; END IF;
 IF TG_TABLE_NAME='inventory_prescription_protocol_grants' THEN
  IF NOT EXISTS(SELECT 1 FROM inventory_prescription_protocols p WHERE p.id=NEW.protocol_id AND p.organization_id=NEW.organization_id AND p.author_user_id=NEW.granted_by_user_id AND p.visibility='PRIVATE') THEN RAISE EXCEPTION 'Invalid private grant origin'; END IF;
  IF NEW.active AND NOT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE m.user_id=NEW.grantee_user_id AND m.organization_id=NEW.organization_id AND m.active AND u.active AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN')) THEN RAISE EXCEPTION 'Invalid private grantee'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.id,NEW.organization_id,NEW.protocol_id,NEW.grantee_user_id,NEW.granted_by_user_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.protocol_id,OLD.grantee_user_id,OLD.granted_by_user_id,OLD.created_at) OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Immutable grant origin'; END IF;
 ELSIF TG_TABLE_NAME='inventory_prescription_protocol_events' THEN
  IF NOT EXISTS(SELECT 1 FROM inventory_prescription_protocols p WHERE p.id=NEW.protocol_id AND p.organization_id=NEW.organization_id AND NEW.after_data->>'id'=p.id::text AND (NEW.after_data->>'version')::int=p.version) OR NOT EXISTS(SELECT 1 FROM inventory_memberships m WHERE m.user_id=NEW.actor_user_id AND m.organization_id=NEW.organization_id AND m.active) THEN RAISE EXCEPTION 'Invalid protocol event scope'; END IF;
  IF NEW.action IN ('APPROVE','REJECT') AND NOT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id JOIN inventory_prescription_protocols p ON p.id=NEW.protocol_id WHERE m.user_id=NEW.actor_user_id AND m.organization_id=NEW.organization_id AND m.active AND m.role='SUPER_ADMIN' AND p.author_user_id<>NEW.actor_user_id AND u.professional_council='CRM' AND inventory_professional_registration_state(u.id,m.organization_id)='OK') THEN RAISE EXCEPTION 'Invalid independent clinical reviewer'; END IF;
 ELSIF TG_TABLE_NAME='inventory_prescription_protocol_instances' THEN
  IF NOT EXISTS(SELECT 1 FROM inventory_encounter_documents d WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.appointment_id=NEW.appointment_id AND d.author_user_id=NEW.author_user_id AND d.type='PRESCRIPTION' AND d.status='DRAFT') OR jsonb_typeof(NEW.formula)<>'object' THEN RAISE EXCEPTION 'Invalid editable document instance'; END IF;
  IF (NEW.source_protocol_id IS NULL)<>(NEW.source_version IS NULL) THEN RAISE EXCEPTION 'Incomplete source revision'; END IF;
  IF NEW.source_protocol_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_prescription_protocol_versions v JOIN inventory_prescription_protocols p ON p.id=v.protocol_id WHERE v.protocol_id=NEW.source_protocol_id AND v.version=NEW.source_version AND v.organization_id=NEW.organization_id AND p.version=v.version AND NOT p.archived) THEN RAISE EXCEPTION 'Invalid source revision'; END IF;
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER protocol_grants_validate BEFORE INSERT OR UPDATE OR DELETE ON inventory_prescription_protocol_grants FOR EACH ROW EXECUTE FUNCTION inventory_validate_protocol_governance();

--> statement-breakpoint
CREATE TRIGGER protocol_grants_no_truncate BEFORE TRUNCATE ON inventory_prescription_protocol_grants FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();

--> statement-breakpoint
CREATE TRIGGER protocol_events_validate BEFORE INSERT ON inventory_prescription_protocol_events FOR EACH ROW EXECUTE FUNCTION inventory_validate_protocol_governance();

--> statement-breakpoint
CREATE TRIGGER protocol_events_no_truncate BEFORE TRUNCATE ON inventory_prescription_protocol_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();

--> statement-breakpoint
CREATE TRIGGER protocol_events_immutable BEFORE UPDATE OR DELETE ON inventory_prescription_protocol_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();

--> statement-breakpoint
CREATE TRIGGER protocol_instances_validate BEFORE INSERT ON inventory_prescription_protocol_instances FOR EACH ROW EXECUTE FUNCTION inventory_validate_protocol_governance();

--> statement-breakpoint
CREATE TRIGGER protocol_instances_no_truncate BEFORE TRUNCATE ON inventory_prescription_protocol_instances FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();

--> statement-breakpoint
CREATE TRIGGER protocol_instances_immutable BEFORE UPDATE OR DELETE ON inventory_prescription_protocol_instances FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
