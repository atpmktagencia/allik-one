CREATE TABLE "inventory_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER receipt_immutable BEFORE UPDATE OR DELETE ON inventory_receipts FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
