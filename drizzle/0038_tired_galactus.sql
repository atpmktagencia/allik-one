ALTER TABLE "inventory_clinical_notes" ADD COLUMN "general_exam" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "cardiovascular_exam" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "respiratory_exam" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "abdominal_exam" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "neurological_exam" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "musculoskeletal_exam" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "skin_exam" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD COLUMN "other_exam" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_general_exam_valid" CHECK (char_length("inventory_clinical_notes"."general_exam")<=5000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_cardiovascular_exam_valid" CHECK (char_length("inventory_clinical_notes"."cardiovascular_exam")<=5000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_respiratory_exam_valid" CHECK (char_length("inventory_clinical_notes"."respiratory_exam")<=5000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_abdominal_exam_valid" CHECK (char_length("inventory_clinical_notes"."abdominal_exam")<=5000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_neurological_exam_valid" CHECK (char_length("inventory_clinical_notes"."neurological_exam")<=5000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_musculoskeletal_exam_valid" CHECK (char_length("inventory_clinical_notes"."musculoskeletal_exam")<=5000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_skin_exam_valid" CHECK (char_length("inventory_clinical_notes"."skin_exam")<=5000);--> statement-breakpoint
ALTER TABLE "inventory_clinical_notes" ADD CONSTRAINT "clinical_note_other_exam_valid" CHECK (char_length("inventory_clinical_notes"."other_exam")<=5000);