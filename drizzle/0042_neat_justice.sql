CREATE TABLE "inventory_encounter_prescription_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "encounter_prescription_change_action_valid" CHECK ("inventory_encounter_prescription_changes"."action" IN ('CREATE','UPDATE','FINALIZE'))
);
--> statement-breakpoint
CREATE TABLE "inventory_encounter_prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"professional_council" text NOT NULL,
	"council_number" text NOT NULL,
	"council_region" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"general_instructions" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_encounter_prescriptions_appointment_id_unique" UNIQUE("appointment_id"),
	CONSTRAINT "encounter_prescription_status_valid" CHECK ("inventory_encounter_prescriptions"."status" IN ('DRAFT','FINAL')),
	CONSTRAINT "encounter_prescription_version_nonnegative" CHECK ("inventory_encounter_prescriptions"."version">=0),
	CONSTRAINT "encounter_prescription_items_valid" CHECK (jsonb_typeof("inventory_encounter_prescriptions"."items")='array' AND jsonb_array_length("inventory_encounter_prescriptions"."items")<=50),
	CONSTRAINT "encounter_prescription_instructions_valid" CHECK (char_length("inventory_encounter_prescriptions"."general_instructions")<=5000),
	CONSTRAINT "encounter_prescription_final_valid" CHECK (("inventory_encounter_prescriptions"."status"='DRAFT' AND "inventory_encounter_prescriptions"."finalized_at" IS NULL) OR ("inventory_encounter_prescriptions"."status"='FINAL' AND "inventory_encounter_prescriptions"."finalized_at" IS NOT NULL AND jsonb_array_length("inventory_encounter_prescriptions"."items")>0))
);
--> statement-breakpoint
ALTER TABLE "inventory_encounter_prescription_changes" ADD CONSTRAINT "inventory_encounter_prescription_changes_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_prescription_changes" ADD CONSTRAINT "inventory_encounter_prescription_changes_prescription_id_inventory_encounter_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."inventory_encounter_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_prescription_changes" ADD CONSTRAINT "inventory_encounter_prescription_changes_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_prescriptions" ADD CONSTRAINT "inventory_encounter_prescriptions_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_prescriptions" ADD CONSTRAINT "inventory_encounter_prescriptions_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_prescriptions" ADD CONSTRAINT "inventory_encounter_prescriptions_appointment_id_inventory_care_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."inventory_care_appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_prescriptions" ADD CONSTRAINT "inventory_encounter_prescriptions_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_prescriptions" ADD CONSTRAINT "inventory_encounter_prescriptions_author_user_id_inventory_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "encounter_prescription_change_history" ON "inventory_encounter_prescription_changes" USING btree ("prescription_id","created_at");--> statement-breakpoint
CREATE INDEX "encounter_prescription_patient_history" ON "inventory_encounter_prescriptions" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "encounter_prescription_unit_history" ON "inventory_encounter_prescriptions" USING btree ("unit_id","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_protect_encounter_prescription() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'encounter prescriptions cannot be deleted';
  END IF;
  IF OLD.status = 'FINAL' THEN
    RAISE EXCEPTION 'final encounter prescriptions are immutable';
  END IF;
  IF NEW.organization_id <> OLD.organization_id OR NEW.unit_id <> OLD.unit_id
     OR NEW.appointment_id <> OLD.appointment_id OR NEW.patient_id <> OLD.patient_id
     OR NEW.author_user_id <> OLD.author_user_id OR NEW.author_name <> OLD.author_name
     OR NEW.professional_council <> OLD.professional_council
     OR NEW.council_number <> OLD.council_number OR NEW.council_region <> OLD.council_region
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'encounter prescription identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inventory_encounter_prescription_protect
BEFORE UPDATE OR DELETE ON "inventory_encounter_prescriptions"
FOR EACH ROW EXECUTE FUNCTION inventory_protect_encounter_prescription();
--> statement-breakpoint
CREATE TRIGGER inventory_encounter_prescription_change_immutable
BEFORE UPDATE OR DELETE ON "inventory_encounter_prescription_changes"
FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
