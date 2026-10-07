CREATE TABLE "inventory_lot_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"previous_status" text NOT NULL,
	"new_status" text NOT NULL,
	"reason" text NOT NULL,
	"authorized_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_lot_exceptions_lot_unique" UNIQUE("lot_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_lot_exceptions" ADD CONSTRAINT "inventory_lot_exceptions_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "inventory_lot_exceptions" ("lot_id","previous_status","new_status","reason","authorized_by")
SELECT "id", "status", 'AVAILABLE',
  'Liberação excepcional autorizada pelo usuário sem número de lote disponível; identificador LOTE-PENDENTE preservado para transparência.',
  'usuario-allik'
FROM "inventory_lots"
WHERE "number" LIKE 'LOTE-PENDENTE-L%' AND "status" = 'QUARANTINED';
--> statement-breakpoint
UPDATE "inventory_lots"
SET "status" = 'AVAILABLE'
WHERE "number" LIKE 'LOTE-PENDENTE-L%' AND "status" = 'QUARANTINED';
--> statement-breakpoint
CREATE TRIGGER inventory_lot_exceptions_immutable BEFORE UPDATE OR DELETE ON inventory_lot_exceptions
FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
