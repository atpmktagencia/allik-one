ALTER TABLE "inventory_patient_applications" ADD COLUMN "prescription_id" uuid;
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD COLUMN "route" text;
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD COLUMN "dose_volume_ml" numeric(18,6);
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD COLUMN "occurrence_notes" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "inventory_patient_applications_prescription_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "inventory_patient_prescriptions"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "patient_application_volume_positive" CHECK ("dose_volume_ml" IS NULL OR "dose_volume_ml" > 0);
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "patient_application_route_valid" CHECK ("route" IS NULL OR char_length(trim("route")) BETWEEN 2 AND 40);
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "patient_application_occurrence_valid" CHECK (char_length("occurrence_notes") <= 1000);
