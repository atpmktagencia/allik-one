CREATE TABLE "inventory_auth_rate_limits" (
	"key" text NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "auth_rate_limit_valid" CHECK ("inventory_auth_rate_limits"."key" ~ '^[a-f0-9]{64}$' AND "inventory_auth_rate_limits"."attempts">0)
);
--> statement-breakpoint
CREATE TABLE "inventory_password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"session_version" integer NOT NULL,
	"email_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_password_resets_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "password_reset_hashes_valid" CHECK ("inventory_password_resets"."token_hash" ~ '^[a-f0-9]{64}$' AND "inventory_password_resets"."email_hash" ~ '^[a-f0-9]{64}$' AND "inventory_password_resets"."session_version">=0)
);
--> statement-breakpoint
ALTER TABLE "inventory_password_resets" ADD CONSTRAINT "inventory_password_resets_user_id_inventory_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_limit_bucket" ON "inventory_auth_rate_limits" USING btree ("key","bucket");--> statement-breakpoint
CREATE INDEX "password_reset_user_time" ON "inventory_password_resets" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE inventory_auth_events DROP CONSTRAINT inventory_auth_event_valid;
--> statement-breakpoint
ALTER TABLE inventory_auth_events ADD CONSTRAINT inventory_auth_event_valid CHECK (event IN ('LOGIN_SUCCESS','LOGIN_FAILURE','LOGOUT','INVITE_CREATED','INVITE_ACCEPTED','USER_ACTIVATED','USER_DEACTIVATED','PASSWORD_CHANGED','PASSWORD_RESET','LEGACY_RESET_INVITE_REVOKED'));
--> statement-breakpoint
WITH revoked AS (
 UPDATE inventory_invites i SET revoked_at=now() FROM inventory_users u
 WHERE u.id=i.user_id AND u.password_hash IS NOT NULL AND i.used_at IS NULL AND i.revoked_at IS NULL RETURNING i.user_id
) INSERT INTO inventory_auth_events(user_id,event) SELECT DISTINCT user_id,'LEGACY_RESET_INVITE_REVOKED' FROM revoked;
--> statement-breakpoint
CREATE FUNCTION inventory_guard_credentialed_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.password_hash IS NOT NULL AND lower(NEW.email) IS DISTINCT FROM lower(OLD.email)
 THEN RAISE EXCEPTION 'credentialed email requires holder verification' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER credentialed_email_guard BEFORE UPDATE ON inventory_users FOR EACH ROW EXECUTE FUNCTION inventory_guard_credentialed_email();
