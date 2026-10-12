import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  integer,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const organizations = pgTable(
  "inventory_organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inventory_organization_name_case_unique").on(sql`lower(${t.name})`)],
);

export const units = pgTable(
  "inventory_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_unit_organization_name_unique").on(
      t.organizationId,
      sql`lower(${t.name})`,
    ),
  ],
);

export const users = pgTable(
  "inventory_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    profession: text("profession"),
    title: text("title"),
    professionalCouncil: text("professional_council"),
    councilNumber: text("council_number"),
    councilRegion: text("council_region"),
    passwordHash: text("password_hash"),
    active: boolean("active").notNull().default(true),
    sessionVersion: integer("session_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_user_email_case_unique").on(sql`lower(${t.email})`),
    check("inventory_user_session_version_nonnegative", sql`${t.sessionVersion} >= 0`),
    check(
      "inventory_user_professional_council_complete",
      sql`(${t.professionalCouncil} IS NULL AND ${t.councilNumber} IS NULL AND ${t.councilRegion} IS NULL) OR (char_length(trim(${t.professionalCouncil})) BETWEEN 2 AND 20 AND char_length(trim(${t.councilNumber})) BETWEEN 2 AND 30 AND ${t.councilRegion} ~ '^[A-Z]{2}$')`,
    ),
  ],
);

export const memberships = pgTable(
  "inventory_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    role: text("role").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_membership_user_organization_unique").on(t.userId, t.organizationId),
    check(
      "inventory_membership_role_valid",
      sql`${t.role} IN ('SUPER_ADMIN','PARTNER_ADMIN','INVENTORY_MANAGER','UNIT_MANAGER','FINANCE','VIEWER')`,
    ),
  ],
);

export const unitAccess = pgTable(
  "inventory_unit_access",
  {
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inventory_unit_access_pk").on(t.membershipId, t.unitId)],
);

export const sessions = pgTable(
  "inventory_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    sessionVersion: integer("session_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_session_user_active").on(t.userId, t.expiresAt)],
);

export const invites = pgTable(
  "inventory_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_invite_user").on(t.userId, t.createdAt)],
);

export const authEvents = pgTable("inventory_auth_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  event: text("event").notNull(),
  ipHash: text("ip_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userChanges = pgTable(
  "inventory_user_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    beforeData: jsonb("before_data").notNull(),
    afterData: jsonb("after_data").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_user_change_history").on(t.userId, t.createdAt)],
);

export const apiCredentials = pgTable(
  "inventory_api_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    permissions: text("permissions").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_api_credential_organization").on(t.organizationId, t.createdAt)],
);

export const apiCredentialEvents = pgTable(
  "inventory_api_credential_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => apiCredentials.id),
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    details: jsonb("details").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_api_credential_event_history").on(t.credentialId, t.createdAt)],
);

export const products = pgTable(
  "inventory_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    sku: text("sku").notNull().unique(),
    category: text("category").notNull(),
    unit: text("unit").notNull(),
    active: boolean("active").notNull().default(true),
    stockControlled: boolean("stock_controlled").notNull().default(true),
    minimum: numeric("minimum", { precision: 14, scale: 3 }).notNull().default("0"),
    version: integer("version").notNull().default(0),
  },
  (t) => [
    check("product_minimum_nonnegative", sql`${t.minimum} >= 0`),
    uniqueIndex("inventory_product_sku_case_unique").on(sql`lower(${t.sku})`),
  ],
);

export const pricingPresentations = pgTable(
  "inventory_pricing_presentations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    productId: uuid("product_id").references(() => products.id),
    name: text("name").notNull(),
    baseUnit: text("base_unit").notNull(),
    totalBaseQuantity: numeric("total_base_quantity", { precision: 18, scale: 6 }).notNull(),
    totalVolumeMl: numeric("total_volume_ml", { precision: 18, scale: 6 }),
    acquisitionCost: numeric("acquisition_cost", { precision: 14, scale: 4 }).notNull(),
    technicalLossPercent: numeric("technical_loss_percent", { precision: 7, scale: 4 })
      .notNull()
      .default("0"),
    additionalPresentationCost: numeric("additional_presentation_cost", {
      precision: 14,
      scale: 4,
    })
      .notNull()
      .default("0"),
    minimumMeasurableVolumeMl: numeric("minimum_measurable_volume_ml", {
      precision: 12,
      scale: 6,
    }),
    beyondUseHours: integer("beyond_use_hours"),
    pricingStatus: text("pricing_status").notNull().default("DRAFT"),
    costSource: text("cost_source"),
    costValidOn: date("cost_valid_on"),
    assumptionsNotes: text("assumptions_notes"),
    assumptionsConfirmed: boolean("assumptions_confirmed").notNull().default(false),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    validatedByActor: text("validated_by_actor"),
    validatedByUserId: uuid("validated_by_user_id").references(() => users.id),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_pricing_presentation_identity").on(
      t.organizationId,
      sql`lower(${t.name})`,
    ),
    index("inventory_pricing_presentation_product").on(t.productId),
    index("pricing_presentations_status_idx").on(t.organizationId, t.pricingStatus),
    check("pricing_presentation_status", sql`${t.pricingStatus} IN ('DRAFT','VALIDATED')`),
    check(
      "pricing_validation_requires_evidence",
      sql`${t.pricingStatus} = 'DRAFT' OR (${t.costSource} IS NOT NULL AND length(trim(${t.costSource})) >= 3 AND ${t.costValidOn} IS NOT NULL AND ${t.minimumMeasurableVolumeMl} IS NOT NULL AND ${t.beyondUseHours} IS NOT NULL AND ${t.assumptionsConfirmed} AND ${t.validatedAt} IS NOT NULL AND ${t.validatedByActor} IS NOT NULL AND length(trim(${t.validatedByActor})) >= 3)`,
    ),
  ],
);

