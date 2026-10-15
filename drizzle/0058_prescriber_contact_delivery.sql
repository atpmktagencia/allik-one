CREATE TABLE "inventory_document_delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"action" text NOT NULL,
	"recipient_hash" text NOT NULL,
	"pdf_sha256" text NOT NULL,
	"signed" boolean NOT NULL,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_delivery_action_valid" CHECK ("inventory_document_delivery_events"."action" IN ('EMAIL_REQUESTED','EMAIL_ACCEPTED','EMAIL_FAILED','EMAIL_UNCONFIRMED','WHATSAPP_PREPARED')),
	CONSTRAINT "document_delivery_hash_valid" CHECK ("inventory_document_delivery_events"."recipient_hash" ~ '^[a-f0-9]{64}$' AND "inventory_document_delivery_events"."pdf_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "document_delivery_provider_valid" CHECK ("inventory_document_delivery_events"."provider_message_id" IS NULL OR char_length("inventory_document_delivery_events"."provider_message_id") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "inventory_users" ADD COLUMN "prescribing_address" text;--> statement-breakpoint
ALTER TABLE "inventory_users" ADD COLUMN "prescribing_city" text;--> statement-breakpoint
ALTER TABLE "inventory_users" ADD COLUMN "prescribing_state" text;--> statement-breakpoint
ALTER TABLE "inventory_users" ADD COLUMN "prescribing_phone" text;--> statement-breakpoint
ALTER TABLE "inventory_document_delivery_events" ADD CONSTRAINT "inventory_document_delivery_events_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_document_delivery_events" ADD CONSTRAINT "inventory_document_delivery_events_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_document_delivery_events" ADD CONSTRAINT "inventory_document_delivery_events_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_document_delivery_events" ADD CONSTRAINT "inventory_document_delivery_events_document_id_inventory_encounter_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."inventory_encounter_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_document_delivery_events" ADD CONSTRAINT "inventory_document_delivery_events_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_delivery_operation_action_unique" ON "inventory_document_delivery_events" USING btree ("operation_id","action");--> statement-breakpoint
CREATE INDEX "document_delivery_actor_time" ON "inventory_document_delivery_events" USING btree ("organization_id","actor_user_id","created_at");--> statement-breakpoint
ALTER TABLE "inventory_users" ADD CONSTRAINT "inventory_user_prescriber_contact_valid" CHECK (
      ("inventory_users"."prescribing_address" IS NULL OR char_length("inventory_users"."prescribing_address")<=500)
      AND ("inventory_users"."prescribing_city" IS NULL OR char_length("inventory_users"."prescribing_city")<=100)
      AND ("inventory_users"."prescribing_phone" IS NULL OR char_length("inventory_users"."prescribing_phone")<=40)
      AND ("inventory_users"."prescribing_state" IS NULL OR "inventory_users"."prescribing_state" IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')));--> statement-breakpoint
CREATE TRIGGER document_delivery_event_immutable BEFORE UPDATE OR DELETE ON inventory_document_delivery_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER document_delivery_event_no_truncate BEFORE TRUNCATE ON inventory_document_delivery_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE FUNCTION inventory_guard_document_delivery_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM inventory_encounter_documents d WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.unit_id=NEW.unit_id AND d.patient_id=NEW.patient_id AND d.author_user_id=NEW.actor_user_id AND d.status='FINAL' AND d.type='PRESCRIPTION')
 THEN RAISE EXCEPTION 'document delivery scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_delivery_scope_guard BEFORE INSERT ON inventory_document_delivery_events FOR EACH ROW EXECUTE FUNCTION inventory_guard_document_delivery_scope();
