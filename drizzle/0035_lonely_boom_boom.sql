CREATE TABLE "inventory_patient_clinical_problem_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_problem_change_action_valid" CHECK ("inventory_patient_clinical_problem_changes"."action" IN ('CREATE','UPDATE')),
	CONSTRAINT "clinical_problem_change_reason_valid" CHECK (char_length(trim("inventory_patient_clinical_problem_changes"."reason")) BETWEEN 10 AND 500)
);
--> statement-breakpoint
CREATE TABLE "inventory_patient_clinical_problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"description" text NOT NULL,
	"icd10_code" text,
	"onset_on" date,
	"resolved_on" date,
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
	CONSTRAINT "clinical_problem_description_valid" CHECK (char_length(trim("inventory_patient_clinical_problems"."description")) BETWEEN 3 AND 300),
	CONSTRAINT "clinical_problem_icd_valid" CHECK ("inventory_patient_clinical_problems"."icd10_code" IS NULL OR "inventory_patient_clinical_problems"."icd10_code" ~ '^[A-Z][0-9]{2}(\.[A-Z0-9]{1,4})?$'),
	CONSTRAINT "clinical_problem_status_valid" CHECK ("inventory_patient_clinical_problems"."status" IN ('ACTIVE','RESOLVED','INACTIVE')),
	CONSTRAINT "clinical_problem_notes_valid" CHECK (char_length("inventory_patient_clinical_problems"."notes")<=2000),
	CONSTRAINT "clinical_problem_dates_valid" CHECK ("inventory_patient_clinical_problems"."resolved_on" IS NULL OR "inventory_patient_clinical_problems"."onset_on" IS NULL OR "inventory_patient_clinical_problems"."resolved_on">="inventory_patient_clinical_problems"."onset_on"),
	CONSTRAINT "clinical_problem_resolution_valid" CHECK ("inventory_patient_clinical_problems"."status"<>'RESOLVED' OR "inventory_patient_clinical_problems"."resolved_on" IS NOT NULL),
	CONSTRAINT "clinical_problem_version_nonnegative" CHECK ("inventory_patient_clinical_problems"."version">=0)
);
--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_problem_changes" ADD CONSTRAINT "inventory_patient_clinical_problem_changes_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_problem_changes" ADD CONSTRAINT "inventory_patient_clinical_problem_changes_problem_id_inventory_patient_clinical_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."inventory_patient_clinical_problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_problem_changes" ADD CONSTRAINT "inventory_patient_clinical_problem_changes_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_problems" ADD CONSTRAINT "inventory_patient_clinical_problems_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_problems" ADD CONSTRAINT "inventory_patient_clinical_problems_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_problems" ADD CONSTRAINT "inventory_patient_clinical_problems_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_clinical_problems" ADD CONSTRAINT "inventory_patient_clinical_problems_author_user_id_inventory_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_problem_change_history" ON "inventory_patient_clinical_problem_changes" USING btree ("problem_id","created_at");--> statement-breakpoint
CREATE INDEX "clinical_problem_patient_history" ON "inventory_patient_clinical_problems" USING btree ("patient_id","status","created_at");--> statement-breakpoint
CREATE INDEX "clinical_problem_unit_history" ON "inventory_patient_clinical_problems" USING btree ("unit_id","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_protect_clinical_problem() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinical problems cannot be deleted';
  END IF;
  IF NEW.organization_id <> OLD.organization_id OR NEW.unit_id <> OLD.unit_id
     OR NEW.patient_id <> OLD.patient_id OR NEW.author_user_id <> OLD.author_user_id
     OR NEW.author_name <> OLD.author_name OR NEW.professional_council <> OLD.professional_council
     OR NEW.council_number <> OLD.council_number OR NEW.council_region <> OLD.council_region
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'clinical problem identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inventory_clinical_problem_protect BEFORE UPDATE OR DELETE ON "inventory_patient_clinical_problems" FOR EACH ROW EXECUTE FUNCTION inventory_protect_clinical_problem();
--> statement-breakpoint
CREATE TRIGGER inventory_clinical_problem_change_immutable BEFORE UPDATE OR DELETE ON "inventory_patient_clinical_problem_changes" FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
