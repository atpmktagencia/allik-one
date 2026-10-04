import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const products = pgTable(
  "inventory_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    sku: text("sku").notNull().unique(),
    category: text("category").notNull(),
    unit: text("unit").notNull(),
    active: boolean("active").notNull().default(true),
    stockControlled: boolean("stock_controlled").notNull().default(true),
    minimum: numeric("minimum", { precision: 14, scale: 3 }).notNull().default("0"),
  },
  (t) => [check("product_minimum_nonnegative", sql`${t.minimum} >= 0`)],
);

export const locations = pgTable("inventory_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
});
export const lots = pgTable(
  "inventory_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    number: text("number").notNull(),
    expiresOn: date("expires_on").notNull(),
    supplier: text("supplier").notNull(),
    unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
    status: text("status").notNull().default("AVAILABLE"),
  },
  (t) => [
    uniqueIndex("lot_product_number").on(t.productId, t.number),
    check("lot_cost_nonnegative", sql`${t.unitCost} >= 0`),
    check("lot_status_valid", sql`${t.status} in ('AVAILABLE', 'QUARANTINED', 'BLOCKED')`),
  ],
);
export const balances = pgTable(
  "inventory_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull().default("0"),
  },
  (t) => [
    uniqueIndex("balance_lot_location").on(t.lotId, t.locationId),
    check("balance_nonnegative", sql`${t.quantity} >= 0`),
  ],
);
export const movements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    type: text("type").notNull(),
    delta: numeric("delta", { precision: 14, scale: 3 }).notNull(),
    actor: text("actor").notNull(),
    reference: text("reference").notNull(),
    reason: text("reason").notNull(),
    operationKey: text("operation_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("movement_delta_nonzero", sql`${t.delta} <> 0`),
    check(
      "movement_type_sign",
      sql`(${t.type} = 'IN' and ${t.delta} > 0) or (${t.type} = 'OUT' and ${t.delta} < 0) or ${t.type} in ('TRANSFER','ADJUSTMENT','REVERSAL')`,
    ),
  ],
);
export const audit = pgTable("inventory_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  movementId: uuid("movement_id")
    .notNull()
    .references(() => movements.id),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const receipts = pgTable("inventory_receipts", {
  id: uuid("id").primaryKey(),
  requestHash: text("request_hash").notNull(),
  reference: text("reference").notNull(),
  purchaseId: uuid("purchase_id").references(() => purchases.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const suppliers = pgTable("inventory_suppliers", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
});

export const purchases = pgTable("inventory_purchases", {
  id: uuid("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  requestHash: text("request_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseItems = pgTable(
  "inventory_purchase_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    received: numeric("received", { precision: 14, scale: 3 }).notNull().default("0"),
    unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
  },
  (t) => [
    uniqueIndex("purchase_product_unique").on(t.purchaseId, t.productId),
    check("purchase_quantity_positive", sql`${t.quantity} > 0`),
    check("purchase_received_valid", sql`${t.received} >= 0 AND ${t.received} <= ${t.quantity}`),
    check("purchase_cost_nonnegative", sql`${t.unitCost} >= 0`),
  ],
);

export const receiptItems = pgTable("inventory_receipt_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id")
    .notNull()
    .references(() => receipts.id),
  purchaseItemId: uuid("purchase_item_id")
    .notNull()
    .references(() => purchaseItems.id),
  movementId: uuid("movement_id")
    .notNull()
    .unique()
    .references(() => movements.id),
});

export const operations = pgTable(
  "inventory_operations",
  {
    id: uuid("id").primaryKey(),
    type: text("type").notNull(),
    requestHash: text("request_hash").notNull(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => locations.id),
    destinationId: uuid("destination_id").references(() => locations.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "operation_type_valid",
      sql`(${t.type} = 'TRANSFER' AND ${t.destinationId} IS NOT NULL AND ${t.destinationId} <> ${t.sourceId}) OR (${t.type} = 'ADJUSTMENT' AND ${t.destinationId} IS NULL)`,
    ),
  ],
);

export const operationMovements = pgTable("inventory_operation_movements", {
  movementId: uuid("movement_id")
    .primaryKey()
    .references(() => movements.id),
  operationId: uuid("operation_id")
    .notNull()
    .references(() => operations.id),
});