export const pricingDoses = pgTable(
  "inventory_pricing_doses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    presentationId: uuid("presentation_id")
      .notNull()
      .references(() => pricingPresentations.id),
    name: text("name").notNull(),
    doseQuantity: numeric("dose_quantity", { precision: 18, scale: 6 }).notNull(),
    salePrice: numeric("sale_price", { precision: 14, scale: 2 }).notNull(),
    materialCost: numeric("material_cost", { precision: 14, scale: 4 }).notNull().default("0"),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_pricing_dose_identity").on(t.presentationId, sql`lower(${t.name})`),
  ],
);

export const pricingChanges = pgTable(
  "inventory_pricing_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    presentationId: uuid("presentation_id")
      .notNull()
      .references(() => pricingPresentations.id),
    doseId: uuid("dose_id").references(() => pricingDoses.id),
    action: text("action").notNull(),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data").notNull(),
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_pricing_change_history").on(t.organizationId, t.createdAt)],
);

export const patients = pgTable(
  "inventory_patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    primaryUnitId: uuid("primary_unit_id")
      .notNull()
      .references(() => units.id),
    internalCode: text("internal_code").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    phone2: text("phone2"),
    email: text("email"),
    documentType: text("document_type"),
    documentNumber: text("document_number"),
    noDocument: boolean("no_document").notNull().default(false),
    birthDate: date("birth_date"),
    insuranceData: jsonb("insurance_data").notNull().default({}),
    additionalData: jsonb("additional_data").notNull().default({}),
    privateData: jsonb("private_data").notNull().default({}),
    photoBlobPathname: text("photo_blob_pathname"),
    photoFilename: text("photo_filename"),
    photoContentType: text("photo_content_type"),
    active: boolean("active").notNull().default(true),
    consentStatus: text("consent_status").notNull().default("PENDING"),
    consentRecordedAt: timestamp("consent_recorded_at", { withTimezone: true }),
    consentRecordedByUserId: uuid("consent_recorded_by_user_id").references(() => users.id),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_patient_internal_code_unique").on(
      t.organizationId,
      sql`lower(${t.internalCode})`,
    ),
    index("inventory_patient_unit_active_name").on(
      t.primaryUnitId,
      t.active,
      sql`lower(${t.fullName})`,
    ),
    index("inventory_patient_organization").on(t.organizationId, t.createdAt),
    index("inventory_patient_document_search").on(
      t.organizationId,
      sql`lower(${t.documentNumber})`,
    ),
    check(
      "patient_internal_code_valid",
      sql`char_length(trim(${t.internalCode})) BETWEEN 3 AND 40`,
    ),
    check("patient_name_valid", sql`char_length(trim(${t.fullName})) BETWEEN 3 AND 180`),
    check(
      "patient_phone_valid",
      sql`${t.phone} IS NULL OR char_length(trim(${t.phone})) BETWEEN 8 AND 30`,
    ),
    check(
      "patient_email_valid",
      sql`${t.email} IS NULL OR char_length(trim(${t.email})) BETWEEN 5 AND 254`,
    ),
    check(
      "patient_phone2_valid",
      sql`${t.phone2} IS NULL OR char_length(trim(${t.phone2})) BETWEEN 8 AND 30`,
    ),
    check(
      "patient_document_valid",
      sql`(${t.noDocument} AND ${t.documentType} IS NULL AND ${t.documentNumber} IS NULL) OR (NOT ${t.noDocument} AND ${t.documentType} IN ('CPF','PASSPORT') AND char_length(trim(${t.documentNumber})) BETWEEN 5 AND 30) OR (NOT ${t.noDocument} AND ${t.documentType} IS NULL AND ${t.documentNumber} IS NULL)`,
    ),
    check(
      "patient_photo_metadata_valid",
      sql`(${t.photoBlobPathname} IS NULL AND ${t.photoFilename} IS NULL AND ${t.photoContentType} IS NULL) OR (${t.photoBlobPathname} IS NOT NULL AND char_length(trim(${t.photoFilename})) BETWEEN 1 AND 180 AND ${t.photoContentType} IN ('image/jpeg','image/png','image/heic','image/heif'))`,
    ),
    check(
      "patient_consent_status_valid",
      sql`${t.consentStatus} IN ('PENDING','RECORDED','REVOKED')`,
    ),
    check(
      "patient_consent_evidence_valid",
      sql`(${t.consentStatus} = 'PENDING' AND ${t.consentRecordedAt} IS NULL AND ${t.consentRecordedByUserId} IS NULL) OR (${t.consentStatus} IN ('RECORDED','REVOKED') AND ${t.consentRecordedAt} IS NOT NULL)`,
    ),
    check("patient_version_nonnegative", sql`${t.version} >= 0`),
  ],
);

