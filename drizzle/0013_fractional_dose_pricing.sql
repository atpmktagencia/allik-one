CREATE TABLE "inventory_pricing_presentations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"base_unit" text NOT NULL,
	"total_base_quantity" numeric(18, 6) NOT NULL,
	"total_volume_ml" numeric(18, 6),
	"acquisition_cost" numeric(14, 4) NOT NULL,
	"technical_loss_percent" numeric(7, 4) DEFAULT '0' NOT NULL,
	"additional_presentation_cost" numeric(14, 4) DEFAULT '0' NOT NULL,
	"minimum_measurable_volume_ml" numeric(12, 6),
	"beyond_use_hours" integer,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_pricing_presentation_base_unit_valid" CHECK ("base_unit" IN ('MG','MCG','G','ML','UI','UNIT')),
	CONSTRAINT "inventory_pricing_presentation_quantity_positive" CHECK ("total_base_quantity" > 0),
	CONSTRAINT "inventory_pricing_presentation_volume_positive" CHECK ("total_volume_ml" IS NULL OR "total_volume_ml" > 0),
	CONSTRAINT "inventory_pricing_presentation_cost_nonnegative" CHECK ("acquisition_cost" >= 0 AND "additional_presentation_cost" >= 0),
	CONSTRAINT "inventory_pricing_presentation_loss_valid" CHECK ("technical_loss_percent" >= 0 AND "technical_loss_percent" < 100),
	CONSTRAINT "inventory_pricing_presentation_measurement_positive" CHECK ("minimum_measurable_volume_ml" IS NULL OR "minimum_measurable_volume_ml" > 0),
	CONSTRAINT "inventory_pricing_presentation_opening_valid" CHECK ("beyond_use_hours" IS NULL OR "beyond_use_hours" > 0),
	CONSTRAINT "inventory_pricing_presentation_version_nonnegative" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_pricing_presentation_identity" ON "inventory_pricing_presentations" USING btree ("organization_id",lower("name"));
--> statement-breakpoint
CREATE INDEX "inventory_pricing_presentation_product" ON "inventory_pricing_presentations" USING btree ("product_id");
--> statement-breakpoint
ALTER TABLE "inventory_pricing_presentations" ADD CONSTRAINT "inventory_pricing_presentations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id");
--> statement-breakpoint
ALTER TABLE "inventory_pricing_presentations" ADD CONSTRAINT "inventory_pricing_presentations_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id");
--> statement-breakpoint
ALTER TABLE "inventory_pricing_presentations" ADD CONSTRAINT "inventory_pricing_presentations_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "inventory_users"("id");
--> statement-breakpoint
CREATE TABLE "inventory_pricing_doses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"presentation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"dose_quantity" numeric(18, 6) NOT NULL,
	"sale_price" numeric(14, 2) NOT NULL,
	"material_cost" numeric(14, 4) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_pricing_dose_quantity_positive" CHECK ("dose_quantity" > 0),
	CONSTRAINT "inventory_pricing_dose_price_positive" CHECK ("sale_price" > 0),
	CONSTRAINT "inventory_pricing_dose_material_nonnegative" CHECK ("material_cost" >= 0),
	CONSTRAINT "inventory_pricing_dose_version_nonnegative" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_pricing_dose_identity" ON "inventory_pricing_doses" USING btree ("presentation_id",lower("name"));
--> statement-breakpoint
ALTER TABLE "inventory_pricing_doses" ADD CONSTRAINT "inventory_pricing_doses_presentation_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "inventory_pricing_presentations"("id");
--> statement-breakpoint
CREATE TABLE "inventory_pricing_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"presentation_id" uuid NOT NULL,
	"dose_id" uuid,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_pricing_change_action_valid" CHECK ("action" IN ('CREATE_PRESENTATION','UPDATE_PRESENTATION','CREATE_DOSE','UPDATE_DOSE')),
	CONSTRAINT "inventory_pricing_change_reason_valid" CHECK (char_length(trim("reason")) >= 10)
);
--> statement-breakpoint
CREATE INDEX "inventory_pricing_change_history" ON "inventory_pricing_changes" USING btree ("organization_id","created_at");
--> statement-breakpoint
ALTER TABLE "inventory_pricing_changes" ADD CONSTRAINT "inventory_pricing_changes_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id");
--> statement-breakpoint
ALTER TABLE "inventory_pricing_changes" ADD CONSTRAINT "inventory_pricing_changes_presentation_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "inventory_pricing_presentations"("id");
--> statement-breakpoint
ALTER TABLE "inventory_pricing_changes" ADD CONSTRAINT "inventory_pricing_changes_dose_id_fk" FOREIGN KEY ("dose_id") REFERENCES "inventory_pricing_doses"("id");
--> statement-breakpoint
ALTER TABLE "inventory_pricing_changes" ADD CONSTRAINT "inventory_pricing_changes_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id");
--> statement-breakpoint
CREATE TRIGGER pricing_change_immutable BEFORE UPDATE OR DELETE ON inventory_pricing_changes FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
