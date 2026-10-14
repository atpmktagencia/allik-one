CREATE TABLE "inventory_clinical_access_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"document_id" uuid,
	"actor_user_id" uuid,
	"preview_actor" text,
	"action" text NOT NULL,
	"resource_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_access_action_valid" CHECK ("inventory_clinical_access_events"."action" IN ('READ','PRINT','PDF_SOURCE','SIGNED_DOWNLOAD')),
	CONSTRAINT "clinical_access_actor_valid" CHECK (("inventory_clinical_access_events"."actor_user_id" IS NOT NULL AND "inventory_clinical_access_events"."preview_actor" IS NULL) OR ("inventory_clinical_access_events"."actor_user_id" IS NULL AND "inventory_clinical_access_events"."preview_actor" IS NOT NULL)),
	CONSTRAINT "clinical_access_resources_valid" CHECK (jsonb_typeof("inventory_clinical_access_events"."resource_ids")='array')
);
--> statement-breakpoint
ALTER TABLE "inventory_memberships" DROP CONSTRAINT "inventory_membership_role_valid";--> statement-breakpoint
ALTER TABLE "inventory_clinical_access_events" ADD CONSTRAINT "inventory_clinical_access_events_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_access_events" ADD CONSTRAINT "inventory_clinical_access_events_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_access_events" ADD CONSTRAINT "inventory_clinical_access_events_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_access_events" ADD CONSTRAINT "inventory_clinical_access_events_appointment_id_inventory_care_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."inventory_care_appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_access_events" ADD CONSTRAINT "inventory_clinical_access_events_document_id_inventory_encounter_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."inventory_encounter_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_access_events" ADD CONSTRAINT "inventory_clinical_access_events_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_access_patient_time" ON "inventory_clinical_access_events" USING btree ("organization_id","patient_id","created_at");--> statement-breakpoint
ALTER TABLE "inventory_memberships" ADD CONSTRAINT "inventory_membership_role_valid" CHECK ("inventory_memberships"."role" IN ('SUPER_ADMIN','PARTNER_ADMIN','INVENTORY_MANAGER','UNIT_MANAGER','CLINICIAN','FINANCE','VIEWER'));--> statement-breakpoint
CREATE TRIGGER clinical_access_event_immutable BEFORE UPDATE OR DELETE ON inventory_clinical_access_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER clinical_access_event_no_truncate BEFORE TRUNCATE ON inventory_clinical_access_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE FUNCTION inventory_guard_clinical_access_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM inventory_units u JOIN inventory_patients p ON p.organization_id=u.organization_id WHERE u.id=NEW.unit_id AND p.id=NEW.patient_id AND u.organization_id=NEW.organization_id)
 OR (NEW.appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_care_appointments a WHERE a.id=NEW.appointment_id AND a.organization_id=NEW.organization_id AND a.unit_id=NEW.unit_id AND a.patient_id=NEW.patient_id))
 OR (NEW.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_encounter_documents d WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.unit_id=NEW.unit_id AND d.patient_id=NEW.patient_id AND d.appointment_id=NEW.appointment_id))
 THEN RAISE EXCEPTION 'clinical access scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinical_access_event_scope BEFORE INSERT ON inventory_clinical_access_events FOR EACH ROW EXECUTE FUNCTION inventory_guard_clinical_access_scope();
