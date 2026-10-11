ALTER TABLE "inventory_patients" ADD COLUMN "document_type" text;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD COLUMN "document_number" text;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD COLUMN "no_document" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD COLUMN "birth_date" date;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD COLUMN "phone2" text;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD COLUMN "insurance_data" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD COLUMN "additional_data" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD COLUMN "private_data" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD COLUMN "photo_blob_pathname" text;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD COLUMN "photo_filename" text;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD COLUMN "photo_content_type" text;
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD CONSTRAINT "patient_document_valid" CHECK (("no_document" AND "document_type" IS NULL AND "document_number" IS NULL) OR (NOT "no_document" AND "document_type" IN ('CPF','PASSPORT') AND char_length(trim("document_number")) BETWEEN 5 AND 30) OR (NOT "no_document" AND "document_type" IS NULL AND "document_number" IS NULL));
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD CONSTRAINT "patient_phone2_valid" CHECK ("phone2" IS NULL OR char_length(trim("phone2")) BETWEEN 8 AND 30);
--> statement-breakpoint
CREATE INDEX "inventory_patient_document_search" ON "inventory_patients" ("organization_id",lower("document_number"));
--> statement-breakpoint
ALTER TABLE "inventory_patients" ADD CONSTRAINT "patient_photo_metadata_valid" CHECK (("photo_blob_pathname" IS NULL AND "photo_filename" IS NULL AND "photo_content_type" IS NULL) OR ("photo_blob_pathname" IS NOT NULL AND char_length(trim("photo_filename")) BETWEEN 1 AND 180 AND "photo_content_type" IN ('image/jpeg','image/png','image/heic','image/heif')));
