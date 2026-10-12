CREATE TABLE "inventory_user_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"before_data" jsonb NOT NULL,
	"after_data" jsonb NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_user_changes" ADD CONSTRAINT "inventory_user_changes_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_user_changes" ADD CONSTRAINT "inventory_user_changes_user_id_inventory_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_user_changes" ADD CONSTRAINT "inventory_user_changes_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inventory_user_change_history" ON "inventory_user_changes" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE TRIGGER inventory_user_change_immutable BEFORE UPDATE OR DELETE ON "inventory_user_changes" FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