export const patientChanges = pgTable(
  "inventory_patient_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    action: text("action").notNull(),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data").notNull(),
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_patient_change_history").on(t.patientId, t.createdAt),
    index("inventory_patient_change_organization").on(t.organizationId, t.createdAt),
    check("patient_change_action_valid", sql`${t.action} IN ('CREATE','UPDATE')`),
    check("patient_change_reason_valid", sql`char_length(trim(${t.reason})) BETWEEN 10 AND 500`),
  ],
);

export const careAppointments = pgTable(
  "inventory_care_appointments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    professionalUserId: uuid("professional_user_id")
      .notNull()
      .references(() => users.id),
    careType: text("care_type").notNull(),
    otherCareType: text("other_care_type"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    room: text("room").notNull(),
    chair: integer("chair"),
    resourceName: text("resource_name"),
    notes: text("notes").notNull().default(""),
    status: text("status").notNull().default("SCHEDULED"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("care_appointment_unit_period").on(t.unitId, t.startsAt, t.endsAt),
    index("care_appointment_professional_period").on(t.professionalUserId, t.startsAt, t.endsAt),
    index("care_appointment_patient_period").on(t.patientId, t.startsAt),
    check("care_appointment_type_valid", sql`${t.careType} ~ '^[A-Z0-9_]{2,40}$'`),
    check(
      "care_appointment_other_type_valid",
      sql`${t.otherCareType} IS NULL OR char_length(trim(${t.otherCareType})) BETWEEN 2 AND 80`,
    ),
    check(
      "care_appointment_period_valid",
      sql`${t.endsAt}>${t.startsAt} AND ${t.endsAt}<=${t.startsAt}+interval '12 hours'`,
    ),
    check("care_appointment_room_valid", sql`char_length(trim(${t.room})) BETWEEN 2 AND 80`),
    check("care_appointment_chair_valid", sql`${t.chair} IS NULL OR ${t.chair} IN (1,2)`),
    check(
      "care_appointment_resource_name_valid",
      sql`${t.resourceName} IS NULL OR char_length(trim(${t.resourceName})) BETWEEN 1 AND 80`,
    ),
    check("care_appointment_notes_valid", sql`char_length(${t.notes})<=1000`),
    check(
      "care_appointment_status_valid",
      sql`${t.status} IN ('SCHEDULED','CONFIRMED','IN_PROGRESS','COMPLETED','NO_SHOW','CANCELED')`,
    ),
    check("care_appointment_version_nonnegative", sql`${t.version}>=0`),
  ],
);

export const careTypes = pgTable(
  "inventory_care_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("care_type_org_code_unique").on(t.organizationId, t.code),
    uniqueIndex("care_type_org_name_unique").on(t.organizationId, sql`lower(${t.name})`),
  ],
);

export const careRooms = pgTable(
  "inventory_care_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("care_room_unit_name_unique").on(t.unitId, sql`lower(${t.name})`)],
);

export const careResources = pgTable(
  "inventory_care_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    roomId: uuid("room_id")
      .notNull()
      .references(() => careRooms.id),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("care_resource_room_name_unique").on(t.roomId, sql`lower(${t.name})`)],
);

