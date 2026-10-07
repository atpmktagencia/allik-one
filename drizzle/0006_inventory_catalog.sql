CREATE TABLE "inventory_catalog_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid,
	"location_id" uuid,
	"action" text NOT NULL,
	"request_hash" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_change_target" CHECK (("inventory_catalog_changes"."product_id" IS NOT NULL) <> ("inventory_catalog_changes"."location_id" IS NOT NULL)),
	CONSTRAINT "catalog_change_action" CHECK ("inventory_catalog_changes"."action" IN ('CREATE','UPDATE'))
);
--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_products" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_catalog_changes" ADD CONSTRAINT "inventory_catalog_changes_product_id_inventory_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."inventory_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_catalog_changes" ADD CONSTRAINT "inventory_catalog_changes_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_location_name_case_unique" ON "inventory_locations" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_product_sku_case_unique" ON "inventory_products" USING btree (lower("sku"));
--> statement-breakpoint
CREATE TRIGGER inventory_catalog_changes_immutable BEFORE UPDATE OR DELETE ON inventory_catalog_changes
FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
