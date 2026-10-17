CREATE TABLE "inventory_prescription_protocol_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"formula" jsonb NOT NULL,
	"archived" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_prescription_protocols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"formula" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_versions" ADD CONSTRAINT "inventory_prescription_protocol_versions_protocol_id_inventory_prescription_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."inventory_prescription_protocols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_versions" ADD CONSTRAINT "inventory_prescription_protocol_versions_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocol_versions" ADD CONSTRAINT "inventory_prescription_protocol_versions_author_user_id_inventory_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocols" ADD CONSTRAINT "inventory_prescription_protocols_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_prescription_protocols" ADD CONSTRAINT "inventory_prescription_protocols_author_user_id_inventory_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prescription_protocol_version_unique" ON "inventory_prescription_protocol_versions" USING btree ("protocol_id","version");
--> statement-breakpoint
CREATE FUNCTION inventory_validate_prescription_protocol() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Protocols cannot be deleted'; END IF;
 IF TG_TABLE_NAME='inventory_prescription_protocols' THEN
  IF NEW.version<1 OR jsonb_typeof(NEW.formula)<>'object' OR length(NEW.title) NOT BETWEEN 2 AND 160 THEN RAISE EXCEPTION 'Invalid protocol'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.id,NEW.organization_id,NEW.author_user_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.author_user_id,OLD.created_at) OR NEW.version<>OLD.version+1 OR OLD.archived) THEN RAISE EXCEPTION 'Invalid protocol origin or version'; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_memberships m WHERE m.user_id=NEW.author_user_id AND m.organization_id=NEW.organization_id AND m.active) THEN RAISE EXCEPTION 'Invalid protocol author'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM inventory_prescription_protocols p WHERE p.id=NEW.protocol_id AND (p.organization_id,p.author_user_id,p.version,p.title,p.formula,p.archived) IS NOT DISTINCT FROM (NEW.organization_id,NEW.author_user_id,NEW.version,NEW.title,NEW.formula,NEW.archived)) THEN RAISE EXCEPTION 'Invalid protocol snapshot'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER prescription_protocols_validate BEFORE INSERT OR UPDATE OR DELETE ON inventory_prescription_protocols FOR EACH ROW EXECUTE FUNCTION inventory_validate_prescription_protocol();
--> statement-breakpoint
CREATE TRIGGER prescription_protocol_versions_validate BEFORE INSERT ON inventory_prescription_protocol_versions FOR EACH ROW EXECUTE FUNCTION inventory_validate_prescription_protocol();
--> statement-breakpoint
CREATE TRIGGER prescription_protocol_versions_immutable BEFORE UPDATE OR DELETE ON inventory_prescription_protocol_versions FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER prescription_protocols_no_truncate BEFORE TRUNCATE ON inventory_prescription_protocols FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER prescription_protocol_versions_no_truncate BEFORE TRUNCATE ON inventory_prescription_protocol_versions FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
