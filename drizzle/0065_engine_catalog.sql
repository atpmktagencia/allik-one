CREATE TABLE "inventory_engine_catalog_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"action" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_engine_catalog_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"presentation" text,
	"concentration" text,
	"internal_code" text,
	"supplier_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_engine_commercial_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"target_product_id" uuid,
	"target_item_id" uuid,
	"billing_mode" text NOT NULL,
	"charge_group" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_engine_product_active_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"active_item_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_engine_unit_sale_price_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"price_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_engine_unit_sale_prices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_id" uuid,
	"catalog_item_id" uuid,
	"amount" numeric(12, 2) NOT NULL,
	"selling_unit" text NOT NULL,
	"source" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"availability" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_engine_catalog_events" ADD CONSTRAINT "inventory_engine_catalog_events_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_catalog_events" ADD CONSTRAINT "inventory_engine_catalog_events_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_catalog_events" ADD CONSTRAINT "inventory_engine_catalog_events_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_catalog_items" ADD CONSTRAINT "inventory_engine_catalog_items_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_catalog_items" ADD CONSTRAINT "inventory_engine_catalog_items_supplier_id_inventory_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."inventory_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_commercial_mappings" ADD CONSTRAINT "inventory_engine_commercial_mappings_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_commercial_mappings" ADD CONSTRAINT "inventory_engine_commercial_mappings_source_item_id_inventory_engine_catalog_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."inventory_engine_catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_commercial_mappings" ADD CONSTRAINT "inventory_engine_commercial_mappings_target_product_id_inventory_products_id_fk" FOREIGN KEY ("target_product_id") REFERENCES "public"."inventory_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_commercial_mappings" ADD CONSTRAINT "inventory_engine_commercial_mappings_target_item_id_inventory_engine_catalog_items_id_fk" FOREIGN KEY ("target_item_id") REFERENCES "public"."inventory_engine_catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_product_active_links" ADD CONSTRAINT "inventory_engine_product_active_links_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_product_active_links" ADD CONSTRAINT "inventory_engine_product_active_links_product_id_inventory_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."inventory_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_product_active_links" ADD CONSTRAINT "inventory_engine_product_active_links_active_item_id_inventory_engine_catalog_items_id_fk" FOREIGN KEY ("active_item_id") REFERENCES "public"."inventory_engine_catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_unit_sale_price_versions" ADD CONSTRAINT "inventory_engine_unit_sale_price_versions_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_unit_sale_price_versions" ADD CONSTRAINT "inventory_engine_unit_sale_price_versions_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_unit_sale_price_versions" ADD CONSTRAINT "inventory_engine_unit_sale_price_versions_price_id_inventory_engine_unit_sale_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."inventory_engine_unit_sale_prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_unit_sale_prices" ADD CONSTRAINT "inventory_engine_unit_sale_prices_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_unit_sale_prices" ADD CONSTRAINT "inventory_engine_unit_sale_prices_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_unit_sale_prices" ADD CONSTRAINT "inventory_engine_unit_sale_prices_product_id_inventory_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."inventory_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engine_unit_sale_prices" ADD CONSTRAINT "inventory_engine_unit_sale_prices_catalog_item_id_inventory_engine_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_engine_catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "engine_operation_unique" ON "inventory_engine_catalog_events" USING btree ("organization_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "engine_product_active_unique" ON "inventory_engine_product_active_links" USING btree ("organization_id","product_id","active_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "engine_unit_price_version_unique" ON "inventory_engine_unit_sale_price_versions" USING btree ("price_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "engine_unit_product_price_unique" ON "inventory_engine_unit_sale_prices" USING btree ("organization_id","unit_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "engine_unit_catalog_price_unique" ON "inventory_engine_unit_sale_prices" USING btree ("organization_id","unit_id","catalog_item_id");
--> statement-breakpoint
CREATE FUNCTION inventory_validate_engine_catalog() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE valid boolean; target_table text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Catalog records cannot be deleted'; END IF;
 IF TG_TABLE_NAME IN ('inventory_engine_catalog_items','inventory_engine_product_active_links','inventory_engine_commercial_mappings','inventory_engine_unit_sale_prices') THEN
  IF NEW.version<1 OR (TG_OP='INSERT' AND NEW.version<>1) THEN RAISE EXCEPTION 'Invalid initial version'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.id,NEW.organization_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.created_at) OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Immutable catalog origin or invalid version'; END IF;
 END IF;
 IF TG_TABLE_NAME='inventory_engine_catalog_items' THEN
  IF NEW.kind NOT IN ('ACTIVE','MEDICATION','SERVICE','PROCEDURE') OR length(btrim(NEW.name)) NOT BETWEEN 1 AND 160 OR length(NEW.description)>2000 THEN RAISE EXCEPTION 'Invalid catalog item'; END IF;
  IF NEW.supplier_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_suppliers s WHERE s.id=NEW.supplier_id AND s.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invalid supplier scope'; END IF;
  IF TG_OP='UPDATE' AND NEW.kind<>OLD.kind THEN RAISE EXCEPTION 'Immutable catalog kind'; END IF;
 ELSIF TG_TABLE_NAME='inventory_engine_product_active_links' THEN
  IF TG_OP='UPDATE' AND (NEW.product_id,NEW.active_item_id) IS DISTINCT FROM (OLD.product_id,OLD.active_item_id) THEN RAISE EXCEPTION 'Immutable active link'; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_products p WHERE p.id=NEW.product_id AND p.organization_id=NEW.organization_id) OR NOT EXISTS(SELECT 1 FROM inventory_engine_catalog_items i WHERE i.id=NEW.active_item_id AND i.organization_id=NEW.organization_id AND i.kind='ACTIVE') THEN RAISE EXCEPTION 'Invalid active link scope or kind'; END IF;
 ELSIF TG_TABLE_NAME='inventory_engine_commercial_mappings' THEN
  IF TG_OP='UPDATE' AND (NEW.source_item_id,NEW.target_product_id,NEW.target_item_id,NEW.charge_group) IS DISTINCT FROM (OLD.source_item_id,OLD.target_product_id,OLD.target_item_id,OLD.charge_group) THEN RAISE EXCEPTION 'Immutable commercial mapping origin'; END IF;
  IF (NEW.target_product_id IS NULL)=(NEW.target_item_id IS NULL) OR NEW.billing_mode NOT IN ('SEPARATE','INCLUDED') OR length(btrim(NEW.charge_group)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid commercial mapping'; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_engine_catalog_items i WHERE i.id=NEW.source_item_id AND i.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invalid source scope'; END IF;
  IF NEW.target_product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_products p WHERE p.id=NEW.target_product_id AND p.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invalid product target'; END IF;
  IF NEW.target_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_engine_catalog_items i WHERE i.id=NEW.target_item_id AND i.organization_id=NEW.organization_id AND i.kind IN ('SERVICE','PROCEDURE')) THEN RAISE EXCEPTION 'Invalid catalog target'; END IF;
 ELSIF TG_TABLE_NAME='inventory_engine_unit_sale_prices' THEN
  IF TG_OP='UPDATE' AND (NEW.unit_id,NEW.product_id,NEW.catalog_item_id) IS DISTINCT FROM (OLD.unit_id,OLD.product_id,OLD.catalog_item_id) THEN RAISE EXCEPTION 'Immutable price origin'; END IF;
  IF (NEW.product_id IS NULL)=(NEW.catalog_item_id IS NULL) OR NEW.amount<=0 OR NEW.amount>9999999999.99 OR NEW.availability NOT IN ('UNKNOWN','AVAILABLE','UNAVAILABLE') OR (NEW.valid_until IS NOT NULL AND NEW.valid_until<NEW.valid_from) OR length(btrim(NEW.selling_unit)) NOT BETWEEN 1 AND 80 OR length(btrim(NEW.source)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid unit price'; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_units u WHERE u.id=NEW.unit_id AND u.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invalid price unit'; END IF;
  IF NEW.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_products p WHERE p.id=NEW.product_id AND p.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invalid price product'; END IF;
  IF NEW.catalog_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_engine_catalog_items i WHERE i.id=NEW.catalog_item_id AND i.organization_id=NEW.organization_id AND i.kind IN ('SERVICE','PROCEDURE')) THEN RAISE EXCEPTION 'Invalid price catalog target'; END IF;
 ELSIF TG_TABLE_NAME='inventory_engine_unit_sale_price_versions' THEN
  IF NOT EXISTS(SELECT 1 FROM inventory_engine_unit_sale_prices p WHERE p.id=NEW.price_id AND p.organization_id=NEW.organization_id AND p.unit_id=NEW.unit_id AND p.version=NEW.version AND to_jsonb(p)=to_jsonb(jsonb_populate_record(NULL::inventory_engine_unit_sale_prices,NEW.snapshot))) THEN RAISE EXCEPTION 'Invalid price version snapshot'; END IF;
 ELSIF TG_TABLE_NAME='inventory_engine_catalog_events' THEN
  IF NOT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE m.user_id=NEW.actor_user_id AND m.organization_id=NEW.organization_id AND m.active AND u.active) THEN RAISE EXCEPTION 'Invalid event actor'; END IF;
  target_table=CASE NEW.action WHEN 'SAVE_ITEM' THEN 'inventory_engine_catalog_items' WHEN 'LINK_ACTIVE' THEN 'inventory_engine_product_active_links' WHEN 'SAVE_MAPPING' THEN 'inventory_engine_commercial_mappings' WHEN 'SET_UNIT_PRICE' THEN 'inventory_engine_unit_sale_prices' END;
  IF target_table IS NULL OR NEW.request_hash !~ '^[0-9a-f]{64}$' OR NEW.result->>'id' IS DISTINCT FROM NEW.resource_id::text OR NEW.result->>'version' IS DISTINCT FROM NEW.after_data->>'version' THEN RAISE EXCEPTION 'Invalid event'; END IF;
  EXECUTE format('SELECT to_jsonb(t)=to_jsonb(jsonb_populate_record(NULL::%I,$1)) FROM %I t WHERE id=$2 AND organization_id=$3',target_table,target_table) INTO valid USING NEW.after_data,NEW.resource_id,NEW.organization_id;
  IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'Invalid event snapshot'; END IF;
  IF NEW.action='SET_UNIT_PRICE' THEN
   IF NOT EXISTS(SELECT 1 FROM inventory_engine_unit_sale_prices p WHERE p.id=NEW.resource_id AND p.unit_id=NEW.unit_id AND p.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invalid event unit'; END IF;
  ELSIF NEW.unit_id IS NOT NULL THEN RAISE EXCEPTION 'Unexpected event unit'; END IF;
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER engine_catalog_items_validate BEFORE INSERT OR UPDATE OR DELETE ON inventory_engine_catalog_items FOR EACH ROW EXECUTE FUNCTION inventory_validate_engine_catalog();

--> statement-breakpoint
CREATE TRIGGER engine_catalog_items_no_truncate BEFORE TRUNCATE ON inventory_engine_catalog_items FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();

--> statement-breakpoint
CREATE TRIGGER engine_product_active_links_validate BEFORE INSERT OR UPDATE OR DELETE ON inventory_engine_product_active_links FOR EACH ROW EXECUTE FUNCTION inventory_validate_engine_catalog();

--> statement-breakpoint
CREATE TRIGGER engine_product_active_links_no_truncate BEFORE TRUNCATE ON inventory_engine_product_active_links FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();

--> statement-breakpoint
CREATE TRIGGER engine_commercial_mappings_validate BEFORE INSERT OR UPDATE OR DELETE ON inventory_engine_commercial_mappings FOR EACH ROW EXECUTE FUNCTION inventory_validate_engine_catalog();

--> statement-breakpoint
CREATE TRIGGER engine_commercial_mappings_no_truncate BEFORE TRUNCATE ON inventory_engine_commercial_mappings FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();

--> statement-breakpoint
CREATE TRIGGER engine_unit_sale_prices_validate BEFORE INSERT OR UPDATE OR DELETE ON inventory_engine_unit_sale_prices FOR EACH ROW EXECUTE FUNCTION inventory_validate_engine_catalog();

--> statement-breakpoint
CREATE TRIGGER engine_unit_sale_prices_no_truncate BEFORE TRUNCATE ON inventory_engine_unit_sale_prices FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();

--> statement-breakpoint
CREATE TRIGGER engine_unit_sale_price_versions_validate BEFORE INSERT ON inventory_engine_unit_sale_price_versions FOR EACH ROW EXECUTE FUNCTION inventory_validate_engine_catalog();

--> statement-breakpoint
CREATE TRIGGER engine_unit_sale_price_versions_no_truncate BEFORE TRUNCATE ON inventory_engine_unit_sale_price_versions FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();

--> statement-breakpoint
CREATE TRIGGER engine_unit_sale_price_versions_immutable BEFORE UPDATE OR DELETE ON inventory_engine_unit_sale_price_versions FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();

--> statement-breakpoint
CREATE TRIGGER engine_catalog_events_validate BEFORE INSERT ON inventory_engine_catalog_events FOR EACH ROW EXECUTE FUNCTION inventory_validate_engine_catalog();

--> statement-breakpoint
CREATE TRIGGER engine_catalog_events_no_truncate BEFORE TRUNCATE ON inventory_engine_catalog_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();

--> statement-breakpoint
CREATE TRIGGER engine_catalog_events_immutable BEFORE UPDATE OR DELETE ON inventory_engine_catalog_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();

--> statement-breakpoint
CREATE UNIQUE INDEX engine_mapping_product_unique ON inventory_engine_commercial_mappings(organization_id,source_item_id,target_product_id,charge_group) WHERE target_product_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX engine_mapping_item_unique ON inventory_engine_commercial_mappings(organization_id,source_item_id,target_item_id,charge_group) WHERE target_item_id IS NOT NULL;
