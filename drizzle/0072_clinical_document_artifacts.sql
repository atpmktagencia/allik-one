ALTER TABLE inventory_encounter_documents ADD COLUMN prescription_source jsonb;
--> statement-breakpoint
ALTER TABLE inventory_encounter_documents ADD CONSTRAINT encounter_document_prescription_source_object CHECK (prescription_source IS NULL OR (type='PRESCRIPTION' AND jsonb_typeof(prescription_source)='object'));
--> statement-breakpoint
CREATE TABLE inventory_clinical_document_artifacts (
  document_id uuid PRIMARY KEY REFERENCES inventory_encounter_documents(id),
  organization_id uuid NOT NULL REFERENCES inventory_organizations(id),
  renderer_version text NOT NULL CHECK (char_length(renderer_version) BETWEEN 1 AND 100),
  pdf bytea NOT NULL CHECK (octet_length(pdf) BETWEEN 1 AND 5242880),
  pdf_sha256 text NOT NULL CHECK (pdf_sha256=encode(sha256(pdf),'hex')),
  html text NOT NULL CHECK (octet_length(html) BETWEEN 1 AND 1048576),
  html_sha256 text NOT NULL CHECK (html_sha256=encode(sha256(convert_to(html,'UTF8')),'hex')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
--> statement-breakpoint
CREATE FUNCTION inventory_validate_clinical_document_artifact() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.inventory_encounter_documents d
    JOIN public.inventory_clinical_document_seals s ON s.document_id=d.id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id AND d.status='FINAL'
    AND d.final_snapshot IS NOT NULL
    AND s.content_sha256=encode(sha256(convert_to(d.final_snapshot::text,'UTF8')),'hex')) THEN
    RAISE EXCEPTION 'artifact requires scoped sealed final snapshot';
  END IF;
  NEW.created_at := transaction_timestamp();
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER clinical_document_artifact_validate BEFORE INSERT ON inventory_clinical_document_artifacts FOR EACH ROW EXECUTE FUNCTION inventory_validate_clinical_document_artifact();
--> statement-breakpoint
CREATE TRIGGER clinical_document_artifact_immutable BEFORE UPDATE OR DELETE ON inventory_clinical_document_artifacts FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER clinical_document_artifact_no_truncate BEFORE TRUNCATE ON inventory_clinical_document_artifacts FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
-- Existing legacy siblings remain readable; new parallel rectifications are refused.
CREATE FUNCTION inventory_guard_single_rectification() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.kind='RECTIFICATION' THEN
    PERFORM 1 FROM public.inventory_encounter_documents WHERE id=NEW.parent_document_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.inventory_clinical_document_amendments WHERE parent_document_id=NEW.parent_document_id AND kind='RECTIFICATION') THEN
      RAISE EXCEPTION 'original already has a rectification';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER clinical_document_rectification_single BEFORE INSERT ON inventory_clinical_document_amendments FOR EACH ROW EXECUTE FUNCTION inventory_guard_single_rectification();
--> statement-breakpoint
CREATE FUNCTION inventory_guard_final_rectification() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE parent_id uuid;
BEGIN
  IF NEW.status='FINAL' THEN
    SELECT parent_document_id INTO parent_id FROM public.inventory_clinical_document_amendments WHERE document_id=NEW.id AND kind='RECTIFICATION';
    IF parent_id IS NOT NULL THEN
      PERFORM 1 FROM public.inventory_encounter_documents WHERE id=parent_id FOR UPDATE;
      IF EXISTS (SELECT 1 FROM public.inventory_clinical_document_amendments a JOIN public.inventory_encounter_documents d ON d.id=a.document_id WHERE a.parent_document_id=parent_id AND a.kind='RECTIFICATION' AND d.id<>NEW.id AND d.status='FINAL') THEN
        RAISE EXCEPTION 'original already has a finalized rectification';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER clinical_document_rectification_final BEFORE INSERT OR UPDATE ON inventory_encounter_documents FOR EACH ROW EXECUTE FUNCTION inventory_guard_final_rectification();
