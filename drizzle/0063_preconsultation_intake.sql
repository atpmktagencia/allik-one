CREATE TABLE "inventory_preconsultation_forms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"questions" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_preconsultation_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"version_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_preconsultation_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_preconsultation_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"questions" jsonb NOT NULL,
	"published_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_forms" ADD CONSTRAINT "inventory_preconsultation_forms_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_forms" ADD CONSTRAINT "inventory_preconsultation_forms_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_forms" ADD CONSTRAINT "inventory_preconsultation_forms_created_by_user_id_inventory_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_invitations" ADD CONSTRAINT "inventory_preconsultation_invitations_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_invitations" ADD CONSTRAINT "inventory_preconsultation_invitations_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_invitations" ADD CONSTRAINT "inventory_preconsultation_invitations_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_invitations" ADD CONSTRAINT "inventory_preconsultation_invitations_appointment_id_inventory_care_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."inventory_care_appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_invitations" ADD CONSTRAINT "inventory_preconsultation_invitations_version_id_inventory_preconsultation_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."inventory_preconsultation_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_invitations" ADD CONSTRAINT "inventory_preconsultation_invitations_created_by_user_id_inventory_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_responses" ADD CONSTRAINT "inventory_preconsultation_responses_invitation_id_inventory_preconsultation_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."inventory_preconsultation_invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_versions" ADD CONSTRAINT "inventory_preconsultation_versions_form_id_inventory_preconsultation_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."inventory_preconsultation_forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_versions" ADD CONSTRAINT "inventory_preconsultation_versions_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_versions" ADD CONSTRAINT "inventory_preconsultation_versions_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_preconsultation_versions" ADD CONSTRAINT "inventory_preconsultation_versions_published_by_user_id_inventory_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "preconsultation_token_unique" ON "inventory_preconsultation_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "preconsultation_patient_list" ON "inventory_preconsultation_invitations" USING btree ("organization_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preconsultation_response_unique" ON "inventory_preconsultation_responses" USING btree ("invitation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preconsultation_version_unique" ON "inventory_preconsultation_versions" USING btree ("form_id","version");
--> statement-breakpoint
CREATE FUNCTION inventory_validate_preconsultation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Preconsultation records cannot be deleted'; END IF;
 IF TG_TABLE_NAME='inventory_preconsultation_forms' THEN
  IF NOT EXISTS(SELECT 1 FROM inventory_units u WHERE u.id=NEW.unit_id AND u.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invalid form scope'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.id,NEW.organization_id,NEW.unit_id,NEW.created_by_user_id) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.unit_id,OLD.created_by_user_id) OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Invalid form origin or version'; END IF;
 ELSIF TG_TABLE_NAME='inventory_preconsultation_versions' THEN
  IF NOT EXISTS(SELECT 1 FROM inventory_preconsultation_forms f WHERE f.id=NEW.form_id AND f.organization_id=NEW.organization_id AND f.unit_id=NEW.unit_id AND f.version=NEW.version AND f.title=NEW.title AND f.description=NEW.description AND f.questions=NEW.questions) THEN RAISE EXCEPTION 'Invalid published version'; END IF;
 ELSIF TG_TABLE_NAME='inventory_preconsultation_invitations' THEN
  IF TG_OP='UPDATE' AND (NEW.id,NEW.organization_id,NEW.unit_id,NEW.patient_id,NEW.appointment_id,NEW.version_id,NEW.token_hash,NEW.created_by_user_id,NEW.created_at,NEW.expires_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.unit_id,OLD.patient_id,OLD.appointment_id,OLD.version_id,OLD.token_hash,OLD.created_by_user_id,OLD.created_at,OLD.expires_at) THEN RAISE EXCEPTION 'Invitation origin is immutable'; END IF;
  IF TG_OP='UPDATE' AND ((OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) OR (OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at)) THEN RAISE EXCEPTION 'Invitation completion is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_preconsultation_versions v JOIN inventory_patients p ON p.id=NEW.patient_id WHERE v.id=NEW.version_id AND v.organization_id=NEW.organization_id AND v.unit_id=NEW.unit_id AND p.organization_id=NEW.organization_id AND (TG_OP='UPDATE' OR p.primary_unit_id=NEW.unit_id)) THEN RAISE EXCEPTION 'Invalid invitation scope'; END IF;
  IF NEW.appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_care_appointments a WHERE a.id=NEW.appointment_id AND a.organization_id=NEW.organization_id AND a.unit_id=NEW.unit_id AND a.patient_id=NEW.patient_id) THEN RAISE EXCEPTION 'Invalid invitation appointment'; END IF;
 ELSIF TG_TABLE_NAME='inventory_preconsultation_responses' THEN
  IF NOT EXISTS(SELECT 1 FROM inventory_preconsultation_invitations i WHERE i.id=NEW.invitation_id AND i.revoked_at IS NULL AND i.submitted_at IS NULL AND i.expires_at>now()) THEN RAISE EXCEPTION 'Invitation unavailable'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER preconsultation_forms_validate BEFORE INSERT OR UPDATE OR DELETE ON inventory_preconsultation_forms FOR EACH ROW EXECUTE FUNCTION inventory_validate_preconsultation();
--> statement-breakpoint
CREATE TRIGGER preconsultation_versions_validate BEFORE INSERT ON inventory_preconsultation_versions FOR EACH ROW EXECUTE FUNCTION inventory_validate_preconsultation();
--> statement-breakpoint
CREATE TRIGGER preconsultation_invitations_validate BEFORE INSERT OR UPDATE OR DELETE ON inventory_preconsultation_invitations FOR EACH ROW EXECUTE FUNCTION inventory_validate_preconsultation();
--> statement-breakpoint
CREATE TRIGGER preconsultation_responses_validate BEFORE INSERT ON inventory_preconsultation_responses FOR EACH ROW EXECUTE FUNCTION inventory_validate_preconsultation();
--> statement-breakpoint
CREATE TRIGGER preconsultation_versions_immutable BEFORE UPDATE OR DELETE ON inventory_preconsultation_versions FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER preconsultation_responses_immutable BEFORE UPDATE OR DELETE ON inventory_preconsultation_responses FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER preconsultation_forms_no_truncate BEFORE TRUNCATE ON inventory_preconsultation_forms FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER preconsultation_invitations_no_truncate BEFORE TRUNCATE ON inventory_preconsultation_invitations FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER preconsultation_versions_no_truncate BEFORE TRUNCATE ON inventory_preconsultation_versions FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER preconsultation_responses_no_truncate BEFORE TRUNCATE ON inventory_preconsultation_responses FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
