ALTER TABLE "inventory_clinical_notes" ADD COLUMN "diagnostic_hypotheses" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "clinical_plan" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "return_recommendation" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "return_on" date;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_diagnostic_hypotheses_valid" CHECK (char_length("inventory_clinical_notes"."diagnostic_hypotheses")<=10000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_clinical_plan_valid" CHECK (char_length("inventory_clinical_notes"."clinical_plan")<=10000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_return_recommendation_valid" CHECK (char_length("inventory_clinical_notes"."return_recommendation")<=2000);