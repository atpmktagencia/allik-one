CREATE TABLE "inventory_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_organization_name_case_unique" ON "inventory_organizations" USING btree (lower("name"));
--> statement-breakpoint
CREATE TABLE "inventory_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_unit_organization_name_unique" ON "inventory_units" USING btree ("organization_id",lower("name"));
--> statement-breakpoint
CREATE TABLE "inventory_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"profession" text,
	"title" text,
	"password_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_user_session_version_nonnegative" CHECK ("session_version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_user_email_case_unique" ON "inventory_users" USING btree (lower("email"));
--> statement-breakpoint
CREATE TABLE "inventory_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_membership_role_valid" CHECK ("role" IN ('SUPER_ADMIN','PARTNER_ADMIN','INVENTORY_MANAGER','UNIT_MANAGER','FINANCE','VIEWER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_membership_user_organization_unique" ON "inventory_memberships" USING btree ("user_id","organization_id");
--> statement-breakpoint
CREATE TABLE "inventory_unit_access" (
	"membership_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_unit_access_pk" PRIMARY KEY("membership_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"session_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_session_token_hash_unique" ON "inventory_sessions" USING btree ("token_hash");
CREATE INDEX "inventory_session_user_active" ON "inventory_sessions" USING btree ("user_id","expires_at");
--> statement-breakpoint
CREATE TABLE "inventory_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_invite_dates_valid" CHECK ("used_at" IS NULL OR "used_at" >= "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_invite_token_hash_unique" ON "inventory_invites" USING btree ("token_hash");
CREATE INDEX "inventory_invite_user" ON "inventory_invites" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE TABLE "inventory_auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event" text NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_auth_event_valid" CHECK ("event" IN ('LOGIN_SUCCESS','LOGIN_FAILURE','LOGOUT','INVITE_CREATED','INVITE_ACCEPTED','USER_ACTIVATED','USER_DEACTIVATED'))
);
--> statement-breakpoint
INSERT INTO "inventory_organizations" ("id","name") VALUES ('a1100000-0000-4000-8000-000000000001','Allik') ON CONFLICT DO NOTHING;
INSERT INTO "inventory_units" ("id","organization_id","name") VALUES
('a1100000-0000-4000-8000-000000000101','a1100000-0000-4000-8000-000000000001','Fortaleza'),
('a1100000-0000-4000-8000-000000000102','a1100000-0000-4000-8000-000000000001','Juazeiro do Norte')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "unit_id" uuid;
ALTER TABLE "inventory_products" ADD COLUMN "organization_id" uuid;
ALTER TABLE "inventory_suppliers" ADD COLUMN "organization_id" uuid;
ALTER TABLE "inventory_purchases" ADD COLUMN "unit_id" uuid;
ALTER TABLE "inventory_catalog_changes" ADD COLUMN "actor_user_id" uuid;
ALTER TABLE "inventory_supplier_changes" ADD COLUMN "actor_user_id" uuid;
ALTER TABLE "inventory_supplier_orders" ADD COLUMN "actor_user_id" uuid;
ALTER TABLE "inventory_movements" ADD COLUMN "actor_user_id" uuid;
ALTER TABLE "inventory_audit" ADD COLUMN "actor_user_id" uuid;
--> statement-breakpoint
UPDATE "inventory_products" SET "organization_id"='a1100000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;
UPDATE "inventory_suppliers" SET "organization_id"='a1100000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;
UPDATE "inventory_purchases" SET "unit_id"='a1100000-0000-4000-8000-000000000102' WHERE "unit_id" IS NULL;
UPDATE "inventory_locations" SET "unit_id"='a1100000-0000-4000-8000-000000000102'
WHERE "unit_id" IS NULL AND lower("name") IN ('allik juazeiro do norte','juazeiro do norte — estoque central','juazeiro do norte - estoque central');
UPDATE "inventory_locations" SET "unit_id"='a1100000-0000-4000-8000-000000000101'
WHERE "unit_id" IS NULL AND lower("name") IN ('allik fortaleza','fortaleza — estoque central','fortaleza - estoque central');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM inventory_locations WHERE unit_id IS NULL) THEN
    RAISE EXCEPTION 'Classifique explicitamente os locais existentes antes de aplicar a migration Pilot';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO "inventory_locations" ("id","name","active","version","unit_id")
VALUES ('a1100000-0000-4000-8000-000000001101','Fortaleza — Estoque Central',true,0,'a1100000-0000-4000-8000-000000000101')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "inventory_locations" ALTER COLUMN "unit_id" SET NOT NULL;
ALTER TABLE "inventory_products" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "inventory_suppliers" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "inventory_purchases" ALTER COLUMN "unit_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id");
ALTER TABLE "inventory_memberships" ADD CONSTRAINT "inventory_memberships_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "inventory_users"("id");
ALTER TABLE "inventory_memberships" ADD CONSTRAINT "inventory_memberships_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id");
ALTER TABLE "inventory_unit_access" ADD CONSTRAINT "inventory_unit_access_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "inventory_memberships"("id") ON DELETE CASCADE;
ALTER TABLE "inventory_unit_access" ADD CONSTRAINT "inventory_unit_access_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id");
ALTER TABLE "inventory_sessions" ADD CONSTRAINT "inventory_sessions_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "inventory_users"("id") ON DELETE CASCADE;
ALTER TABLE "inventory_invites" ADD CONSTRAINT "inventory_invites_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "inventory_users"("id");
ALTER TABLE "inventory_invites" ADD CONSTRAINT "inventory_invites_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id");
ALTER TABLE "inventory_invites" ADD CONSTRAINT "inventory_invites_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "inventory_users"("id");
ALTER TABLE "inventory_auth_events" ADD CONSTRAINT "inventory_auth_events_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "inventory_users"("id");
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id");
ALTER TABLE "inventory_products" ADD CONSTRAINT "inventory_products_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id");
ALTER TABLE "inventory_suppliers" ADD CONSTRAINT "inventory_suppliers_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id");
ALTER TABLE "inventory_purchases" ADD CONSTRAINT "inventory_purchases_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id");
ALTER TABLE "inventory_catalog_changes" ADD CONSTRAINT "inventory_catalog_changes_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id");
ALTER TABLE "inventory_supplier_changes" ADD CONSTRAINT "inventory_supplier_changes_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id");
ALTER TABLE "inventory_supplier_orders" ADD CONSTRAINT "inventory_supplier_orders_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id");
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id");
ALTER TABLE "inventory_audit" ADD CONSTRAINT "inventory_audit_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id");
--> statement-breakpoint
CREATE INDEX "inventory_location_unit" ON "inventory_locations" USING btree ("unit_id");
CREATE INDEX "inventory_purchase_unit" ON "inventory_purchases" USING btree ("unit_id","created_at");
CREATE INDEX "inventory_movement_actor_user" ON "inventory_movements" USING btree ("actor_user_id","created_at");
--> statement-breakpoint
CREATE TRIGGER auth_event_immutable BEFORE UPDATE OR DELETE ON inventory_auth_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_apply_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE controlled boolean; active_product boolean;
BEGIN
  SELECT p.stock_controlled, p.active INTO controlled, active_product
    FROM inventory_products p JOIN inventory_lots l ON l.product_id=p.id WHERE l.id=NEW.lot_id;
  IF NOT controlled OR NOT active_product THEN RAISE EXCEPTION 'Product does not allow stock movement'; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_locations WHERE id=NEW.location_id AND active) THEN RAISE EXCEPTION 'Location is inactive'; END IF;
  IF NEW.type IN ('OUT','LOSS','DAMAGE','EXPIRED','CONSUMPTION') AND EXISTS(SELECT 1 FROM inventory_lots WHERE id=NEW.lot_id AND (status<>'AVAILABLE' OR (NEW.type IN ('OUT','CONSUMPTION') AND expires_on < (NOW() AT TIME ZONE 'America/Fortaleza')::date))) THEN RAISE EXCEPTION 'Lot is not available for this movement'; END IF;
  INSERT INTO inventory_balances(lot_id,location_id,quantity) VALUES(NEW.lot_id,NEW.location_id,0)
    ON CONFLICT(lot_id,location_id) DO NOTHING;
  UPDATE inventory_balances SET quantity=quantity+NEW.delta WHERE lot_id=NEW.lot_id AND location_id=NEW.location_id;
  INSERT INTO inventory_audit(movement_id,actor,actor_user_id,action) VALUES(NEW.id,NEW.actor,NEW.actor_user_id,NEW.type);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "movement_type_sign";
ALTER TABLE "inventory_movements" ADD CONSTRAINT "movement_type_sign" CHECK (("type" = 'IN' AND "delta" > 0) OR ("type" IN ('OUT','LOSS','DAMAGE','EXPIRED','CONSUMPTION') AND "delta" < 0) OR "type" IN ('TRANSFER','ADJUSTMENT','REVERSAL'));
--> statement-breakpoint
CREATE TABLE "inventory_write_offs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"movement_id" uuid NOT NULL,
	"type" text NOT NULL,
	"request_hash" text NOT NULL,
	"reference" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_write_off_movement_unique" UNIQUE("movement_id"),
	CONSTRAINT "inventory_write_off_type_valid" CHECK ("type" IN ('LOSS','DAMAGE','EXPIRED','CONSUMPTION'))
);
--> statement-breakpoint
ALTER TABLE "inventory_write_offs" ADD CONSTRAINT "inventory_write_offs_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "inventory_movements"("id");
CREATE TRIGGER write_off_immutable BEFORE UPDATE OR DELETE ON inventory_write_offs FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