export const careAppointmentChanges = pgTable(
  "inventory_care_appointment_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => careAppointments.id),
    action: text("action").notNull(),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data").notNull(),
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("care_appointment_change_history").on(t.appointmentId, t.createdAt),
    check(
      "care_appointment_change_action_valid",
      sql`${t.action} IN ('CREATE','UPDATE','RESCHEDULE','STATUS')`,
    ),
  ],
);

export const clinicalNotes = pgTable(
  "inventory_clinical_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    appointmentId: uuid("appointment_id")
      .notNull()
      .unique()
      .references(() => careAppointments.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    authorName: text("author_name").notNull(),
    professionalCouncil: text("professional_council").notNull(),
    councilNumber: text("council_number").notNull(),
    councilRegion: text("council_region").notNull(),
    evolution: text("evolution").notNull().default(""),
    conduct: text("conduct").notNull().default(""),
    systolicPressure: integer("systolic_pressure"),
    diastolicPressure: integer("diastolic_pressure"),
    heartRate: integer("heart_rate"),
    oxygenSaturation: numeric("oxygen_saturation", { precision: 5, scale: 2 }),
    temperatureC: numeric("temperature_c", { precision: 4, scale: 1 }),
    weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
    heightCm: numeric("height_cm", { precision: 5, scale: 1 }),
    status: text("status").notNull().default("DRAFT"),
    version: integer("version").notNull().default(0),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("clinical_note_patient_history").on(t.patientId, t.createdAt),
    index("clinical_note_unit_history").on(t.unitId, t.createdAt),
    check("clinical_note_status_valid", sql`${t.status} IN ('DRAFT','FINAL')`),
    check("clinical_note_version_nonnegative", sql`${t.version}>=0`),
    check("clinical_note_evolution_valid", sql`char_length(${t.evolution})<=20000`),
    check("clinical_note_conduct_valid", sql`char_length(${t.conduct})<=10000`),
    check(
      "clinical_note_pressure_valid",
      sql`(${t.systolicPressure} IS NULL OR ${t.systolicPressure} BETWEEN 40 AND 300) AND (${t.diastolicPressure} IS NULL OR ${t.diastolicPressure} BETWEEN 20 AND 200)`,
    ),
    check(
      "clinical_note_vitals_valid",
      sql`(${t.heartRate} IS NULL OR ${t.heartRate} BETWEEN 20 AND 300) AND (${t.oxygenSaturation} IS NULL OR ${t.oxygenSaturation} BETWEEN 50 AND 100) AND (${t.temperatureC} IS NULL OR ${t.temperatureC} BETWEEN 30 AND 45) AND (${t.weightKg} IS NULL OR ${t.weightKg}>0 AND ${t.weightKg}<=500) AND (${t.heightCm} IS NULL OR ${t.heightCm} BETWEEN 30 AND 250)`,
    ),
    check(
      "clinical_note_final_valid",
      sql`(${t.status}='DRAFT' AND ${t.finalizedAt} IS NULL) OR (${t.status}='FINAL' AND ${t.finalizedAt} IS NOT NULL AND char_length(trim(${t.evolution}))>=10)`,
    ),
  ],
);

export const clinicalNoteChanges = pgTable(
  "inventory_clinical_note_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    clinicalNoteId: uuid("clinical_note_id")
      .notNull()
      .references(() => clinicalNotes.id),
    action: text("action").notNull(),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("clinical_note_change_history").on(t.clinicalNoteId, t.createdAt),
    check("clinical_note_change_action_valid", sql`${t.action} IN ('CREATE','UPDATE','FINALIZE')`),
  ],
);

export const patientTreatments = pgTable(
  "inventory_patient_treatments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    doseQuantity: numeric("dose_quantity", { precision: 18, scale: 6 }).notNull(),
    doseUnit: text("dose_unit").notNull(),
    route: text("route").notNull(),
    frequencyEveryDays: numeric("frequency_every_days", { precision: 10, scale: 2 }).notNull(),
    firstScheduledOn: date("first_scheduled_on").notNull(),
    plannedAdministrations: integer("planned_administrations"),
    status: text("status").notNull().default("PLANNED"),
    version: integer("version").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_patient_treatment_patient_status").on(
      t.patientId,
      t.status,
      t.firstScheduledOn,
    ),
    index("inventory_patient_treatment_unit_product").on(t.unitId, t.productId),
    index("inventory_patient_treatment_organization").on(t.organizationId, t.createdAt),
    check("patient_treatment_dose_positive", sql`${t.doseQuantity} > 0`),
    check("patient_treatment_unit_valid", sql`${t.doseUnit} IN ('MG','ML','UI','UNIT')`),
    check("patient_treatment_route_valid", sql`char_length(trim(${t.route})) BETWEEN 2 AND 40`),
    check("patient_treatment_frequency_positive", sql`${t.frequencyEveryDays} > 0`),
    check(
      "patient_treatment_count_positive",
      sql`${t.plannedAdministrations} IS NULL OR ${t.plannedAdministrations} > 0`,
    ),
    check(
      "patient_treatment_status_valid",
      sql`${t.status} IN ('PLANNED','ACTIVE','PAUSED','COMPLETED','CANCELED')`,
    ),
    check("patient_treatment_version_nonnegative", sql`${t.version} >= 0`),
  ],
);

