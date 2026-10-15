ALTER TABLE "inventory_encounter_quote_changes" DROP CONSTRAINT "encounter_quote_change_action_valid";--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" DROP CONSTRAINT "encounter_quote_status_valid";--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" DROP CONSTRAINT "encounter_quote_issued_valid";--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD COLUMN "declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD COLUMN "payment_reference" text;--> statement-breakpoint
ALTER TABLE "inventory_encounter_quote_changes" ADD CONSTRAINT "encounter_quote_change_action_valid" CHECK ("inventory_encounter_quote_changes"."action" IN ('CREATE','UPDATE','ISSUE','APPROVE','DECLINE','REGISTER_PAYMENT'));--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD CONSTRAINT "encounter_quote_lifecycle_valid" CHECK (("inventory_encounter_quotes"."status" IN ('DRAFT','ISSUED') AND "inventory_encounter_quotes"."approved_at" IS NULL AND "inventory_encounter_quotes"."declined_at" IS NULL AND "inventory_encounter_quotes"."paid_at" IS NULL) OR ("inventory_encounter_quotes"."status"='APPROVED' AND "inventory_encounter_quotes"."approved_at" IS NOT NULL AND "inventory_encounter_quotes"."declined_at" IS NULL AND "inventory_encounter_quotes"."paid_at" IS NULL) OR ("inventory_encounter_quotes"."status"='DECLINED' AND "inventory_encounter_quotes"."declined_at" IS NOT NULL AND "inventory_encounter_quotes"."approved_at" IS NULL AND "inventory_encounter_quotes"."paid_at" IS NULL) OR ("inventory_encounter_quotes"."status"='PAID' AND "inventory_encounter_quotes"."approved_at" IS NOT NULL AND "inventory_encounter_quotes"."declined_at" IS NULL AND "inventory_encounter_quotes"."paid_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD CONSTRAINT "encounter_quote_payment_valid" CHECK (("inventory_encounter_quotes"."status"<>'PAID' AND "inventory_encounter_quotes"."payment_method" IS NULL AND "inventory_encounter_quotes"."payment_reference" IS NULL) OR ("inventory_encounter_quotes"."status"='PAID' AND "inventory_encounter_quotes"."payment_method" IS NOT NULL AND "inventory_encounter_quotes"."payment_method" IN ('PIX','CASH','CREDIT_CARD','DEBIT_CARD','BANK_TRANSFER','OTHER') AND char_length(coalesce("inventory_encounter_quotes"."payment_reference",''))<=500));--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD CONSTRAINT "encounter_quote_status_valid" CHECK ("inventory_encounter_quotes"."status" IN ('DRAFT','ISSUED','APPROVED','DECLINED','PAID'));--> statement-breakpoint
ALTER TABLE "inventory_encounter_quotes" ADD CONSTRAINT "encounter_quote_issued_valid" CHECK (("inventory_encounter_quotes"."status"='DRAFT' AND "inventory_encounter_quotes"."issued_at" IS NULL) OR ("inventory_encounter_quotes"."status"<>'DRAFT' AND "inventory_encounter_quotes"."issued_at" IS NOT NULL AND jsonb_array_length("inventory_encounter_quotes"."items")>0));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_protect_encounter_quote() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'encounter quotes cannot be deleted';
  END IF;
  IF (NEW.organization_id,NEW.unit_id,NEW.appointment_id,NEW.patient_id,NEW.prescription_id,NEW.created_by_user_id,NEW.created_at)
     IS DISTINCT FROM
     (OLD.organization_id,OLD.unit_id,OLD.appointment_id,OLD.patient_id,OLD.prescription_id,OLD.created_by_user_id,OLD.created_at) THEN
    RAISE EXCEPTION 'encounter quote identity is immutable';
  END IF;
  IF OLD.status <> 'DRAFT' THEN
    IF (NEW.items,NEW.commercial_notes,NEW.total_sale,NEW.estimated_cost,NEW.gross_result,NEW.issued_at)
       IS DISTINCT FROM (OLD.items,OLD.commercial_notes,OLD.total_sale,OLD.estimated_cost,OLD.gross_result,OLD.issued_at) THEN
      RAISE EXCEPTION 'issued encounter quote commercial snapshot is immutable';
    END IF;
    IF NOT ((OLD.status='ISSUED' AND NEW.status IN ('APPROVED','DECLINED')) OR (OLD.status='APPROVED' AND NEW.status='PAID')) THEN
      RAISE EXCEPTION 'invalid encounter quote lifecycle transition';
    END IF;
    IF NEW.approved_at IS DISTINCT FROM OLD.approved_at AND NOT (OLD.status='ISSUED' AND NEW.status='APPROVED') THEN
      RAISE EXCEPTION 'approval timestamp is immutable';
    END IF;
    IF NEW.declined_at IS DISTINCT FROM OLD.declined_at AND NOT (OLD.status='ISSUED' AND NEW.status='DECLINED') THEN
      RAISE EXCEPTION 'decline timestamp is immutable';
    END IF;
  ELSIF NEW.status NOT IN ('DRAFT','ISSUED') THEN
    RAISE EXCEPTION 'draft quotes must be issued before approval';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'encounter quote version must advance exactly once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
