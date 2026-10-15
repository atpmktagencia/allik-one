CREATE INDEX "inventory_purchases_unit_created" ON "inventory_purchases" ("unit_id","created_at");
--> statement-breakpoint
CREATE INDEX "inventory_purchase_items_product_pending"
  ON "inventory_purchase_items" ("product_id","purchase_id") WHERE "received" < "quantity";
