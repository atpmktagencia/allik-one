ALTER TABLE "inventory_patient_applications" DROP CONSTRAINT "patient_application_physical_positive";
--> statement-breakpoint
ALTER TABLE "inventory_patient_applications" ADD CONSTRAINT "patient_application_physical_nonnegative" CHECK ("physical_quantity" >= 0);
--> statement-breakpoint
CREATE TABLE "inventory_open_presentations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "presentation_id" uuid NOT NULL,
  "lot_id" uuid NOT NULL,
  "base_unit" text NOT NULL,
  "initial_base_quantity" numeric(18,6) NOT NULL,
  "remaining_base_quantity" numeric(18,6) NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "usable_until" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "opened_by_user_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "open_presentation_unit_valid" CHECK ("base_unit" IN ('MG','MCG','G','ML','UI','UNIT')),
  CONSTRAINT "open_presentation_initial_positive" CHECK ("initial_base_quantity" > 0),
  CONSTRAINT "open_presentation_remaining_valid" CHECK ("remaining_base_quantity" >= 0 AND "remaining_base_quantity" <= "initial_base_quantity"),
  CONSTRAINT "open_presentation_window_valid" CHECK ("usable_until" >= "opened_at"),
  CONSTRAINT "open_presentation_status_valid" CHECK ("status" IN ('OPEN','DEPLETED','DISCARDED')),
  CONSTRAINT "open_presentation_version_nonnegative" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE INDEX "inventory_open_presentation_available"
  ON "inventory_open_presentations" ("location_id","product_id","presentation_id","status","usable_until");
--> statement-breakpoint
CREATE INDEX "inventory_open_presentation_lot" ON "inventory_open_presentations" ("lot_id");
--> statement-breakpoint
ALTER TABLE "inventory_open_presentations" ADD CONSTRAINT "inventory_open_presentations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_open_presentations" ADD CONSTRAINT "inventory_open_presentations_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_open_presentations" ADD CONSTRAINT "inventory_open_presentations_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_open_presentations" ADD CONSTRAINT "inventory_open_presentations_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_open_presentations" ADD CONSTRAINT "inventory_open_presentations_presentation_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "inventory_pricing_presentations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_open_presentations" ADD CONSTRAINT "inventory_open_presentations_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "inventory_lots"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_open_presentations" ADD CONSTRAINT "inventory_open_presentations_opened_by_user_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "inventory_open_presentation_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "open_presentation_id" uuid NOT NULL,
  "patient_application_id" uuid,
  "type" text NOT NULL,
  "quantity" numeric(18,6) NOT NULL,
  "reason" text NOT NULL,
  "actor" text NOT NULL,
  "actor_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "open_presentation_event_type_valid" CHECK ("type" IN ('OPEN','CONSUME','TECHNICAL_LOSS','EXPIRED','DAMAGE','DISCARD')),
  CONSTRAINT "open_presentation_event_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "open_presentation_event_reason_valid" CHECK (char_length(trim("reason")) BETWEEN 10 AND 500)
);
--> statement-breakpoint
CREATE INDEX "inventory_open_presentation_event_history"
  ON "inventory_open_presentation_events" ("open_presentation_id","created_at");
--> statement-breakpoint
CREATE INDEX "inventory_open_presentation_event_application"
  ON "inventory_open_presentation_events" ("patient_application_id");
--> statement-breakpoint
ALTER TABLE "inventory_open_presentation_events" ADD CONSTRAINT "inventory_open_presentation_events_open_id_fk" FOREIGN KEY ("open_presentation_id") REFERENCES "inventory_open_presentations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_open_presentation_events" ADD CONSTRAINT "inventory_open_presentation_events_application_id_fk" FOREIGN KEY ("patient_application_id") REFERENCES "inventory_patient_applications"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_open_presentation_events" ADD CONSTRAINT "inventory_open_presentation_events_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TRIGGER open_presentation_event_immutable BEFORE UPDATE OR DELETE ON inventory_open_presentation_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
