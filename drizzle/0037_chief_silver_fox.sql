ALTER TABLE "inventory_clinical_notes" ADD COLUMN "chief_complaint" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "current_history" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "personal_history" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "family_history" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "habits" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "systems_review" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_complaint_valid" CHECK (char_length("inventory_clinical_notes"."chief_complaint")<=2000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_current_history_valid" CHECK (char_length("inventory_clinical_notes"."current_history")<=10000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_personal_history_valid" CHECK (char_length("inventory_clinical_notes"."personal_history")<=10000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_family_history_valid" CHECK (char_length("inventory_clinical_notes"."family_history")<=10000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_habits_valid" CHECK (char_length("inventory_clinical_notes"."habits")<=5000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_systems_review_valid" CHECK (char_length("inventory_clinical_notes"."systems_review")<=10000);