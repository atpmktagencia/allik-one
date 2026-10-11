CREATE TABLE "inventory_care_appointments" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "professional_user_id" uuid NOT NULL,
  "care_type" text NOT NULL,
  "other_care_type" text,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "room" text NOT NULL,
  "chair" integer,
  "notes" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'SCHEDULED' NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "care_appointment_type_valid" CHECK ("care_type" IN ('FIRST_VISIT','FOLLOW_UP','CONSULTATION','TELECONSULTATION','INJECTABLE','OTHER')),
  CONSTRAINT "care_appointment_other_type_valid" CHECK (("care_type"='OTHER' AND char_length(trim("other_care_type")) BETWEEN 2 AND 80) OR ("care_type"<>'OTHER' AND "other_care_type" IS NULL)),
  CONSTRAINT "care_appointment_period_valid" CHECK ("ends_at">"starts_at" AND "ends_at"<="starts_at"+interval '12 hours'),
  CONSTRAINT "care_appointment_room_valid" CHECK (char_length(trim("room")) BETWEEN 2 AND 80),
  CONSTRAINT "care_appointment_chair_valid" CHECK ("chair" IS NULL OR "chair" IN (1,2)),
  CONSTRAINT "care_appointment_notes_valid" CHECK (char_length("notes")<=1000),
  CONSTRAINT "care_appointment_status_valid" CHECK ("status" IN ('SCHEDULED','CONFIRMED','IN_PROGRESS','COMPLETED','NO_SHOW','CANCELED')),
  CONSTRAINT "care_appointment_version_nonnegative" CHECK ("version">=0)
);
--> statement-breakpoint
CREATE INDEX "care_appointment_unit_period" ON "inventory_care_appointments" ("unit_id","starts_at","ends_at");
--> statement-breakpoint
CREATE INDEX "care_appointment_professional_period" ON "inventory_care_appointments" ("professional_user_id","starts_at","ends_at");
--> statement-breakpoint
CREATE INDEX "care_appointment_patient_period" ON "inventory_care_appointments" ("patient_id","starts_at");
--> statement-breakpoint
ALTER TABLE "inventory_care_appointments" ADD CONSTRAINT "care_appointments_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_care_appointments" ADD CONSTRAINT "care_appointments_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_care_appointments" ADD CONSTRAINT "care_appointments_patient_fk" FOREIGN KEY ("patient_id") REFERENCES "inventory_patients"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_care_appointments" ADD CONSTRAINT "care_appointments_professional_fk" FOREIGN KEY ("professional_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_care_appointments" ADD CONSTRAINT "care_appointments_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_care_appointments" ADD CONSTRAINT "care_appointments_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "inventory_care_appointment_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "appointment_id" uuid NOT NULL,
  "action" text NOT NULL,
  "before_data" jsonb,
  "after_data" jsonb NOT NULL,
  "reason" text NOT NULL,
  "actor" text NOT NULL,
  "actor_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "care_appointment_change_action_valid" CHECK ("action" IN ('CREATE','UPDATE')),
  CONSTRAINT "care_appointment_change_reason_valid" CHECK (char_length(trim("reason")) BETWEEN 10 AND 500)
);
--> statement-breakpoint
CREATE INDEX "care_appointment_change_history" ON "inventory_care_appointment_changes" ("appointment_id","created_at");
--> statement-breakpoint
ALTER TABLE "inventory_care_appointment_changes" ADD CONSTRAINT "care_appointment_changes_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_care_appointment_changes" ADD CONSTRAINT "care_appointment_changes_appointment_fk" FOREIGN KEY ("appointment_id") REFERENCES "inventory_care_appointments"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_care_appointment_changes" ADD CONSTRAINT "care_appointment_changes_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TRIGGER care_appointment_change_immutable BEFORE UPDATE OR DELETE ON "inventory_care_appointment_changes" FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
