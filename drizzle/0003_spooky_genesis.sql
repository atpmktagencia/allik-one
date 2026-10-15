CREATE TABLE "inventory_operation_movements" (
	"movement_id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"request_hash" text NOT NULL,
	"source_id" uuid NOT NULL,
	"destination_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_type_valid" CHECK (("inventory_operations"."type" = 'TRANSFER' AND "inventory_operations"."destination_id" IS NOT NULL AND "inventory_operations"."destination_id" <> "inventory_operations"."source_id") OR ("inventory_operations"."type" = 'ADJUSTMENT' AND "inventory_operations"."destination_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "inventory_operation_movements" ADD CONSTRAINT "inventory_operation_movements_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_operation_movements" ADD CONSTRAINT "inventory_operation_movements_operation_id_inventory_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_operations" ADD CONSTRAINT "inventory_operations_source_id_inventory_locations_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_operations" ADD CONSTRAINT "inventory_operations_destination_id_inventory_locations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER inventory_operations_immutable BEFORE UPDATE OR DELETE ON inventory_operations
FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER inventory_operation_movements_immutable BEFORE UPDATE OR DELETE ON inventory_operation_movements
FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
