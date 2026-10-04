CREATE TABLE "inventory_purchase_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"received" numeric(14, 3) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	CONSTRAINT "purchase_quantity_positive" CHECK ("inventory_purchase_items"."quantity" > 0),
	CONSTRAINT "purchase_received_valid" CHECK ("inventory_purchase_items"."received" >= 0 AND "inventory_purchase_items"."received" <= "inventory_purchase_items"."quantity"),
	CONSTRAINT "purchase_cost_nonnegative" CHECK ("inventory_purchase_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_purchases_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "inventory_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"purchase_item_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	CONSTRAINT "inventory_receipt_items_movement_id_unique" UNIQUE("movement_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "inventory_suppliers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "inventory_receipts" ADD COLUMN "purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_purchase_items" ADD CONSTRAINT "inventory_purchase_items_purchase_id_inventory_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."inventory_purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_items" ADD CONSTRAINT "inventory_purchase_items_product_id_inventory_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."inventory_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchases" ADD CONSTRAINT "inventory_purchases_supplier_id_inventory_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."inventory_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_receipt_items" ADD CONSTRAINT "inventory_receipt_items_receipt_id_inventory_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inventory_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_receipt_items" ADD CONSTRAINT "inventory_receipt_items_purchase_item_id_inventory_purchase_items_id_fk" FOREIGN KEY ("purchase_item_id") REFERENCES "public"."inventory_purchase_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_receipt_items" ADD CONSTRAINT "inventory_receipt_items_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_product_unique" ON "inventory_purchase_items" USING btree ("purchase_id","product_id");--> statement-breakpoint
ALTER TABLE "inventory_receipts" ADD CONSTRAINT "inventory_receipts_purchase_id_inventory_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."inventory_purchases"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER receipt_item_immutable BEFORE UPDATE OR DELETE ON inventory_receipt_items FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER purchase_immutable BEFORE UPDATE OR DELETE ON inventory_purchases FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
