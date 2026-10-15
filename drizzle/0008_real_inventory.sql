CREATE TABLE "inventory_import_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "inventory_source_file" text NOT NULL,
  "inventory_source_hash" text NOT NULL UNIQUE,
  "price_source_file" text NOT NULL,
  "price_source_hash" text NOT NULL UNIQUE,
  "summary" jsonb NOT NULL,
  "actor" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_sale_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "route" text NOT NULL,
  "supplier" text NOT NULL,
  "price" numeric(14,2) NOT NULL,
  "source_file" text NOT NULL,
  "source_hash" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_sale_price_positive" CHECK ("price" > 0),
  CONSTRAINT "inventory_sale_price_route" CHECK ("route" IN ('IM','EV'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_sale_price_identity" ON "inventory_sale_prices" USING btree (lower("name"),"route",lower("supplier"));
--> statement-breakpoint
CREATE TRIGGER inventory_import_batches_immutable BEFORE UPDATE OR DELETE ON inventory_import_batches FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER inventory_sale_prices_immutable BEFORE UPDATE OR DELETE ON inventory_sale_prices FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
