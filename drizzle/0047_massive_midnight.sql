CREATE TABLE "inventory_clinical_document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_document_template_type_valid" CHECK ("inventory_clinical_document_templates"."type" IN ('PRESCRIPTION','EXAM_REQUEST')),
	CONSTRAINT "clinical_document_template_text_valid" CHECK (char_length(trim("inventory_clinical_document_templates"."title")) BETWEEN 2 AND 200 AND char_length(trim("inventory_clinical_document_templates"."content")) BETWEEN 1 AND 30000)
);
--> statement-breakpoint
CREATE TABLE "inventory_encounter_document_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "encounter_document_change_action_valid" CHECK ("inventory_encounter_document_changes"."action" IN ('CREATE','UPDATE','FINALIZE'))
);
--> statement-breakpoint
CREATE TABLE "inventory_encounter_documents" (
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
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "encounter_document_type_valid" CHECK ("inventory_encounter_documents"."type" IN ('PRESCRIPTION','EXAM_REQUEST')),
	CONSTRAINT "encounter_document_status_valid" CHECK ("inventory_encounter_documents"."status" IN ('DRAFT','FINAL')),
	CONSTRAINT "encounter_document_version_valid" CHECK ("inventory_encounter_documents"."version">=0),
	CONSTRAINT "encounter_document_text_valid" CHECK (char_length(trim("inventory_encounter_documents"."title")) BETWEEN 2 AND 200 AND char_length("inventory_encounter_documents"."content")<=30000),
	CONSTRAINT "encounter_document_final_valid" CHECK (("inventory_encounter_documents"."status"='DRAFT' AND "inventory_encounter_documents"."finalized_at" IS NULL) OR ("inventory_encounter_documents"."status"='FINAL' AND "inventory_encounter_documents"."finalized_at" IS NOT NULL AND char_length(trim("inventory_encounter_documents"."content"))>0))
);
--> statement-breakpoint
ALTER TABLE "inventory_clinical_document_templates" ADD CONSTRAINT "inventory_clinical_document_templates_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_document_templates" ADD CONSTRAINT "inventory_clinical_document_templates_owner_user_id_inventory_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_document_changes" ADD CONSTRAINT "inventory_encounter_document_changes_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_document_changes" ADD CONSTRAINT "inventory_encounter_document_changes_document_id_inventory_encounter_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."inventory_encounter_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_document_changes" ADD CONSTRAINT "inventory_encounter_document_changes_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_documents" ADD CONSTRAINT "inventory_encounter_documents_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_documents" ADD CONSTRAINT "inventory_encounter_documents_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_documents" ADD CONSTRAINT "inventory_encounter_documents_appointment_id_inventory_care_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."inventory_care_appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_documents" ADD CONSTRAINT "inventory_encounter_documents_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_documents" ADD CONSTRAINT "inventory_encounter_documents_author_user_id_inventory_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_document_template_owner" ON "inventory_clinical_document_templates" USING btree ("organization_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "encounter_document_change_history" ON "inventory_encounter_document_changes" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "encounter_document_history" ON "inventory_encounter_documents" USING btree ("appointment_id","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_protect_encounter_document() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'encounter documents cannot be deleted'; END IF;
  IF OLD.status = 'FINAL' THEN RAISE EXCEPTION 'final encounter documents are immutable'; END IF;
  IF NEW.organization_id <> OLD.organization_id OR NEW.unit_id <> OLD.unit_id
     OR NEW.appointment_id <> OLD.appointment_id OR NEW.patient_id <> OLD.patient_id
     OR NEW.author_user_id <> OLD.author_user_id OR NEW.author_name <> OLD.author_name
     OR NEW.professional_council <> OLD.professional_council
     OR NEW.council_number <> OLD.council_number OR NEW.council_region <> OLD.council_region
     OR NEW.type <> OLD.type OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'encounter document identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inventory_encounter_document_protect BEFORE UPDATE OR DELETE ON inventory_encounter_documents
FOR EACH ROW EXECUTE FUNCTION inventory_protect_encounter_document();
--> statement-breakpoint
CREATE TRIGGER inventory_encounter_document_change_immutable BEFORE UPDATE OR DELETE ON inventory_encounter_document_changes
FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER inventory_clinical_document_template_immutable BEFORE UPDATE OR DELETE ON inventory_clinical_document_templates
FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
