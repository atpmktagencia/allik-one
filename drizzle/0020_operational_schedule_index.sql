CREATE INDEX "inventory_patient_schedule_organization_date_active"
  ON "inventory_patient_treatment_schedule" ("organization_id","scheduled_on","unit_id","product_id")
  WHERE "status" IN ('PLANNED','RESERVED');
