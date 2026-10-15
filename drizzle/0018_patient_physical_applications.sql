CREATE TABLE "inventory_patient_applications" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "treatment_id" uuid NOT NULL,
  "schedule_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "presentation_id" uuid NOT NULL,
  "request_hash" text NOT NULL,
  "reference" text NOT NULL,
  "professional" text NOT NULL,
  "dose_quantity" numeric(18,6) NOT NULL,
  "dose_unit" text NOT NULL,
  "physical_quantity" numeric(18,6) NOT NULL,
  "reason" text NOT NULL,
  "actor" text NOT NULL,
  "actor_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "patient_application_schedule_unique" UNIQUE("schedule_id"),
  CONSTRAINT "patient_application_dose_positive" CHECK ("dose_quantity" > 0),
  CONSTRAINT "patient_application_physical_positive" CHECK ("physical_quantity" > 0),
  CONSTRAINT "patient_application_unit_valid" CHECK ("dose_unit" IN ('MG','ML','UI','UNIT')),
  CONSTRAINT "patient_application_reference_valid" CHECK (char_length(trim("reference")) BETWEEN 3 AND 100),
  CONSTRAINT "patient_application_professional_valid" CHECK (char_length(trim("professional")) BETWEEN 3 AND 100),
  CONSTRAINT "patient_application_reason_valid" CHECK (char_length(trim("reason")) BETWEEN 10 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_patient_application_reference_unique"
  ON "inventory_patient_applications" ("organization_id",lower("reference"));
--> statement-breakpoint
CREATE INDEX "inventory_patient_application_patient_date"
  ON "inventory_patient_applications" ("patient_id","created_at");
--> statement-breakpoint
CREATE INDEX "inventory_patient_application_unit_date"
  ON "inventory_patient_applications" ("unit_id","created_at");
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "inventory_patient_applications_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "inventory_patient_applications_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "inventory_patients"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "inventory_patient_applications_treatment_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "inventory_patient_treatments"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "inventory_patient_applications_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "inventory_patient_treatment_schedule"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "inventory_patient_applications_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "inventory_patient_applications_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "inventory_patient_applications_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "inventory_patient_applications_presentation_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "inventory_pricing_presentations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "inventory_patient_applications_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "inventory_patient_application_movements" (
  "movement_id" uuid PRIMARY KEY NOT NULL,
  "patient_application_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE INDEX "inventory_patient_application_movement_application"
  ON "inventory_patient_application_movements" ("patient_application_id");
--> statement-breakpoint
ALTER TABLE "inventory_patient_application_movements" ADD CONSTRAINT "inventory_patient_application_movements_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "inventory_movements"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_application_movements" ADD CONSTRAINT "inventory_patient_application_movements_application_id_fk" FOREIGN KEY ("patient_application_id") REFERENCES "inventory_patient_applications"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TRIGGER patient_application_immutable BEFORE UPDATE OR DELETE ON inventory_patient_applications FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER patient_application_movement_immutable BEFORE UPDATE OR DELETE ON inventory_patient_application_movements FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
