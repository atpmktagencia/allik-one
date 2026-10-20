ALTER TABLE "inventory_encounter_document_changes" DROP CONSTRAINT "encounter_document_change_action_valid";--> statement-breakpoint
ALTER TABLE "inventory_encounter_documents" ADD COLUMN "discarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_encounter_document_changes" ADD CONSTRAINT "encounter_document_change_action_valid" CHECK ("inventory_encounter_document_changes"."action" IN ('CREATE','UPDATE','FINALIZE','DISCARD'));--> statement-breakpoint
ALTER TABLE "inventory_encounter_documents" ADD CONSTRAINT "encounter_document_discard_draft_only" CHECK ("inventory_encounter_documents"."discarded_at" IS NULL OR "inventory_encounter_documents"."status"='DRAFT');
--> statement-breakpoint
CREATE FUNCTION inventory_protect_discarded_document() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF OLD.discarded_at IS NOT NULL THEN
    RAISE EXCEPTION 'Discarded clinical drafts are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER encounter_document_discarded_immutable BEFORE UPDATE ON inventory_encounter_documents
FOR EACH ROW EXECUTE FUNCTION inventory_protect_discarded_document();
