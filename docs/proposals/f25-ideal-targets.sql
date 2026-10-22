-- PROPOSTA NÃO APLICADA. Fora do diretório drizzle e do journal.
-- Requer revisão de autorização/backend antes de ativação.
BEGIN;
CREATE TABLE inventory_laboratory_ideal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  operation_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES inventory_organizations(id),
  unit_id uuid NOT NULL REFERENCES inventory_units(id),
  scope text NOT NULL CHECK (scope IN ('ORGANIZATION','PROFESSIONAL','PATIENT')),
  professional_id uuid REFERENCES inventory_users(id),
  patient_id uuid REFERENCES inventory_patients(id),
  biomarker_key text NOT NULL CHECK (length(biomarker_key) BETWEEN 1 AND 160),
  modality text NOT NULL CHECK (modality IN ('PERCENTAGE','ABSOLUTE','LITERAL')),
  unit text NOT NULL CHECK (length(trim(unit)) BETWEEN 1 AND 80),
  minimum numeric NOT NULL CHECK (minimum::text NOT IN ('NaN','Infinity','-Infinity')),
  maximum numeric NOT NULL CHECK (maximum::text NOT IN ('NaN','Infinity','-Infinity')),
  action text NOT NULL CHECK (action IN ('DEFINED','DISABLED')),
  effective_on date NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 1000),
  actor_user_id uuid NOT NULL REFERENCES inventory_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, stream_id, revision),
  UNIQUE (organization_id, operation_id),
  CHECK (minimum <= maximum),
  CHECK ((scope='ORGANIZATION' AND professional_id IS NULL AND patient_id IS NULL)
    OR (scope='PROFESSIONAL' AND professional_id IS NOT NULL AND patient_id IS NULL)
    OR (scope='PATIENT' AND patient_id IS NOT NULL AND professional_id IS NULL))
);
CREATE INDEX laboratory_ideal_scope_lookup ON inventory_laboratory_ideal_events
  (organization_id,unit_id,biomarker_key,modality,unit,effective_on,revision DESC);
CREATE FUNCTION inventory_guard_laboratory_ideal_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous inventory_laboratory_ideal_events;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text||':ideal:'||NEW.stream_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM inventory_units u WHERE u.id=NEW.unit_id AND u.organization_id=NEW.organization_id)
    OR (NEW.patient_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_patients p WHERE p.id=NEW.patient_id AND p.organization_id=NEW.organization_id))
    OR NOT EXISTS(SELECT 1 FROM inventory_memberships m WHERE m.user_id=NEW.actor_user_id AND m.organization_id=NEW.organization_id)
    OR (NEW.professional_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_memberships m WHERE m.user_id=NEW.professional_id AND m.organization_id=NEW.organization_id))
  THEN RAISE EXCEPTION 'ideal scope mismatch'; END IF;
  SELECT * INTO previous FROM inventory_laboratory_ideal_events
    WHERE organization_id=NEW.organization_id AND stream_id=NEW.stream_id ORDER BY revision DESC LIMIT 1;
  IF NOT FOUND THEN
    IF NEW.revision<>1 OR NEW.action<>'DEFINED' THEN RAISE EXCEPTION 'invalid initial ideal event'; END IF;
  ELSE
    IF NEW.revision<>previous.revision+1 THEN RAISE EXCEPTION 'stale ideal revision'; END IF;
    IF ROW(NEW.organization_id,NEW.unit_id,NEW.scope,NEW.professional_id,NEW.patient_id,NEW.biomarker_key,NEW.modality,NEW.unit)
       IS DISTINCT FROM ROW(previous.organization_id,previous.unit_id,previous.scope,previous.professional_id,previous.patient_id,previous.biomarker_key,previous.modality,previous.unit)
    THEN RAISE EXCEPTION 'immutable ideal identity'; END IF;
    IF NEW.action='DISABLED' AND ROW(NEW.minimum,NEW.maximum) IS DISTINCT FROM ROW(previous.minimum,previous.maximum)
    THEN RAISE EXCEPTION 'disable must preserve bounds'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER laboratory_ideal_event_guard BEFORE INSERT ON inventory_laboratory_ideal_events
  FOR EACH ROW EXECUTE FUNCTION inventory_guard_laboratory_ideal_event();
CREATE TRIGGER laboratory_ideal_event_immutable BEFORE UPDATE OR DELETE ON inventory_laboratory_ideal_events
  FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
CREATE TRIGGER laboratory_ideal_event_no_truncate BEFORE TRUNCATE ON inventory_laboratory_ideal_events
  FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
REVOKE ALL ON inventory_laboratory_ideal_events FROM PUBLIC;
GRANT SELECT,INSERT ON inventory_laboratory_ideal_events TO allik_runtime;
COMMIT;
-- Rollback operacional: desabilitar endpoints/flag da feature. NÃO executar DROP/DELETE,
-- NÃO remover journal após primeiro uso; tabela/eventos devem permanecer preservados.
