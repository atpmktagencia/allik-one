CREATE TABLE "inventory_care_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "care_type_code_valid" CHECK ("code" ~ '^[A-Z0-9_]{2,40}$'),
  CONSTRAINT "care_type_name_valid" CHECK (char_length(trim("name")) BETWEEN 2 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "care_type_org_code_unique" ON "inventory_care_types" ("organization_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "care_type_org_name_unique" ON "inventory_care_types" ("organization_id",lower("name"));
--> statement-breakpoint
ALTER TABLE "inventory_care_types" ADD CONSTRAINT "care_types_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
INSERT INTO "inventory_care_types"("organization_id","code","name")
SELECT o.id,v.code,v.name FROM "inventory_organizations" o CROSS JOIN (VALUES
 ('FIRST_VISIT','Primeira consulta'),('FOLLOW_UP','Retorno'),('CONSULTATION','Consulta'),
 ('TELECONSULTATION','Teleconsulta'),('INJECTABLE','Injetável'),
 ('HORMONAL_IMPLANT','Implante hormonal'),('PROCEDURE','Outro procedimento')
) AS v(code,name) ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE "inventory_care_rooms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "name" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "care_room_name_valid" CHECK (char_length(trim("name")) BETWEEN 2 AND 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "care_room_unit_name_unique" ON "inventory_care_rooms" ("unit_id",lower("name"));
--> statement-breakpoint
ALTER TABLE "inventory_care_rooms" ADD CONSTRAINT "care_rooms_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_care_rooms" ADD CONSTRAINT "care_rooms_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "inventory_care_resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "room_id" uuid NOT NULL,
  "name" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "care_resource_name_valid" CHECK (char_length(trim("name")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "care_resource_room_name_unique" ON "inventory_care_resources" ("room_id",lower("name"));
--> statement-breakpoint
ALTER TABLE "inventory_care_resources" ADD CONSTRAINT "care_resources_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_care_resources" ADD CONSTRAINT "care_resources_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_care_resources" ADD CONSTRAINT "care_resources_room_fk" FOREIGN KEY ("room_id") REFERENCES "inventory_care_rooms"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_care_appointments" DROP CONSTRAINT "care_appointment_type_valid";
--> statement-breakpoint
ALTER TABLE "inventory_care_appointments" ADD CONSTRAINT "care_appointment_type_valid" CHECK ("care_type" ~ '^[A-Z0-9_]{2,40}$');
--> statement-breakpoint
ALTER TABLE "inventory_care_appointments" DROP CONSTRAINT "care_appointment_other_type_valid";
--> statement-breakpoint
ALTER TABLE "inventory_care_appointments" ADD CONSTRAINT "care_appointment_other_type_valid" CHECK ("other_care_type" IS NULL OR char_length(trim("other_care_type")) BETWEEN 2 AND 80);
--> statement-breakpoint
ALTER TABLE "inventory_care_appointments" ADD COLUMN "resource_name" text;
--> statement-breakpoint
ALTER TABLE "inventory_care_appointments" ADD CONSTRAINT "care_appointment_resource_name_valid" CHECK ("resource_name" IS NULL OR char_length(trim("resource_name")) BETWEEN 1 AND 80);
