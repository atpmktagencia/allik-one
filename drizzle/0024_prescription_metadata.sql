ALTER TABLE "inventory_patient_prescriptions" ADD COLUMN "prescriber_name" text;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD COLUMN "council_number" text;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD COLUMN "council_region" text;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD COLUMN "issued_on" date;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD COLUMN "valid_until" date;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD COLUMN "document_status" text DEFAULT 'ACTIVE' NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD COLUMN "supersedes_id" uuid;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD CONSTRAINT "inventory_patient_prescriptions_supersedes_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "inventory_patient_prescriptions"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD CONSTRAINT "patient_prescription_status_valid" CHECK ("document_status" IN ('ACTIVE','SUPERSEDED','REVOKED'));
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD CONSTRAINT "patient_prescription_version_positive" CHECK ("version" > 0);
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD CONSTRAINT "patient_prescription_dates_valid" CHECK ("issued_on" IS NULL OR ("valid_until" IS NOT NULL AND "valid_until" >= "issued_on"));
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD CONSTRAINT "patient_prescription_metadata_complete" CHECK (("prescriber_name" IS NULL AND "council_number" IS NULL AND "council_region" IS NULL AND "issued_on" IS NULL AND "valid_until" IS NULL) OR ("prescriber_name" IS NOT NULL AND char_length(trim("prescriber_name")) BETWEEN 2 AND 150 AND "council_number" IS NOT NULL AND char_length(trim("council_number")) BETWEEN 3 AND 30 AND "council_region" IS NOT NULL AND char_length(trim("council_region")) BETWEEN 2 AND 10 AND "issued_on" IS NOT NULL AND "valid_until" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD CONSTRAINT "patient_prescription_not_self_superseding" CHECK ("supersedes_id" IS NULL OR "supersedes_id" <> "id");
--> statement-breakpoint
CREATE INDEX "inventory_patient_prescription_treatment_status_validity"
  ON "inventory_patient_prescriptions" ("treatment_id","document_status","issued_on","valid_until");
--> statement-breakpoint
CREATE TABLE "inventory_patient_prescription_access" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "prescription_id" uuid NOT NULL,
  "actor" text NOT NULL,
  "actor_user_id" uuid,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescription_access" ADD CONSTRAINT "inventory_patient_prescription_access_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescription_access" ADD CONSTRAINT "inventory_patient_prescription_access_prescription_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "inventory_patient_prescriptions"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescription_access" ADD CONSTRAINT "inventory_patient_prescription_access_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX "inventory_patient_prescription_access_history" ON "inventory_patient_prescription_access" ("prescription_id","accessed_at");
--> statement-breakpoint
CREATE TRIGGER inventory_patient_prescription_access_immutable BEFORE UPDATE OR DELETE ON "inventory_patient_prescription_access" FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
