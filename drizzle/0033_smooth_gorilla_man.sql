CREATE TABLE "inventory_clinical_note_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"clinical_note_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_note_change_action_valid" CHECK ("inventory_clinical_note_changes"."action" IN ('CREATE','UPDATE','FINALIZE'))
);
--> statement-breakpoint
CREATE TABLE "inventory_clinical_notes" (
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
	"evolution" text DEFAULT '' NOT NULL,
	"conduct" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_clinical_notes_appointment_id_unique" UNIQUE("appointment_id"),
	CONSTRAINT "clinical_note_status_valid" CHECK ("inventory_clinical_notes"."status" IN ('DRAFT','FINAL')),
	CONSTRAINT "clinical_note_version_nonnegative" CHECK ("inventory_clinical_notes"."version">=0),
	CONSTRAINT "clinical_note_evolution_valid" CHECK (char_length("inventory_clinical_notes"."evolution")<=20000),
	CONSTRAINT "clinical_note_conduct_valid" CHECK (char_length("inventory_clinical_notes"."conduct")<=10000),
	CONSTRAINT "clinical_note_final_valid" CHECK (("inventory_clinical_notes"."status"='DRAFT' AND "inventory_clinical_notes"."finalized_at" IS NULL) OR ("inventory_clinical_notes"."status"='FINAL' AND "inventory_clinical_notes"."finalized_at" IS NOT NULL AND char_length(trim("inventory_clinical_notes"."evolution"))>=10))
);
--> statement-breakpoint
ALTER TABLE "inventory_clinical_note_changes" ADD CONSTRAINT "inventory_clinical_note_changes_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_note_changes" ADD CONSTRAINT "inventory_clinical_note_changes_clinical_note_id_inventory_clinical_notes_id_fk" FOREIGN KEY ("clinical_note_id") REFERENCES "public"."inventory_clinical_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_note_changes" ADD CONSTRAINT "inventory_clinical_note_changes_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "inventory_clinical_notes_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "inventory_clinical_notes_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "inventory_clinical_notes_appointment_id_inventory_care_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."inventory_care_appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "inventory_clinical_notes_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "inventory_clinical_notes_author_user_id_inventory_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_note_change_history" ON "inventory_clinical_note_changes" USING btree ("clinical_note_id","created_at");--> statement-breakpoint
CREATE INDEX "clinical_note_patient_history" ON "inventory_clinical_notes" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "clinical_note_unit_history" ON "inventory_clinical_notes" USING btree ("unit_id","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_protect_clinical_note() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinical notes cannot be deleted';
  END IF;
  IF OLD.status = 'FINAL' THEN
    RAISE EXCEPTION 'final clinical notes are immutable';
  END IF;
  IF NEW.organization_id <> OLD.organization_id OR NEW.unit_id <> OLD.unit_id
     OR NEW.appointment_id <> OLD.appointment_id OR NEW.patient_id <> OLD.patient_id
     OR NEW.author_user_id <> OLD.author_user_id OR NEW.author_name <> OLD.author_name
     OR NEW.professional_council <> OLD.professional_council
     OR NEW.council_number <> OLD.council_number OR NEW.council_region <> OLD.council_region
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'clinical note identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inventory_clinical_note_protect BEFORE UPDATE OR DELETE ON "inventory_clinical_notes" FOR EACH ROW EXECUTE FUNCTION inventory_protect_clinical_note();
--> statement-breakpoint
CREATE TRIGGER inventory_clinical_note_change_immutable BEFORE UPDATE OR DELETE ON "inventory_clinical_note_changes" FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