export const patientPrescriptions = pgTable(
  "inventory_patient_prescriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    treatmentId: uuid("treatment_id").references(() => patientTreatments.id),
    blobPathname: text("blob_pathname").notNull().unique(),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    prescriberName: text("prescriber_name"),
    councilNumber: text("council_number"),
    councilRegion: text("council_region"),
    issuedOn: date("issued_on"),
    validUntil: date("valid_until"),
    documentStatus: text("document_status").notNull().default("ACTIVE"),
    version: integer("version").notNull().default(1),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => patientPrescriptions.id),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_patient_prescription_patient").on(t.patientId, t.uploadedAt),
    index("inventory_patient_prescription_treatment").on(t.treatmentId),
    index("inventory_patient_prescription_organization").on(t.organizationId, t.uploadedAt),
    index("inventory_patient_prescription_treatment_status_validity").on(
      t.treatmentId,
      t.documentStatus,
      t.issuedOn,
      t.validUntil,
    ),
    check(
      "patient_prescription_filename_valid",
      sql`char_length(trim(${t.originalFilename})) BETWEEN 1 AND 180`,
    ),
    check(
      "patient_prescription_type_valid",
      sql`${t.contentType} IN ('application/pdf','image/jpeg','image/png','image/heic','image/heif')`,
    ),
    check("patient_prescription_size_valid", sql`${t.sizeBytes} BETWEEN 1 AND 10485760`),
    check(
      "patient_prescription_status_valid",
      sql`${t.documentStatus} IN ('ACTIVE','SUPERSEDED','REVOKED')`,
    ),
    check("patient_prescription_version_positive", sql`${t.version} > 0`),
    check(
      "patient_prescription_dates_valid",
      sql`${t.issuedOn} IS NULL OR (${t.validUntil} IS NOT NULL AND ${t.validUntil} >= ${t.issuedOn})`,
    ),
    check(
      "patient_prescription_metadata_complete",
      sql`(${t.prescriberName} IS NULL AND ${t.councilNumber} IS NULL AND ${t.councilRegion} IS NULL AND ${t.issuedOn} IS NULL AND ${t.validUntil} IS NULL) OR (${t.prescriberName} IS NOT NULL AND char_length(trim(${t.prescriberName})) BETWEEN 2 AND 150 AND ${t.councilNumber} IS NOT NULL AND char_length(trim(${t.councilNumber})) BETWEEN 3 AND 30 AND ${t.councilRegion} IS NOT NULL AND char_length(trim(${t.councilRegion})) BETWEEN 2 AND 10 AND ${t.issuedOn} IS NOT NULL AND ${t.validUntil} IS NOT NULL)`,
    ),
    check(
      "patient_prescription_not_self_superseding",
      sql`${t.supersedesId} IS NULL OR ${t.supersedesId} <> ${t.id}`,
    ),
  ],
);

export const patientPrescriptionAccess = pgTable(
  "inventory_patient_prescription_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    prescriptionId: uuid("prescription_id")
      .notNull()
      .references(() => patientPrescriptions.id),
    actor: text("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_patient_prescription_access_history").on(t.prescriptionId, t.accessedAt),
  ],
);

export const patientTreatmentChanges = pgTable(
  "inventory_patient_treatment_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    treatmentId: uuid("treatment_id")
      .notNull()
      .references(() => patientTreatments.id),
    action: text("action").notNull(),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data").notNull(),
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_patient_treatment_change_history").on(t.treatmentId, t.createdAt),
    index("inventory_patient_treatment_change_organization").on(t.organizationId, t.createdAt),
    check(
      "patient_treatment_change_action_valid",
      sql`${t.action} IN ('CREATE','UPDATE','UPLOAD_PRESCRIPTION')`,
    ),
    check(
      "patient_treatment_change_reason_valid",
      sql`char_length(trim(${t.reason})) BETWEEN 10 AND 500`,
    ),
  ],
);

