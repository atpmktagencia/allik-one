CREATE TABLE "inventory_application_movements" (
	"movement_id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"reference" text NOT NULL,
	"patient_ref" text NOT NULL,
	"service" text NOT NULL,
	"professional" text NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_applications_reference_unique" UNIQUE("reference"),
	CONSTRAINT "application_synthetic_patient" CHECK ("inventory_applications"."patient_ref" IN ('demo-patient-a','demo-patient-b','demo-patient-c'))
);
--> statement-breakpoint
ALTER TABLE "inventory_application_movements" ADD CONSTRAINT "inventory_application_movements_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_application_movements" ADD CONSTRAINT "inventory_application_movements_application_id_inventory_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."inventory_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_applications" ADD CONSTRAINT "inventory_applications_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER inventory_applications_immutable BEFORE UPDATE OR DELETE ON inventory_applications
FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER inventory_application_movements_immutable BEFORE UPDATE OR DELETE ON inventory_application_movements
FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
