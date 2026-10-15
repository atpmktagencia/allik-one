CREATE INDEX "inventory_patient_schedule_unit_product_reserved"
  ON "inventory_patient_treatment_schedule" ("unit_id","product_id","dose_unit")
  WHERE "status" = 'RESERVED';
