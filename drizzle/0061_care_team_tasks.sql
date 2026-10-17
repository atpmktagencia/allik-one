CREATE TABLE "inventory_care_task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_care_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"due_on" date NOT NULL,
	"assignee_user_id" uuid,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"resolution" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"change_reason" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_task_kind_valid" CHECK ("inventory_care_tasks"."kind" IN ('RETURN','EXAMS','CONTACT','DOCUMENT','OTHER')),
	CONSTRAINT "care_task_status_valid" CHECK ("inventory_care_tasks"."status" IN ('OPEN','IN_PROGRESS','DONE','CANCELED')),
	CONSTRAINT "care_task_title_valid" CHECK (char_length(trim("inventory_care_tasks"."title")) BETWEEN 3 AND 160),
	CONSTRAINT "care_task_instructions_valid" CHECK (char_length("inventory_care_tasks"."instructions") <= 1000),
	CONSTRAINT "care_task_reason_valid" CHECK (char_length(trim("inventory_care_tasks"."change_reason")) BETWEEN 3 AND 500),
	CONSTRAINT "care_task_resolution_valid" CHECK (char_length("inventory_care_tasks"."resolution") <= 1000 AND ("inventory_care_tasks"."status" NOT IN ('DONE','CANCELED') OR char_length(trim("inventory_care_tasks"."resolution")) >= 3)),
	CONSTRAINT "care_task_version_valid" CHECK ("inventory_care_tasks"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_care_task_events" ADD CONSTRAINT "inventory_care_task_events_task_id_inventory_care_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."inventory_care_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_care_task_events" ADD CONSTRAINT "inventory_care_task_events_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_care_task_events" ADD CONSTRAINT "inventory_care_task_events_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_care_tasks" ADD CONSTRAINT "inventory_care_tasks_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_care_tasks" ADD CONSTRAINT "inventory_care_tasks_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_care_tasks" ADD CONSTRAINT "inventory_care_tasks_patient_id_inventory_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."inventory_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_care_tasks" ADD CONSTRAINT "inventory_care_tasks_appointment_id_inventory_care_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."inventory_care_appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_care_tasks" ADD CONSTRAINT "inventory_care_tasks_assignee_user_id_inventory_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_care_tasks" ADD CONSTRAINT "inventory_care_tasks_created_by_user_id_inventory_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_care_tasks" ADD CONSTRAINT "inventory_care_tasks_updated_by_user_id_inventory_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "care_task_event_history" ON "inventory_care_task_events" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "care_task_unit_queue" ON "inventory_care_tasks" USING btree ("organization_id","unit_id","status","due_on","id");--> statement-breakpoint
CREATE INDEX "care_task_patient" ON "inventory_care_tasks" USING btree ("organization_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "care_task_assignee" ON "inventory_care_tasks" USING btree ("assignee_user_id","status","due_on");
--> statement-breakpoint
CREATE FUNCTION inventory_validate_care_task() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Care tasks must be canceled, not deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.organization_id,NEW.unit_id,NEW.patient_id,NEW.appointment_id,NEW.created_by_user_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.unit_id,OLD.patient_id,OLD.appointment_id,OLD.created_by_user_id,OLD.created_at) THEN RAISE EXCEPTION 'Task origin is immutable'; END IF;
 IF TG_OP='UPDATE' AND NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invalid task version'; END IF;
 IF NOT EXISTS(SELECT 1 FROM inventory_patients p JOIN inventory_units u ON u.id=NEW.unit_id WHERE p.id=NEW.patient_id AND p.organization_id=NEW.organization_id AND p.primary_unit_id=NEW.unit_id AND u.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invalid task patient scope'; END IF;
 IF NEW.appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_care_appointments a WHERE a.id=NEW.appointment_id AND a.organization_id=NEW.organization_id AND a.patient_id=NEW.patient_id AND a.unit_id=NEW.unit_id) THEN RAISE EXCEPTION 'Invalid task appointment scope'; END IF;
 IF NEW.assignee_user_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id) AND NOT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE u.id=NEW.assignee_user_id AND u.active AND m.active AND m.organization_id=NEW.organization_id AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','UNIT_MANAGER','CLINICIAN') AND (m.role='SUPER_ADMIN' OR EXISTS(SELECT 1 FROM inventory_unit_access ua WHERE ua.membership_id=m.id AND ua.unit_id=NEW.unit_id))) THEN RAISE EXCEPTION 'Invalid task assignee scope'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_care_task_scope BEFORE INSERT OR UPDATE OR DELETE ON inventory_care_tasks FOR EACH ROW EXECUTE FUNCTION inventory_validate_care_task();
--> statement-breakpoint
CREATE FUNCTION inventory_audit_care_task() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 INSERT INTO inventory_care_task_events(task_id,organization_id,actor_user_id,before_data,after_data) VALUES(NEW.id,NEW.organization_id,NEW.updated_by_user_id,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_care_task_audit AFTER INSERT OR UPDATE ON inventory_care_tasks FOR EACH ROW EXECUTE FUNCTION inventory_audit_care_task();
--> statement-breakpoint
CREATE TRIGGER inventory_care_task_events_immutable BEFORE UPDATE OR DELETE ON inventory_care_task_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
