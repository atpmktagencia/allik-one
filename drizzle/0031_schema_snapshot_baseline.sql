-- Snapshot-only baseline.
-- Migrations 0008 through 0030 already contain the cumulative SQL represented
-- by drizzle/meta/0031_snapshot.json. This no-op prevents Drizzle from trying to
-- recreate those existing objects while restoring future schema generation.
SELECT 1;
