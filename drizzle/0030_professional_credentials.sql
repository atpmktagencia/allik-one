ALTER TABLE "inventory_users" ADD COLUMN "professional_council" text;
--> statement-breakpoint
ALTER TABLE "inventory_users" ADD COLUMN "council_number" text;
--> statement-breakpoint
ALTER TABLE "inventory_users" ADD COLUMN "council_region" text;
--> statement-breakpoint
ALTER TABLE "inventory_users" ADD CONSTRAINT "inventory_user_professional_council_complete"
CHECK (
  ("professional_council" IS NULL AND "council_number" IS NULL AND "council_region" IS NULL)
  OR (
    char_length(trim("professional_council")) BETWEEN 2 AND 20
    AND char_length(trim("council_number")) BETWEEN 2 AND 30
    AND "council_region" ~ '^[A-Z]{2}$'
  )
);
