-- Pin the search path of every application function and trigger function.
-- The functions reference tables without a schema. Without a fixed search_path,
-- PostgreSQL resolves relation names in pg_temp before public, so a session
-- that can create temporary tables could shadow inventory_audit,
-- inventory_balances or the clinical guard tables and redirect trigger writes
-- and checks away from the real tables. pg_temp is listed last on purpose.
DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname LIKE 'inventory\_%' ESCAPE '\'
      AND p.prokind IN ('f', 'p')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp', fn);
  END LOOP;
END $$;
