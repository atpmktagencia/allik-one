CREATE TABLE "inventory_patient_clinical_alert_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"alert_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_alert_change_action_valid" CHECK ("inventory_patient_clinical_alert_changes"."action" IN ('CREATE','UPDATE')),
	CONSTRAINT "clinical_alert_change_reason_valid" CHECK (char_length(trim("inventory_patient_clinical_alert_changes"."reason")) BETWEEN 10 AND 500)
);
--> statement-breakpoint
CREATE TABLE "inventory_patient_clinical_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"reaction" text,
	"severity" text DEFAULT 'UNKNOWN' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"professional_council" text NOT NULL,
	"council_number" text NOT NULL,
	"council_region" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_alert_type_valid" CHECK ("inventory_patient_clinical_alerts"."type" IN ('ALLERGY','WARNING','PRECAUTION')),
	CONSTRAINT "clinical_alert_title_valid" CHECK (char_length(trim("inventory_patient_clinical_alerts"."title")) BETWEEN 2 AND 200),
	CONSTRAINT "clinical_alert_reaction_valid" CHECK ("inventory_patient_clinical_alerts"."reaction" IS NULL OR char_length(trim("inventory_patient_clinical_alerts"."reaction")) BETWEEN 2 AND 500),
	CONSTRAINT "clinical_alert_severity_valid" CHECK ("inventory_patient_clinical_alerts"."severity" IN ('UNKNOWN','MILD','MODERATE','SEVERE')),
	CONSTRAINT "clinical_alert_status_valid" CHECK ("inventory_patient_clinical_alerts"."status" IN ('ACTIVE','INACTIVE')),
	CONSTRAINT "clinical_alert_notes_valid" CHECK (char_length("inventory_patient_clinical_alerts"."notes")<=2000),
	CONSTRAINT "clinical_alert_version_nonnegative" CHECK ("inventory_patient_clinical_alerts"."version">=0)
);
--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_alert_changes" ADD CONSTRAINT "inventory_patient_clinical_alert_changes_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_alert_changes" ADD CONSTRAINT "inventory_patient_clinical_alert_changes_alert_id_inventory_patient_clinical_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."inventory_patient_clinical_alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_alert_changes" ADD CONSTRAINT "inventory_patient_clinical_alert_changes_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_alerts" ADD CONSTRAINT "inventory_patient_clinical_alerts_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_alerts" ADD CONSTRAINT "inventory_patient_clinical_alerts_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_alerts" ADD CONSTRAINT "inventory_patient_clinical_alerts_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_alerts" ADD CONSTRAINT "inventory_patient_clinical_alerts_author_user_id_inventory_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_alert_change_history" ON "inventory_patient_clinical_alert_changes" USING btree ("alert_id","created_at");--> statement-breakpoint
CREATE INDEX "clinical_alert_patient_status" ON "inventory_patient_clinical_alerts" USING btree ("patient_id","status","severity");--> statement-breakpoint
CREATE INDEX "clinical_alert_unit_history" ON "inventory_patient_clinical_alerts" USING btree ("unit_id","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_protect_clinical_alert() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinical alerts cannot be deleted';
  END IF;
  IF NEW.organization_id <> OLD.organization_id OR NEW.unit_id <> OLD.unit_id
     OR NEW.patient_id <> OLD.patient_id OR NEW.author_user_id <> OLD.author_user_id
     OR NEW.author_name <> OLD.author_name OR NEW.professional_council <> OLD.professional_council
     OR NEW.council_number <> OLD.council_number OR NEW.council_region <> OLD.council_region
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'clinical alert identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inventory_clinical_alert_protect BEFORE UPDATE OR DELETE ON "inventory_patient_clinical_alerts" FOR EACH ROW EXECUTE FUNCTION inventory_protect_clinical_alert();
--> statement-breakpoint
CREATE TRIGGER inventory_clinical_alert_change_immutable BEFORE UPDATE OR DELETE ON "inventory_patient_clinical_alert_changes" FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