export const patientTreatmentPurchases = pgTable(
  "inventory_patient_treatment_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    treatmentId: uuid("treatment_id")
      .notNull()
      .references(() => patientTreatments.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    purchasedQuantity: numeric("purchased_quantity", { precision: 18, scale: 6 }).notNull(),
    quantityUnit: text("quantity_unit").notNull(),
    totalValue: numeric("total_value", { precision: 14, scale: 2 }),
    reference: text("reference").notNull(),
    purchasedOn: date("purchased_on").notNull(),
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_patient_purchase_treatment_date").on(t.treatmentId, t.purchasedOn),
    index("inventory_patient_purchase_patient").on(t.patientId, t.createdAt),
    index("inventory_patient_purchase_organization").on(t.organizationId, t.createdAt),
    check("patient_purchase_quantity_positive", sql`${t.purchasedQuantity} > 0`),
    check("patient_purchase_unit_valid", sql`${t.quantityUnit} IN ('MG','ML','UI','UNIT')`),
    check(
      "patient_purchase_value_nonnegative",
      sql`${t.totalValue} IS NULL OR ${t.totalValue} >= 0`,
    ),
    check(
      "patient_purchase_reference_valid",
      sql`char_length(trim(${t.reference})) BETWEEN 3 AND 100`,
    ),
    check("patient_purchase_reason_valid", sql`char_length(trim(${t.reason})) BETWEEN 10 AND 500`),
  ],
);

export const patientTreatmentSchedule = pgTable(
  "inventory_patient_treatment_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    treatmentId: uuid("treatment_id")
      .notNull()
      .references(() => patientTreatments.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    sequence: integer("sequence").notNull(),
    scheduledOn: date("scheduled_on").notNull(),
    doseQuantity: numeric("dose_quantity", { precision: 18, scale: 6 }).notNull(),
    doseUnit: text("dose_unit").notNull(),
    status: text("status").notNull().default("PLANNED"),
    attendanceStatus: text("attendance_status").notNull().default("SCHEDULED"),
    version: integer("version").notNull().default(0),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_patient_schedule_treatment_sequence_unique").on(
      t.treatmentId,
      t.sequence,
    ),
    index("inventory_patient_schedule_unit_date_status").on(t.unitId, t.scheduledOn, t.status),
    index("inventory_patient_schedule_product_date").on(t.productId, t.scheduledOn),
    index("inventory_patient_schedule_patient").on(t.patientId, t.scheduledOn),
    index("inventory_patient_schedule_organization_date_active")
      .on(t.organizationId, t.scheduledOn, t.unitId, t.productId)
      .where(sql`${t.status} IN ('PLANNED','RESERVED')`),
    index("inventory_patient_schedule_unit_product_reserved")
      .on(t.unitId, t.productId, t.doseUnit)
      .where(sql`${t.status} = 'RESERVED'`),
    check("patient_schedule_sequence_positive", sql`${t.sequence} > 0`),
    check("patient_schedule_dose_positive", sql`${t.doseQuantity} > 0`),
    check("patient_schedule_unit_valid", sql`${t.doseUnit} IN ('MG','ML','UI','UNIT')`),
    check(
      "patient_schedule_status_valid",
      sql`${t.status} IN ('PLANNED','RESERVED','CONSUMED','CANCELED')`,
    ),
    check(
      "patient_schedule_attendance_status_valid",
      sql`${t.attendanceStatus} IN ('SCHEDULED','CONFIRMED','COMPLETED','CANCELED','NO_SHOW')`,
    ),
    check("patient_schedule_version_nonnegative", sql`${t.version} >= 0`),
  ],
);

export const patientScheduleChanges = pgTable(
  "inventory_patient_schedule_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => patientTreatmentSchedule.id),
    beforeData: jsonb("before_data").notNull(),
    afterData: jsonb("after_data").notNull(),
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_patient_schedule_change_history").on(t.scheduleId, t.createdAt),
    check(
      "patient_schedule_change_reason_valid",
      sql`char_length(trim(${t.reason})) BETWEEN 10 AND 500`,
    ),
  ],
);

export const locations = pgTable(
  "inventory_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    name: text("name").notNull().unique(),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(0),
  },
  (t) => [uniqueIndex("inventory_location_name_case_unique").on(sql`lower(${t.name})`)],
);

export const catalogChanges = pgTable(
  "inventory_catalog_changes",
  {
    id: uuid("id").primaryKey(),
    productId: uuid("product_id").references(() => products.id),
    locationId: uuid("location_id").references(() => locations.id),
    action: text("action").notNull(),
    requestHash: text("request_hash").notNull(),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data").notNull(),
    actor: text("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "catalog_change_target",
      sql`(${t.productId} IS NOT NULL) <> (${t.locationId} IS NOT NULL)`,
    ),
    check("catalog_change_action", sql`${t.action} IN ('CREATE','UPDATE')`),
    index("catalog_product_history").on(t.productId, t.createdAt),
    index("catalog_location_history").on(t.locationId, t.createdAt),
  ],
);
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
    actorUserId: uuid("actor_user_id").references(() => users.id),
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
  actorUserId: uuid("actor_user_id").references(() => users.id),
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

