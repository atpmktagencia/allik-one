CREATE TABLE "inventory_supplier_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"product_id" uuid,
	"code" text NOT NULL,
	"supplier_sku" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"packaging" text NOT NULL,
	"contents" text NOT NULL,
	"boxes_per_pack" integer,
	"price" numeric(14, 2),
	"pricing_note" text,
	"price_source" text NOT NULL,
	"source_page" integer,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "supplier_catalog_kind" CHECK ("inventory_supplier_catalog"."kind" IN ('PRODUCT','KIT','ADDON')),
	CONSTRAINT "supplier_catalog_price" CHECK ("inventory_supplier_catalog"."price" IS NULL OR "inventory_supplier_catalog"."price">0),
	CONSTRAINT "supplier_catalog_boxes" CHECK ("inventory_supplier_catalog"."boxes_per_pack" IS NULL OR "inventory_supplier_catalog"."boxes_per_pack">0)
);
--> statement-breakpoint
CREATE TABLE "inventory_supplier_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supplier_id" uuid NOT NULL,
	"catalog_item_id" uuid,
	"action" text NOT NULL,
	"request_hash" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_supplier_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"supplier_snapshot" jsonb NOT NULL,
	"items_snapshot" jsonb NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"freight" numeric(14, 2),
	"total" numeric(14, 2) NOT NULL,
	"notes" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_suppliers" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "inventory_suppliers" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "inventory_suppliers" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_supplier_catalog" ADD CONSTRAINT "inventory_supplier_catalog_supplier_id_inventory_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."inventory_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_supplier_catalog" ADD CONSTRAINT "inventory_supplier_catalog_product_id_inventory_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."inventory_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_supplier_changes" ADD CONSTRAINT "inventory_supplier_changes_supplier_id_inventory_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."inventory_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_supplier_changes" ADD CONSTRAINT "inventory_supplier_changes_catalog_item_id_inventory_supplier_catalog_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_supplier_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_supplier_orders" ADD CONSTRAINT "inventory_supplier_orders_id_inventory_purchases_id_fk" FOREIGN KEY ("id") REFERENCES "public"."inventory_purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_catalog_code" ON "inventory_supplier_catalog" USING btree ("supplier_id","code");--> statement-breakpoint
CREATE INDEX "supplier_change_history" ON "inventory_supplier_changes" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_product_history" ON "inventory_catalog_changes" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_location_history" ON "inventory_catalog_changes" USING btree ("location_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_name_case_unique" ON "inventory_suppliers" USING btree (lower("name"));
--> statement-breakpoint
CREATE TRIGGER inventory_supplier_changes_immutable BEFORE UPDATE OR DELETE ON inventory_supplier_changes
FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER inventory_supplier_orders_immutable BEFORE UPDATE OR DELETE ON inventory_supplier_orders
FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
