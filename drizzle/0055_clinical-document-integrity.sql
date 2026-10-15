CREATE TABLE "inventory_clinical_document_amendments" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"parent_document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"parent_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_document_amendment_kind_valid" CHECK ("inventory_clinical_document_amendments"."kind" IN ('ADDENDUM','RECTIFICATION')),
	CONSTRAINT "clinical_document_amendment_reason_valid" CHECK (char_length(trim("inventory_clinical_document_amendments"."reason")) BETWEEN 5 AND 2000),
	CONSTRAINT "clinical_document_amendment_hash_valid" CHECK ("inventory_clinical_document_amendments"."parent_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "inventory_clinical_document_seals" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"content_sha256" text NOT NULL,
	"sealed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_document_seal_hash_valid" CHECK ("inventory_clinical_document_seals"."content_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "inventory_clinical_document_amendments" ADD CONSTRAINT "inventory_clinical_document_amendments_document_id_inventory_encounter_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."inventory_encounter_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_document_amendments" ADD CONSTRAINT "inventory_clinical_document_amendments_parent_document_id_inventory_encounter_documents_id_fk" FOREIGN KEY ("parent_document_id") REFERENCES "public"."inventory_encounter_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_clinical_document_seals" ADD CONSTRAINT "inventory_clinical_document_seals_document_id_inventory_encounter_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."inventory_encounter_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_document_amendment_parent" ON "inventory_clinical_document_amendments" USING btree ("parent_document_id");--> statement-breakpoint
CREATE FUNCTION inventory_validate_document_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.sealed_at := transaction_timestamp();
  IF NOT EXISTS(SELECT 1 FROM inventory_encounter_documents d WHERE d.id=NEW.document_id AND d.status='FINAL' AND d.final_snapshot IS NOT NULL
    AND NEW.content_sha256=encode(sha256(convert_to(d.final_snapshot::text,'UTF8')),'hex')) THEN
    RAISE EXCEPTION 'document seal does not match finalized snapshot';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER clinical_document_seal_validate BEFORE INSERT ON inventory_clinical_document_seals FOR EACH ROW EXECUTE FUNCTION inventory_validate_document_seal();
--> statement-breakpoint
CREATE TRIGGER clinical_document_seal_immutable BEFORE UPDATE OR DELETE ON inventory_clinical_document_seals FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE FUNCTION inventory_seal_final_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='FINAL' AND NEW.final_snapshot IS NOT NULL THEN
    INSERT INTO inventory_clinical_document_seals(document_id,content_sha256) VALUES(NEW.id,encode(sha256(convert_to(NEW.final_snapshot::text,'UTF8')),'hex'));
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER clinical_document_seal_final AFTER INSERT OR UPDATE ON inventory_encounter_documents FOR EACH ROW EXECUTE FUNCTION inventory_seal_final_document();
--> statement-breakpoint
-- Marks integrity at migration time, without changing the historical document or claiming an earlier seal date.
INSERT INTO inventory_clinical_document_seals(document_id,content_sha256)
SELECT id,encode(sha256(convert_to(final_snapshot::text,'UTF8')),'hex') FROM inventory_encounter_documents WHERE status='FINAL' AND final_snapshot IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION inventory_validate_document_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := transaction_timestamp();
  IF NOT EXISTS(SELECT 1 FROM inventory_encounter_documents child
    JOIN inventory_encounter_documents parent ON parent.id=NEW.parent_document_id
    JOIN inventory_clinical_document_seals seal ON seal.document_id=parent.id
    WHERE child.id=NEW.document_id AND child.status='DRAFT' AND parent.status='FINAL'
    AND child.organization_id=parent.organization_id AND child.unit_id=parent.unit_id
    AND child.patient_id=parent.patient_id AND child.appointment_id=parent.appointment_id
    AND child.author_user_id=parent.author_user_id AND child.type=parent.type
    AND child.id<>parent.id AND seal.content_sha256=NEW.parent_sha256
    AND seal.content_sha256=encode(sha256(convert_to(parent.final_snapshot::text,'UTF8')),'hex')
    AND NOT EXISTS(SELECT 1 FROM inventory_clinical_document_amendments a WHERE a.document_id=parent.id)) THEN
    RAISE EXCEPTION 'invalid document amendment scope or source';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER clinical_document_amendment_validate BEFORE INSERT ON inventory_clinical_document_amendments FOR EACH ROW EXECUTE FUNCTION inventory_validate_document_amendment();
--> statement-breakpoint
CREATE TRIGGER clinical_document_amendment_immutable BEFORE UPDATE OR DELETE ON inventory_clinical_document_amendments FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE FUNCTION inventory_validate_amendment_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE metadata jsonb;
BEGIN
  SELECT jsonb_build_object('parentDocumentId',a.parent_document_id,'kind',a.kind,'reason',a.reason,'parentSha256',a.parent_sha256) INTO metadata FROM inventory_clinical_document_amendments a WHERE a.document_id=NEW.id;
  IF NEW.status='FINAL' AND (NEW.final_snapshot->'amendment') IS DISTINCT FROM metadata THEN
    RAISE EXCEPTION 'amendment snapshot mismatch';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER clinical_document_amendment_snapshot BEFORE INSERT OR UPDATE ON inventory_encounter_documents FOR EACH ROW EXECUTE FUNCTION inventory_validate_amendment_snapshot();