export const suppliers = pgTable(
  "inventory_suppliers",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull().unique(),
    active: boolean("active").notNull().default(true),
    phone: text("phone"),
    email: text("email"),
    version: integer("version").notNull().default(0),
  },
  (t) => [uniqueIndex("supplier_name_case_unique").on(sql`lower(${t.name})`)],
);

export const supplierCatalog = pgTable(
  "inventory_supplier_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    productId: uuid("product_id").references(() => products.id),
    code: text("code").notNull(),
    supplierSku: text("supplier_sku"),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    packaging: text("packaging").notNull(),
    contents: text("contents").notNull(),
    boxesPerPack: integer("boxes_per_pack"),
    price: numeric("price", { precision: 14, scale: 2 }),
    pricingNote: text("pricing_note"),
    priceSource: text("price_source").notNull(),
    sourcePage: integer("source_page"),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(0),
  },
  (t) => [
    uniqueIndex("supplier_catalog_code").on(t.supplierId, t.code),
    check("supplier_catalog_kind", sql`${t.kind} IN ('PRODUCT','KIT','ADDON')`),
    check("supplier_catalog_price", sql`${t.price} IS NULL OR ${t.price}>0`),
    check("supplier_catalog_boxes", sql`${t.boxesPerPack} IS NULL OR ${t.boxesPerPack}>0`),
  ],
);

