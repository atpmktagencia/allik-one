ALTER TABLE "inventory_patient_treatment_schedule"
  ADD COLUMN "attendance_status" text DEFAULT 'SCHEDULED' NOT NULL;
--> statement-breakpoint
UPDATE "inventory_patient_treatment_schedule"
SET "attendance_status" = CASE
  WHEN "status" = 'CONSUMED' THEN 'COMPLETED'
  WHEN "status" = 'CANCELED' THEN 'CANCELED'
  ELSE 'SCHEDULED'
END;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_schedule"
  ADD CONSTRAINT "patient_schedule_attendance_status_valid"
  CHECK ("attendance_status" IN ('SCHEDULED','CONFIRMED','COMPLETED','CANCELED','NO_SHOW'));
