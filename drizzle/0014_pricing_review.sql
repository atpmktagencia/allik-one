ALTER TABLE "inventory_pricing_presentations"
  ADD COLUMN "pricing_status" text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "cost_source" text,
  ADD COLUMN "cost_valid_on" date,
  ADD COLUMN "assumptions_notes" text,
  ADD COLUMN "assumptions_confirmed" boolean NOT NULL DEFAULT false,
  ADD COLUMN "validated_at" timestamp with time zone,
  ADD COLUMN "validated_by_actor" text,
  ADD COLUMN "validated_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "inventory_pricing_presentations"
  ADD CONSTRAINT "pricing_presentation_status"
  CHECK ("pricing_status" IN ('DRAFT','VALIDATED'));
--> statement-breakpoint
ALTER TABLE "inventory_pricing_presentations"
  ADD CONSTRAINT "pricing_validation_requires_evidence"
  CHECK (
    "pricing_status" = 'DRAFT'
    OR (
      "cost_source" IS NOT NULL AND length(trim("cost_source")) >= 3
      AND "cost_valid_on" IS NOT NULL
      AND "minimum_measurable_volume_ml" IS NOT NULL
      AND "beyond_use_hours" IS NOT NULL
      AND "assumptions_confirmed"
      AND "validated_at" IS NOT NULL
      AND "validated_by_actor" IS NOT NULL
      AND length(trim("validated_by_actor")) >= 3
    )
  );
--> statement-breakpoint
ALTER TABLE "inventory_pricing_presentations"
  ADD CONSTRAINT "inventory_pricing_presentations_validated_by_user_id_inventory_users_id_fk"
  FOREIGN KEY ("validated_by_user_id") REFERENCES "public"."inventory_users"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pricing_presentations_status_idx"
  ON "inventory_pricing_presentations" USING btree ("organization_id","pricing_status");
