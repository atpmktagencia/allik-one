CREATE TABLE "inventory_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movement_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" numeric(14, 3) DEFAULT '0' NOT NULL,
	CONSTRAINT "balance_nonnegative" CHECK ("inventory_balances"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "inventory_locations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "inventory_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"number" text NOT NULL,
	"expires_on" date NOT NULL,
	"supplier" text NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	CONSTRAINT "lot_cost_nonnegative" CHECK ("inventory_lots"."unit_cost" >= 0),
	CONSTRAINT "lot_status_valid" CHECK ("inventory_lots"."status" in ('AVAILABLE', 'QUARANTINED', 'BLOCKED'))
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"type" text NOT NULL,
	"delta" numeric(14, 3) NOT NULL,
	"actor" text NOT NULL,
	"reference" text NOT NULL,
	"reason" text NOT NULL,
	"operation_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_operation_key_unique" UNIQUE("operation_key"),
	CONSTRAINT "movement_delta_nonzero" CHECK ("inventory_movements"."delta" <> 0),
	CONSTRAINT "movement_type_sign" CHECK (("inventory_movements"."type" = 'IN' and "inventory_movements"."delta" > 0) or ("inventory_movements"."type" = 'OUT' and "inventory_movements"."delta" < 0) or "inventory_movements"."type" in ('TRANSFER','ADJUSTMENT','REVERSAL'))
);
--> statement-breakpoint
CREATE TABLE "inventory_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"stock_controlled" boolean DEFAULT true NOT NULL,
	"minimum" numeric(14, 3) DEFAULT '0' NOT NULL,
	CONSTRAINT "inventory_products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "product_minimum_nonnegative" CHECK ("inventory_products"."minimum" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_audit" ADD CONSTRAINT "inventory_audit_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_product_id_inventory_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."inventory_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "balance_lot_location" ON "inventory_balances" USING btree ("lot_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lot_product_number" ON "inventory_lots" USING btree ("product_id","number");
--> statement-breakpoint
CREATE FUNCTION inventory_reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Inventory history is append-only'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER movement_immutable BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON inventory_audit FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE FUNCTION inventory_protect_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN RAISE EXCEPTION 'Balance is a ledger projection'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER balance_projection_only BEFORE INSERT OR UPDATE OR DELETE ON inventory_balances FOR EACH ROW EXECUTE FUNCTION inventory_protect_projection();
--> statement-breakpoint
CREATE FUNCTION inventory_apply_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE controlled boolean; active_product boolean;
BEGIN
  SELECT p.stock_controlled, p.active INTO controlled, active_product
    FROM inventory_products p JOIN inventory_lots l ON l.product_id=p.id WHERE l.id=NEW.lot_id;
  IF NOT controlled OR NOT active_product THEN RAISE EXCEPTION 'Product does not allow stock movement'; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_locations WHERE id=NEW.location_id AND active) THEN RAISE EXCEPTION 'Location is inactive'; END IF;
  IF NEW.type='OUT' AND EXISTS(SELECT 1 FROM inventory_lots WHERE id=NEW.lot_id AND (status<>'AVAILABLE' OR expires_on < (NOW() AT TIME ZONE 'America/Fortaleza')::date)) THEN RAISE EXCEPTION 'Lot is not available for consumption'; END IF;
  INSERT INTO inventory_balances(lot_id,location_id,quantity) VALUES(NEW.lot_id,NEW.location_id,0)
    ON CONFLICT(lot_id,location_id) DO NOTHING;
  UPDATE inventory_balances SET quantity=quantity+NEW.delta WHERE lot_id=NEW.lot_id AND location_id=NEW.location_id;
  INSERT INTO inventory_audit(movement_id,actor,action) VALUES(NEW.id,NEW.actor,NEW.type);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER movement_projection AFTER INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION inventory_apply_movement();
