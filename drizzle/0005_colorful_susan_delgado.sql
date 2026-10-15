CREATE TABLE "inventory_receipt_movements" (
	"movement_id" uuid PRIMARY KEY NOT NULL,
	"receipt_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_receipt_movements" ADD CONSTRAINT "inventory_receipt_movements_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_receipt_movements" ADD CONSTRAINT "inventory_receipt_movements_receipt_id_inventory_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inventory_receipts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO inventory_receipt_movements(movement_id,receipt_id)
SELECT m.id,r.id FROM inventory_movements m
JOIN inventory_receipts r ON lower(split_part(m.operation_key,':',1))=r.id::text
WHERE m.type='IN' AND m.operation_key ~ '^[[:xdigit:]-]{36}:[0-9]+$'
ON CONFLICT(movement_id) DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER inventory_receipt_movements_immutable BEFORE UPDATE OR DELETE ON inventory_receipt_movements
FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