export const supplierChanges = pgTable(
  "inventory_supplier_changes",
  {
    id: uuid("id").primaryKey(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    catalogItemId: uuid("catalog_item_id").references(() => supplierCatalog.id),
    action: text("action").notNull(),
    requestHash: text("request_hash").notNull(),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data").notNull(),
    actor: text("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("supplier_change_history").on(t.supplierId, t.createdAt)],
);

export const supplierOrders = pgTable("inventory_supplier_orders", {
  id: uuid("id")
    .primaryKey()
    .references(() => purchases.id),
  requestHash: text("request_hash").notNull(),
  supplierSnapshot: jsonb("supplier_snapshot").notNull(),
  itemsSnapshot: jsonb("items_snapshot").notNull(),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
  freight: numeric("freight", { precision: 14, scale: 2 }),
  total: numeric("total", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes").notNull(),
  actor: text("actor").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchases = pgTable(
  "inventory_purchases",
  {
    id: uuid("id").primaryKey(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    reference: text("reference").notNull().unique(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    requestHash: text("request_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_purchases_unit_created").on(t.unitId, t.createdAt)],
);

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
    index("inventory_purchase_items_product_pending")
      .on(t.productId, t.purchaseId)
      .where(sql`${t.received} < ${t.quantity}`),
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

export const receiptMovements = pgTable("inventory_receipt_movements", {
  movementId: uuid("movement_id")
    .primaryKey()
    .references(() => movements.id),
  receiptId: uuid("receipt_id")
    .notNull()
    .references(() => receipts.id),
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

export const applications = pgTable(
  "inventory_applications",
  {
    id: uuid("id").primaryKey(),
    requestHash: text("request_hash").notNull(),
    reference: text("reference").notNull().unique(),
    patientRef: text("patient_ref").notNull(),
    service: text("service").notNull(),
    professional: text("professional").notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "application_synthetic_patient",
      sql`${t.patientRef} IN ('demo-patient-a','demo-patient-b','demo-patient-c')`,
    ),
  ],
);

export const applicationMovements = pgTable("inventory_application_movements", {
  movementId: uuid("movement_id")
    .primaryKey()
    .references(() => movements.id),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id),
});

export const patientApplications = pgTable(
  "inventory_patient_applications",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    treatmentId: uuid("treatment_id")
      .notNull()
      .references(() => patientTreatments.id),
    scheduleId: uuid("schedule_id")
      .notNull()
      .unique()
      .references(() => patientTreatmentSchedule.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    presentationId: uuid("presentation_id")
      .notNull()
      .references(() => pricingPresentations.id),
    prescriptionId: uuid("prescription_id").references(() => patientPrescriptions.id),
    requestHash: text("request_hash").notNull(),
    reference: text("reference").notNull(),
    professional: text("professional").notNull(),
    doseQuantity: numeric("dose_quantity", { precision: 18, scale: 6 }).notNull(),
    doseUnit: text("dose_unit").notNull(),
    route: text("route"),
    doseVolumeMl: numeric("dose_volume_ml", { precision: 18, scale: 6 }),
    physicalQuantity: numeric("physical_quantity", { precision: 18, scale: 6 }).notNull(),
    occurrenceNotes: text("occurrence_notes").notNull().default(""),
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_patient_application_reference_unique").on(
      t.organizationId,
      sql`lower(${t.reference})`,
    ),
    index("inventory_patient_application_patient_date").on(t.patientId, t.createdAt),
    index("inventory_patient_application_unit_date").on(t.unitId, t.createdAt),
    check("patient_application_dose_positive", sql`${t.doseQuantity} > 0`),
    check(
      "patient_application_volume_positive",
      sql`${t.doseVolumeMl} IS NULL OR ${t.doseVolumeMl} > 0`,
    ),
    check(
      "patient_application_route_valid",
      sql`${t.route} IS NULL OR char_length(trim(${t.route})) BETWEEN 2 AND 40`,
    ),
    check("patient_application_occurrence_valid", sql`char_length(${t.occurrenceNotes}) <= 1000`),
    check("patient_application_physical_nonnegative", sql`${t.physicalQuantity} >= 0`),
    check("patient_application_unit_valid", sql`${t.doseUnit} IN ('MG','ML','UI','UNIT')`),
    check(
      "patient_application_reference_valid",
      sql`char_length(trim(${t.reference})) BETWEEN 3 AND 100`,
    ),
    check(
      "patient_application_professional_valid",
      sql`char_length(trim(${t.professional})) BETWEEN 3 AND 100`,
    ),
    check(
      "patient_application_reason_valid",
      sql`char_length(trim(${t.reason})) BETWEEN 10 AND 500`,
    ),
  ],
);

export const patientApplicationMovements = pgTable(
  "inventory_patient_application_movements",
  {
    movementId: uuid("movement_id")
      .primaryKey()
      .references(() => movements.id),
    patientApplicationId: uuid("patient_application_id")
      .notNull()
      .references(() => patientApplications.id),
  },
  (t) => [index("inventory_patient_application_movement_application").on(t.patientApplicationId)],
);

export const openPresentations = pgTable(
  "inventory_open_presentations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    presentationId: uuid("presentation_id")
      .notNull()
      .references(() => pricingPresentations.id),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id),
    baseUnit: text("base_unit").notNull(),
    initialBaseQuantity: numeric("initial_base_quantity", { precision: 18, scale: 6 }).notNull(),
    remainingBaseQuantity: numeric("remaining_base_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    usableUntil: timestamp("usable_until", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("OPEN"),
    version: integer("version").notNull().default(0),
    openedByUserId: uuid("opened_by_user_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_open_presentation_available").on(
      t.locationId,
      t.productId,
      t.presentationId,
      t.status,
      t.usableUntil,
    ),
    index("inventory_open_presentation_lot").on(t.lotId),
    check("open_presentation_unit_valid", sql`${t.baseUnit} IN ('MG','MCG','G','ML','UI','UNIT')`),
    check("open_presentation_initial_positive", sql`${t.initialBaseQuantity} > 0`),
    check(
      "open_presentation_remaining_valid",
      sql`${t.remainingBaseQuantity} >= 0 AND ${t.remainingBaseQuantity} <= ${t.initialBaseQuantity}`,
    ),
    check("open_presentation_window_valid", sql`${t.usableUntil} >= ${t.openedAt}`),
    check("open_presentation_status_valid", sql`${t.status} IN ('OPEN','DEPLETED','DISCARDED')`),
    check("open_presentation_version_nonnegative", sql`${t.version} >= 0`),
  ],
);

export const openPresentationEvents = pgTable(
  "inventory_open_presentation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    openPresentationId: uuid("open_presentation_id")
      .notNull()
      .references(() => openPresentations.id),
    patientApplicationId: uuid("patient_application_id").references(() => patientApplications.id),
    type: text("type").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_open_presentation_event_history").on(t.openPresentationId, t.createdAt),
    index("inventory_open_presentation_event_application").on(t.patientApplicationId),
    check(
      "open_presentation_event_type_valid",
      sql`${t.type} IN ('OPEN','CONSUME','TECHNICAL_LOSS','EXPIRED','DAMAGE','DISCARD')`,
    ),
    check("open_presentation_event_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "open_presentation_event_reason_valid",
      sql`char_length(trim(${t.reason})) BETWEEN 10 AND 500`,
    ),
  ],
);

export const writeOffs = pgTable("inventory_write_offs", {
  id: uuid("id").primaryKey(),
  movementId: uuid("movement_id")
    .notNull()
    .unique()
    .references(() => movements.id),
  type: text("type").notNull(),
  requestHash: text("request_hash").notNull(),
  reference: text("reference").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
