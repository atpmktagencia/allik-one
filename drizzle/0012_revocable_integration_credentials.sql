CREATE TABLE "inventory_api_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"permissions" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_api_credential_name_valid" CHECK (char_length(trim("name")) BETWEEN 3 AND 100),
	CONSTRAINT "inventory_api_credential_permissions_not_empty" CHECK (cardinality("permissions") > 0),
	CONSTRAINT "inventory_api_credential_permissions_valid" CHECK (
		"permissions" <@ ARRAY[
			'inventory.read',
			'inventory.catalog.manage',
			'inventory.supplier.manage',
			'inventory.purchase.manage',
			'inventory.receive',
			'inventory.adjust',
			'inventory.trace',
			'inventory.audit.read'
		]::text[]
	),
	CONSTRAINT "inventory_api_credential_expiry_valid" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_api_credential_token_hash_unique" ON "inventory_api_credentials" USING btree ("token_hash");
CREATE INDEX "inventory_api_credential_organization" ON "inventory_api_credentials" USING btree ("organization_id","created_at");
--> statement-breakpoint
ALTER TABLE "inventory_api_credentials" ADD CONSTRAINT "inventory_api_credentials_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "inventory_organizations"("id");
ALTER TABLE "inventory_api_credentials" ADD CONSTRAINT "inventory_api_credentials_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "inventory_users"("id");
--> statement-breakpoint
CREATE TABLE "inventory_api_credential_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_api_credential_event_action_valid" CHECK ("action" IN ('CREATE','USE','REVOKE'))
);
--> statement-breakpoint
CREATE INDEX "inventory_api_credential_event_history" ON "inventory_api_credential_events" USING btree ("credential_id","created_at");
ALTER TABLE "inventory_api_credential_events" ADD CONSTRAINT "inventory_api_credential_events_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "inventory_api_credentials"("id");
ALTER TABLE "inventory_api_credential_events" ADD CONSTRAINT "inventory_api_credential_events_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "inventory_users"("id");
CREATE TRIGGER api_credential_event_immutable BEFORE UPDATE OR DELETE ON inventory_api_credential_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
