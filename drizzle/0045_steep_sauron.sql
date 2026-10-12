CREATE TABLE "inventory_encounter_quote_activations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"first_scheduled_on" date NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_encounter_quote_activations_quote_id_unique" UNIQUE("quote_id"),
	CONSTRAINT "encounter_activation_reason_valid" CHECK (char_length(trim("inventory_encounter_quote_activations"."reason")) BETWEEN 10 AND 500)
);
--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ALTER COLUMN "frequency_every_days" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ADD COLUMN "frequency_every" integer;--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ADD COLUMN "frequency_unit" text;--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ADD COLUMN "source_quote_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ADD COLUMN "source_prescription_item_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quote_activations" ADD CONSTRAINT "inventory_encounter_quote_activations_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quote_activations" ADD CONSTRAINT "inventory_encounter_quote_activations_quote_id_inventory_encounter_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."inventory_encounter_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quote_activations" ADD CONSTRAINT "inventory_encounter_quote_activations_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quote_activations" ADD CONSTRAINT "inventory_encounter_quote_activations_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quote_activations" ADD CONSTRAINT "inventory_encounter_quote_activations_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ADD CONSTRAINT "inventory_patient_treatments_source_quote_id_inventory_encounter_quotes_id_fk" FOREIGN KEY ("source_quote_id") REFERENCES "public"."inventory_encounter_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patient_treatment_quote_item_unique" ON "inventory_patient_treatments" USING btree ("source_quote_id","source_prescription_item_id");--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ADD CONSTRAINT "patient_treatment_cadence_valid" CHECK (("inventory_patient_treatments"."frequency_every" IS NULL AND "inventory_patient_treatments"."frequency_unit" IS NULL AND "inventory_patient_treatments"."frequency_every_days" IS NOT NULL) OR ("inventory_patient_treatments"."frequency_every" > 0 AND "inventory_patient_treatments"."frequency_unit" IN ('DAY','WEEK','MONTH') AND (("inventory_patient_treatments"."frequency_unit"='MONTH' AND "inventory_patient_treatments"."frequency_every_days" IS NULL) OR ("inventory_patient_treatments"."frequency_unit"='DAY' AND "inventory_patient_treatments"."frequency_every_days"="inventory_patient_treatments"."frequency_every") OR ("inventory_patient_treatments"."frequency_unit"='WEEK' AND "inventory_patient_treatments"."frequency_every_days"="inventory_patient_treatments"."frequency_every"*7))));--> statement-breakpoint
ALTER TABLE "inventory_patient_treatments" ADD CONSTRAINT "patient_treatment_source_pair_valid" CHECK (("inventory_patient_treatments"."source_quote_id" IS NULL) = ("inventory_patient_treatments"."source_prescription_item_id" IS NULL));
--> statement-breakpoint
CREATE TRIGGER encounter_quote_activation_immutable BEFORE UPDATE OR DELETE ON inventory_encounter_quote_activations FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE FUNCTION inventory_protect_quote_treatment_source() RETURNS trigger AS $$
BEGIN
 IF OLD.source_quote_id IS NOT NULL AND (NEW.source_quote_id,NEW.source_prescription_item_id,NEW.organization_id,NEW.patient_id,NEW.unit_id,NEW.product_id,NEW.dose_quantity,NEW.dose_unit,NEW.route,NEW.frequency_every_days,NEW.frequency_every,NEW.frequency_unit,NEW.first_scheduled_on,NEW.planned_administrations)
 IS DISTINCT FROM (OLD.source_quote_id,OLD.source_prescription_item_id,OLD.organization_id,OLD.patient_id,OLD.unit_id,OLD.product_id,OLD.dose_quantity,OLD.dose_unit,OLD.route,OLD.frequency_every_days,OLD.frequency_every,OLD.frequency_unit,OLD.first_scheduled_on,OLD.planned_administrations) THEN
  RAISE EXCEPTION 'paid quote treatment source and prescription are immutable';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER quote_treatment_source_immutable BEFORE UPDATE ON inventory_patient_treatments FOR EACH ROW EXECUTE FUNCTION inventory_protect_quote_treatment_source();
