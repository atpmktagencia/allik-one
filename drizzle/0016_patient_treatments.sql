CREATE TABLE "inventory_patient_treatments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "dose_quantity" numeric(18,6) NOT NULL,
  "dose_unit" text NOT NULL,
  "route" text NOT NULL,
  "frequency_every_days" numeric(10,2) NOT NULL,
  "first_scheduled_on" date NOT NULL,
  "planned_administrations" integer,
  "status" text DEFAULT 'PLANNED' NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "patient_treatment_dose_positive" CHECK ("dose_quantity" > 0),
  CONSTRAINT "patient_treatment_unit_valid" CHECK ("dose_unit" IN ('MG','ML','UI','UNIT')),
  CONSTRAINT "patient_treatment_route_valid" CHECK (char_length(trim("route")) BETWEEN 2 AND 40),
  CONSTRAINT "patient_treatment_frequency_positive" CHECK ("frequency_every_days" > 0),
  CONSTRAINT "patient_treatment_count_positive" CHECK ("planned_administrations" IS NULL OR "planned_administrations" > 0),
  CONSTRAINT "patient_treatment_status_valid" CHECK ("status" IN ('PLANNED','ACTIVE','PAUSED','COMPLETED','CANCELED')),
  CONSTRAINT "patient_treatment_version_nonnegative" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE INDEX "inventory_patient_treatment_patient_status" ON "inventory_patient_treatments" ("patient_id","status","first_scheduled_on");
--> statement-breakpoint
CREATE INDEX "inventory_patient_treatment_unit_product" ON "inventory_patient_treatments" ("unit_id","product_id");
--> statement-breakpoint
CREATE INDEX "inventory_patient_treatment_organization" ON "inventory_patient_treatments" ("organization_id","created_at");
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ADD CONSTRAINT "inventory_patient_treatments_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ADD CONSTRAINT "inventory_patient_treatments_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "inventory_patients"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ADD CONSTRAINT "inventory_patient_treatments_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ADD CONSTRAINT "inventory_patient_treatments_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ADD CONSTRAINT "inventory_patient_treatments_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ADD CONSTRAINT "inventory_patient_treatments_updated_by_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "inventory_patient_prescriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "treatment_id" uuid,
  "blob_pathname" text NOT NULL UNIQUE,
  "original_filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "uploaded_by_user_id" uuid,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "patient_prescription_filename_valid" CHECK (char_length(trim("original_filename")) BETWEEN 1 AND 180),
  CONSTRAINT "patient_prescription_type_valid" CHECK ("content_type" IN ('application/pdf','image/jpeg','image/png','image/heic','image/heif')),
  CONSTRAINT "patient_prescription_size_valid" CHECK ("size_bytes" BETWEEN 1 AND 10485760)
);
--> statement-breakpoint
CREATE INDEX "inventory_patient_prescription_patient" ON "inventory_patient_prescriptions" ("patient_id","uploaded_at");
--> statement-breakpoint
CREATE INDEX "inventory_patient_prescription_treatment" ON "inventory_patient_prescriptions" ("treatment_id");
--> statement-breakpoint
CREATE INDEX "inventory_patient_prescription_organization" ON "inventory_patient_prescriptions" ("organization_id","uploaded_at");
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD CONSTRAINT "inventory_patient_prescriptions_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD CONSTRAINT "inventory_patient_prescriptions_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "inventory_patients"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD CONSTRAINT "inventory_patient_prescriptions_treatment_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "inventory_patient_treatments"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_prescriptions" ADD CONSTRAINT "inventory_patient_prescriptions_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "inventory_patient_treatment_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "treatment_id" uuid NOT NULL,
  "action" text NOT NULL,
  "before_data" jsonb,
  "after_data" jsonb NOT NULL,
  "reason" text NOT NULL,
  "actor" text NOT NULL,
  "actor_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "patient_treatment_change_action_valid" CHECK ("action" IN ('CREATE','UPDATE','UPLOAD_PRESCRIPTION')),
  CONSTRAINT "patient_treatment_change_reason_valid" CHECK (char_length(trim("reason")) BETWEEN 10 AND 500)
);
--> statement-breakpoint
CREATE INDEX "inventory_patient_treatment_change_history" ON "inventory_patient_treatment_changes" ("treatment_id","created_at");
--> statement-breakpoint
CREATE INDEX "inventory_patient_treatment_change_organization" ON "inventory_patient_treatment_changes" ("organization_id","created_at");
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_changes" ADD CONSTRAINT "inventory_patient_treatment_changes_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_changes" ADD CONSTRAINT "inventory_patient_treatment_changes_treatment_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "inventory_patient_treatments"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_changes" ADD CONSTRAINT "inventory_patient_treatment_changes_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TRIGGER patient_treatment_change_immutable BEFORE UPDATE OR DELETE ON inventory_patient_treatment_changes FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
