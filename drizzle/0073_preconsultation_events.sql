CREATE TABLE inventory_preconsultation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  invitation_id uuid REFERENCES inventory_preconsultation_invitations(id),
  organization_id uuid REFERENCES inventory_organizations(id),
  unit_id uuid REFERENCES inventory_units(id),
  patient_id uuid REFERENCES inventory_patients(id),
  actor_user_id uuid REFERENCES inventory_users(id),
  action text NOT NULL,
  outcome text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT preconsultation_event_action CHECK (action IN ('READ','SUBMIT','STATUS','INVITE','REISSUE','REVOKE')),
  CONSTRAINT preconsultation_event_outcome CHECK (outcome IN ('SUCCESS','UNAVAILABLE','INVALID','CONFLICT')),
  CONSTRAINT preconsultation_event_actor CHECK (
    (action IN ('READ','SUBMIT','STATUS') AND actor_user_id IS NULL) OR
    (action IN ('INVITE','REISSUE','REVOKE') AND actor_user_id IS NOT NULL AND invitation_id IS NOT NULL)
  ),
  CONSTRAINT preconsultation_event_scope CHECK (
    (invitation_id IS NOT NULL AND organization_id IS NOT NULL AND unit_id IS NOT NULL AND patient_id IS NOT NULL) OR
    (invitation_id IS NULL AND organization_id IS NULL AND unit_id IS NULL AND patient_id IS NULL
     AND action IN ('READ','SUBMIT','STATUS') AND outcome IN ('UNAVAILABLE','INVALID'))
  )
);
--> statement-breakpoint
CREATE INDEX preconsultation_event_invitation_time ON inventory_preconsultation_events(invitation_id,created_at);
--> statement-breakpoint
CREATE FUNCTION inventory_validate_preconsultation_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.invitation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM inventory_preconsultation_invitations i WHERE i.id=NEW.invitation_id
      AND i.organization_id=NEW.organization_id AND i.unit_id=NEW.unit_id AND i.patient_id=NEW.patient_id
  ) THEN RAISE EXCEPTION 'Invalid preconsultation event scope'; END IF;
  IF NEW.actor_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM inventory_memberships m WHERE m.user_id=NEW.actor_user_id
      AND m.organization_id=NEW.organization_id AND m.active
  ) THEN RAISE EXCEPTION 'Invalid preconsultation event actor'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER preconsultation_event_validate BEFORE INSERT ON inventory_preconsultation_events FOR EACH ROW EXECUTE FUNCTION inventory_validate_preconsultation_event();
--> statement-breakpoint
CREATE TRIGGER preconsultation_event_immutable BEFORE UPDATE OR DELETE ON inventory_preconsultation_events FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER preconsultation_event_no_truncate BEFORE TRUNCATE ON inventory_preconsultation_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
