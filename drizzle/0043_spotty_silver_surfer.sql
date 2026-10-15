CREATE TABLE "inventory_encounter_quote_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "encounter_quote_change_action_valid" CHECK ("inventory_encounter_quote_changes"."action" IN ('CREATE','UPDATE','ISSUE'))
);
--> statement-breakpoint
CREATE TABLE "inventory_encounter_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commercial_notes" text DEFAULT '' NOT NULL,
	"total_sale" numeric(14, 2) DEFAULT '0' NOT NULL,
	"estimated_cost" numeric(14, 4) DEFAULT '0' NOT NULL,
	"gross_result" numeric(14, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_encounter_quotes_appointment_id_unique" UNIQUE("appointment_id"),
	CONSTRAINT "inventory_encounter_quotes_prescription_id_unique" UNIQUE("prescription_id"),
	CONSTRAINT "encounter_quote_status_valid" CHECK ("inventory_encounter_quotes"."status" IN ('DRAFT','ISSUED')),
	CONSTRAINT "encounter_quote_version_nonnegative" CHECK ("inventory_encounter_quotes"."version">=0),
	CONSTRAINT "encounter_quote_totals_nonnegative" CHECK ("inventory_encounter_quotes"."total_sale">=0 AND "inventory_encounter_quotes"."estimated_cost">=0),
	CONSTRAINT "encounter_quote_items_valid" CHECK (jsonb_typeof("inventory_encounter_quotes"."items")='array' AND jsonb_array_length("inventory_encounter_quotes"."items")<=50),
	CONSTRAINT "encounter_quote_notes_valid" CHECK (char_length("inventory_encounter_quotes"."commercial_notes")<=3000),
	CONSTRAINT "encounter_quote_issued_valid" CHECK (("inventory_encounter_quotes"."status"='DRAFT' AND "inventory_encounter_quotes"."issued_at" IS NULL) OR ("inventory_encounter_quotes"."status"='ISSUED' AND "inventory_encounter_quotes"."issued_at" IS NOT NULL AND jsonb_array_length("inventory_encounter_quotes"."items")>0))
);
--> statement-breakpoint
ALTER TABLE "inventory_encounter_quote_changes" ADD CONSTRAINT "inventory_encounter_quote_changes_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quote_changes" ADD CONSTRAINT "inventory_encounter_quote_changes_quote_id_inventory_encounter_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."inventory_encounter_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quote_changes" ADD CONSTRAINT "inventory_encounter_quote_changes_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD CONSTRAINT "inventory_encounter_quotes_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD CONSTRAINT "inventory_encounter_quotes_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD CONSTRAINT "inventory_encounter_quotes_appointment_id_inventory_care_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."inventory_care_appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD CONSTRAINT "inventory_encounter_quotes_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD CONSTRAINT "inventory_encounter_quotes_prescription_id_inventory_encounter_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."inventory_encounter_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD CONSTRAINT "inventory_encounter_quotes_created_by_user_id_inventory_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "encounter_quote_change_history" ON "inventory_encounter_quote_changes" USING btree ("quote_id","created_at");--> statement-breakpoint
CREATE INDEX "encounter_quote_patient_history" ON "inventory_encounter_quotes" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "encounter_quote_unit_history" ON "inventory_encounter_quotes" USING btree ("unit_id","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_protect_encounter_quote() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'encounter quotes cannot be deleted';
  END IF;
  IF OLD.status = 'ISSUED' THEN
    RAISE EXCEPTION 'issued encounter quotes are immutable';
  END IF;
  IF NEW.organization_id <> OLD.organization_id OR NEW.unit_id <> OLD.unit_id
     OR NEW.appointment_id <> OLD.appointment_id OR NEW.patient_id <> OLD.patient_id
     OR NEW.prescription_id <> OLD.prescription_id OR NEW.created_by_user_id <> OLD.created_by_user_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'encounter quote identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inventory_encounter_quote_protect
BEFORE UPDATE OR DELETE ON "inventory_encounter_quotes"
FOR EACH ROW EXECUTE FUNCTION inventory_protect_encounter_quote();
--> statement-breakpoint
CREATE TRIGGER inventory_encounter_quote_change_immutable
BEFORE UPDATE OR DELETE ON "inventory_encounter_quote_changes"
FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
