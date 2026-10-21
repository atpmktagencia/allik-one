-- Read-only structural preflight for the existing objects referenced by migration 0077.
WITH relations AS (
 SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN (
 'inventory_patient_documents','inventory_organizations','inventory_units',
 'inventory_patients','inventory_users','inventory_memberships','inventory_unit_access')
), objects AS (
 SELECT r.relname,jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid)) ORDER BY c.conname) FROM pg_constraint c WHERE c.conrelid=r.oid AND c.contype<>'n'),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal)
 ) object FROM relations r
)
SELECT (SELECT jsonb_object_agg(relname,object ORDER BY relname) FROM objects) objects,
 (SELECT md5(prosrc) FROM pg_proc WHERE oid='inventory_reject_history_change()'::regprocedure) immutable_function_body_md5;
