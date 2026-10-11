CREATE TABLE "inventory_patients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "primary_unit_id" uuid NOT NULL,
  "internal_code" text NOT NULL,
  "full_name" text NOT NULL,
  "phone" text,
  "email" text,
  "active" boolean DEFAULT true NOT NULL,
  "consent_status" text DEFAULT 'PENDING' NOT NULL,
  "consent_recorded_at" timestamp with time zone,
  "consent_recorded_by_user_id" uuid,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "patient_internal_code_valid" CHECK (char_length(trim("internal_code")) BETWEEN 3 AND 40),
  CONSTRAINT "patient_name_valid" CHECK (char_length(trim("full_name")) BETWEEN 3 AND 180),
  CONSTRAINT "patient_phone_valid" CHECK ("phone" IS NULL OR char_length(trim("phone")) BETWEEN 8 AND 30),
  CONSTRAINT "patient_email_valid" CHECK ("email" IS NULL OR char_length(trim("email")) BETWEEN 5 AND 254),
  CONSTRAINT "patient_consent_status_valid" CHECK ("consent_status" IN ('PENDING','RECORDED','REVOKED')),
  CONSTRAINT "patient_consent_evidence_valid" CHECK (
    ("consent_status" = 'PENDING' AND "consent_recorded_at" IS NULL AND "consent_recorded_by_user_id" IS NULL)
    OR ("consent_status" IN ('RECORDED','REVOKED') AND "consent_recorded_at" IS NOT NULL)
  ),
  CONSTRAINT "patient_version_nonnegative" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_patient_internal_code_unique"
  ON "inventory_patients" USING btree ("organization_id",lower("internal_code"));
--> statement-breakpoint
CREATE INDEX "inventory_patient_unit_active_name"
  ON "inventory_patients" USING btree ("primary_unit_id","active",lower("full_name"));
--> statement-breakpoint
CREATE INDEX "inventory_patient_organization"
  ON "inventory_patients" USING btree ("organization_id","created_at");
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD CONSTRAINT "inventory_patients_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD CONSTRAINT "inventory_patients_primary_unit_id_fk"
  FOREIGN KEY ("primary_unit_id") REFERENCES "inventory_units"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD CONSTRAINT "inventory_patients_consent_user_id_fk"
  FOREIGN KEY ("consent_recorded_by_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD CONSTRAINT "inventory_patients_created_by_user_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD CONSTRAINT "inventory_patients_updated_by_user_id_fk"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "inventory_patient_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "action" text NOT NULL,
  "before_data" jsonb,
  "after_data" jsonb NOT NULL,
  "reason" text NOT NULL,
  "actor" text NOT NULL,
  "actor_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "patient_change_action_valid" CHECK ("action" IN ('CREATE','UPDATE')),
  CONSTRAINT "patient_change_reason_valid" CHECK (char_length(trim("reason")) BETWEEN 10 AND 500)
);
--> statement-breakpoint
CREATE INDEX "inventory_patient_change_history"
  ON "inventory_patient_changes" USING btree ("patient_id","created_at");
--> statement-breakpoint
CREATE INDEX "inventory_patient_change_organization"
  ON "inventory_patient_changes" USING btree ("organization_id","created_at");
--> statement-breakpoint
ALTER TABLE "inventory_patient_changes" ADD CONSTRAINT "inventory_patient_changes_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_changes" ADD CONSTRAINT "inventory_patient_changes_patient_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "inventory_patients"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_changes" ADD CONSTRAINT "inventory_patient_changes_actor_user_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TRIGGER patient_change_immutable BEFORE UPDATE OR DELETE ON inventory_patient_changes
  FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
