CREATE TABLE "inventory_document_signature_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"identity_version" integer NOT NULL,
	"cpf_encrypted" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"source_pdf" "bytea" NOT NULL,
	"source_sha256" text NOT NULL,
	"state_hash" text NOT NULL,
	"provider_session_id" text,
	"provider_document_id" text,
	"redirect_url" text,
	"status" text DEFAULT 'PREPARING' NOT NULL,
	"signed_pdf" "bytea",
	"signed_sha256" text,
	"signed_at" timestamp with time zone,
	"certificate" jsonb,
	"validation_evidence" jsonb,
	"failure_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signature_status_valid" CHECK ("inventory_document_signature_attempts"."status" IN ('PREPARING','AWAITING_SIGNATURE','SIGNED','FAILED','CANCELED','EXPIRED')),
	CONSTRAINT "signature_source_valid" CHECK (octet_length("inventory_document_signature_attempts"."source_pdf") BETWEEN 5 AND 5242880 AND "inventory_document_signature_attempts"."source_sha256" ~ '^[a-f0-9]{64}$' AND "inventory_document_signature_attempts"."state_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "signature_signed_valid" CHECK (COALESCE((("inventory_document_signature_attempts"."status"='SIGNED' AND "inventory_document_signature_attempts"."signed_pdf" IS NOT NULL AND octet_length("inventory_document_signature_attempts"."signed_pdf") BETWEEN 5 AND 8388608 AND "inventory_document_signature_attempts"."signed_sha256" IS NOT NULL AND "inventory_document_signature_attempts"."signed_sha256" ~ '^[a-f0-9]{64}$' AND "inventory_document_signature_attempts"."signed_at" IS NOT NULL AND jsonb_typeof("inventory_document_signature_attempts"."certificate")='object' AND jsonb_typeof("inventory_document_signature_attempts"."validation_evidence")='object' AND "inventory_document_signature_attempts"."validation_evidence"->>'trustAnchor'='PkiBrazil' AND "inventory_document_signature_attempts"."validation_evidence"->>'originalSha256'="inventory_document_signature_attempts"."source_sha256" AND "inventory_document_signature_attempts"."validation_evidence"->>'signedSha256'="inventory_document_signature_attempts"."signed_sha256") OR ("inventory_document_signature_attempts"."status"<>'SIGNED' AND "inventory_document_signature_attempts"."signed_pdf" IS NULL AND "inventory_document_signature_attempts"."signed_sha256" IS NULL AND "inventory_document_signature_attempts"."signed_at" IS NULL)),false))
);
--> statement-breakpoint
CREATE TABLE "inventory_document_signature_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"attempt_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_signing_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"cpf_encrypted" text NOT NULL,
	"cpf_hash" text NOT NULL,
	"verified_by_user_id" uuid NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "signing_identity_hash_valid" CHECK ("inventory_signing_identities"."cpf_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "signing_identity_version_valid" CHECK ("inventory_signing_identities"."version">=0)
);
--> statement-breakpoint
ALTER TABLE "inventory_document_signature_attempts" ADD CONSTRAINT "inventory_document_signature_attempts_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_document_signature_attempts" ADD CONSTRAINT "inventory_document_signature_attempts_unit_id_inventory_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_document_signature_attempts" ADD CONSTRAINT "inventory_document_signature_attempts_document_id_inventory_encounter_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."inventory_encounter_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_document_signature_attempts" ADD CONSTRAINT "inventory_document_signature_attempts_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_document_signature_attempts" ADD CONSTRAINT "inventory_document_signature_attempts_identity_id_inventory_signing_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."inventory_signing_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_document_signature_events" ADD CONSTRAINT "inventory_document_signature_events_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_document_signature_events" ADD CONSTRAINT "inventory_document_signature_events_document_id_inventory_encounter_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."inventory_encounter_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_document_signature_events" ADD CONSTRAINT "inventory_document_signature_events_attempt_id_inventory_document_signature_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."inventory_document_signature_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_document_signature_events" ADD CONSTRAINT "inventory_document_signature_events_actor_user_id_inventory_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_signing_identities" ADD CONSTRAINT "inventory_signing_identities_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_signing_identities" ADD CONSTRAINT "inventory_signing_identities_user_id_inventory_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_signing_identities" ADD CONSTRAINT "inventory_signing_identities_verified_by_user_id_inventory_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."inventory_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signature_operation_unique" ON "inventory_document_signature_attempts" USING btree ("organization_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_active_document_unique" ON "inventory_document_signature_attempts" USING btree ("document_id") WHERE "inventory_document_signature_attempts"."status" IN ('PREPARING','AWAITING_SIGNATURE');--> statement-breakpoint
CREATE UNIQUE INDEX "signature_signed_document_unique" ON "inventory_document_signature_attempts" USING btree ("document_id") WHERE "inventory_document_signature_attempts"."status"='SIGNED';--> statement-breakpoint
CREATE UNIQUE INDEX "signature_provider_session_unique" ON "inventory_document_signature_attempts" USING btree ("provider_session_id");--> statement-breakpoint
CREATE INDEX "signature_document_history" ON "inventory_document_signature_attempts" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "signature_event_document_history" ON "inventory_document_signature_events" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_identity_user_unique" ON "inventory_signing_identities" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_identity_cpf_unique" ON "inventory_signing_identities" USING btree ("organization_id","cpf_hash");--> statement-breakpoint
CREATE FUNCTION inventory_protect_document_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'signature history is immutable'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PREPARING' THEN RAISE EXCEPTION 'signature must begin preparing'; END IF;
    IF NOT EXISTS(SELECT 1 FROM inventory_encounter_documents d
      JOIN inventory_signing_identities i ON i.id=NEW.identity_id AND i.organization_id=d.organization_id AND i.user_id=d.author_user_id AND i.version=NEW.identity_version AND i.cpf_encrypted=NEW.cpf_encrypted
      WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.unit_id=NEW.unit_id AND d.author_user_id=NEW.actor_user_id AND d.status='FINAL' AND d.final_snapshot IS NOT NULL)
    THEN RAISE EXCEPTION 'signature scope or author mismatch'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('SIGNED','FAILED','CANCELED','EXPIRED') THEN RAISE EXCEPTION 'closed signatures are immutable'; END IF;
  IF ROW(NEW.id,NEW.organization_id,NEW.unit_id,NEW.document_id,NEW.actor_user_id,NEW.identity_id,NEW.identity_version,NEW.cpf_encrypted,NEW.operation_id,NEW.source_pdf,NEW.source_sha256,NEW.state_hash,NEW.expires_at,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.unit_id,OLD.document_id,OLD.actor_user_id,OLD.identity_id,OLD.identity_version,OLD.cpf_encrypted,OLD.operation_id,OLD.source_pdf,OLD.source_sha256,OLD.state_hash,OLD.expires_at,OLD.created_at)
  THEN RAISE EXCEPTION 'signature source and identity are immutable'; END IF;
  IF OLD.provider_session_id IS NOT NULL AND ROW(NEW.provider_session_id,NEW.redirect_url) IS DISTINCT FROM ROW(OLD.provider_session_id,OLD.redirect_url)
  THEN RAISE EXCEPTION 'signature provider binding is immutable'; END IF;
  IF (OLD.status='PREPARING' AND NEW.status NOT IN ('AWAITING_SIGNATURE','FAILED','CANCELED','EXPIRED')) OR
     (OLD.status='AWAITING_SIGNATURE' AND NEW.status NOT IN ('SIGNED','FAILED','CANCELED','EXPIRED'))
  THEN RAISE EXCEPTION 'invalid signature status transition'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_signature_immutable BEFORE INSERT OR UPDATE OR DELETE ON inventory_document_signature_attempts FOR EACH ROW EXECUTE FUNCTION inventory_protect_document_signature();
--> statement-breakpoint
CREATE TRIGGER document_signature_event_immutable BEFORE UPDATE OR DELETE ON inventory_document_signature_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
