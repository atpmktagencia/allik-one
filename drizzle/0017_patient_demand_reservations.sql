CREATE TABLE "inventory_patient_treatment_purchases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "treatment_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "purchased_quantity" numeric(18,6) NOT NULL,
  "quantity_unit" text NOT NULL,
  "total_value" numeric(14,2),
  "reference" text NOT NULL,
  "purchased_on" date NOT NULL,
  "reason" text NOT NULL,
  "actor" text NOT NULL,
  "actor_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "patient_purchase_quantity_positive" CHECK ("purchased_quantity" > 0),
  CONSTRAINT "patient_purchase_unit_valid" CHECK ("quantity_unit" IN ('MG','ML','UI','UNIT')),
  CONSTRAINT "patient_purchase_value_nonnegative" CHECK ("total_value" IS NULL OR "total_value" >= 0),
  CONSTRAINT "patient_purchase_reference_valid" CHECK (char_length(trim("reference")) BETWEEN 3 AND 100),
  CONSTRAINT "patient_purchase_reason_valid" CHECK (char_length(trim("reason")) BETWEEN 10 AND 500)
);
--> statement-breakpoint
CREATE INDEX "inventory_patient_purchase_treatment_date" ON "inventory_patient_treatment_purchases" ("treatment_id","purchased_on");
--> statement-breakpoint
CREATE INDEX "inventory_patient_purchase_patient" ON "inventory_patient_treatment_purchases" ("patient_id","created_at");
--> statement-breakpoint
CREATE INDEX "inventory_patient_purchase_organization" ON "inventory_patient_treatment_purchases" ("organization_id","created_at");
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_purchases" ADD CONSTRAINT "inventory_patient_treatment_purchases_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_purchases" ADD CONSTRAINT "inventory_patient_treatment_purchases_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "inventory_patients"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_purchases" ADD CONSTRAINT "inventory_patient_treatment_purchases_treatment_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "inventory_patient_treatments"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_purchases" ADD CONSTRAINT "inventory_patient_treatment_purchases_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_purchases" ADD CONSTRAINT "inventory_patient_treatment_purchases_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TRIGGER patient_treatment_purchase_immutable BEFORE UPDATE OR DELETE ON inventory_patient_treatment_purchases FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TABLE "inventory_patient_treatment_schedule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "treatment_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "scheduled_on" date NOT NULL,
  "dose_quantity" numeric(18,6) NOT NULL,
  "dose_unit" text NOT NULL,
  "status" text DEFAULT 'PLANNED' NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "patient_schedule_sequence_positive" CHECK ("sequence" > 0),
  CONSTRAINT "patient_schedule_dose_positive" CHECK ("dose_quantity" > 0),
  CONSTRAINT "patient_schedule_unit_valid" CHECK ("dose_unit" IN ('MG','ML','UI','UNIT')),
  CONSTRAINT "patient_schedule_status_valid" CHECK ("status" IN ('PLANNED','RESERVED','CONSUMED','CANCELED')),
  CONSTRAINT "patient_schedule_version_nonnegative" CHECK ("version" >= 0),
  CONSTRAINT "inventory_patient_schedule_treatment_sequence_unique" UNIQUE("treatment_id","sequence")
);
--> statement-breakpoint
CREATE INDEX "inventory_patient_schedule_unit_date_status" ON "inventory_patient_treatment_schedule" ("unit_id","scheduled_on","status");
--> statement-breakpoint
CREATE INDEX "inventory_patient_schedule_product_date" ON "inventory_patient_treatment_schedule" ("product_id","scheduled_on");
--> statement-breakpoint
CREATE INDEX "inventory_patient_schedule_patient" ON "inventory_patient_treatment_schedule" ("patient_id","scheduled_on");
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_schedule" ADD CONSTRAINT "inventory_patient_treatment_schedule_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_schedule" ADD CONSTRAINT "inventory_patient_treatment_schedule_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "inventory_patients"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_schedule" ADD CONSTRAINT "inventory_patient_treatment_schedule_treatment_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "inventory_patient_treatments"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_schedule" ADD CONSTRAINT "inventory_patient_treatment_schedule_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_schedule" ADD CONSTRAINT "inventory_patient_treatment_schedule_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatment_schedule" ADD CONSTRAINT "inventory_patient_treatment_schedule_updated_by_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "inventory_patient_schedule_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "schedule_id" uuid NOT NULL,
  "before_data" jsonb NOT NULL,
  "after_data" jsonb NOT NULL,
  "reason" text NOT NULL,
  "actor" text NOT NULL,
  "actor_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "patient_schedule_change_reason_valid" CHECK (char_length(trim("reason")) BETWEEN 10 AND 500)
);
--> statement-breakpoint
CREATE INDEX "inventory_patient_schedule_change_history" ON "inventory_patient_schedule_changes" ("schedule_id","created_at");
--> statement-breakpoint
ALTER TABLE "inventory_patient_schedule_changes" ADD CONSTRAINT "inventory_patient_schedule_changes_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_schedule_changes" ADD CONSTRAINT "inventory_patient_schedule_changes_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "inventory_patient_treatment_schedule"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_patient_schedule_changes" ADD CONSTRAINT "inventory_patient_schedule_changes_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TRIGGER patient_schedule_change_immutable BEFORE UPDATE OR DELETE ON inventory_patient_schedule_changes FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
