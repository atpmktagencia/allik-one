ALTER TABLE "inventory_encounter_documents" ADD CONSTRAINT "encounter_document_identifier_valid" CHECK (
      NOT ("inventory_encounter_documents"."final_snapshot" ?| ARRAY['documentId','verificationCode']) OR COALESCE((
        "inventory_encounter_documents"."status"='FINAL' AND jsonb_typeof("inventory_encounter_documents"."final_snapshot"->'documentId')='string'
        AND "inventory_encounter_documents"."final_snapshot"->>'documentId'="inventory_encounter_documents"."id"::text
        AND jsonb_typeof("inventory_encounter_documents"."final_snapshot"->'verificationCode')='string'
        AND "inventory_encounter_documents"."final_snapshot"->>'verificationCode'='A1-'||upper("inventory_encounter_documents"."id"::text)),false));