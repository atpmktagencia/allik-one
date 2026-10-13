ALTER TABLE "inventory_encounter_documents" ADD COLUMN "final_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "inventory_encounter_documents" ADD CONSTRAINT "encounter_document_snapshot_valid" CHECK ("inventory_encounter_documents"."final_snapshot" IS NULL OR COALESCE(("inventory_encounter_documents"."status"='FINAL' AND jsonb_typeof("inventory_encounter_documents"."final_snapshot")='object'
        AND "inventory_encounter_documents"."final_snapshot" ?& ARRAY['snapshotVersion','patientName','patientCode','unitName','authorName','professionalCouncil','councilNumber','councilRegion','title','type','content','finalizedAt']
        AND jsonb_typeof("inventory_encounter_documents"."final_snapshot"->'patientName')='string'
        AND jsonb_typeof("inventory_encounter_documents"."final_snapshot"->'patientCode')='string'
        AND jsonb_typeof("inventory_encounter_documents"."final_snapshot"->'unitName')='string'
        AND jsonb_typeof("inventory_encounter_documents"."final_snapshot"->'authorName')='string'
        AND jsonb_typeof("inventory_encounter_documents"."final_snapshot"->'professionalCouncil')='string'
        AND jsonb_typeof("inventory_encounter_documents"."final_snapshot"->'councilNumber')='string'
        AND jsonb_typeof("inventory_encounter_documents"."final_snapshot"->'councilRegion')='string'
        AND jsonb_typeof("inventory_encounter_documents"."final_snapshot"->'finalizedAt')='string'
        AND "inventory_encounter_documents"."final_snapshot"->>'snapshotVersion'='1'
        AND "inventory_encounter_documents"."final_snapshot"->>'title'="inventory_encounter_documents"."title" AND "inventory_encounter_documents"."final_snapshot"->>'type'="inventory_encounter_documents"."type"
        AND "inventory_encounter_documents"."final_snapshot"->>'content'="inventory_encounter_documents"."content"),false));