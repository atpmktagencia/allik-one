-- Preserve the task unit after a patient transfer; API access requires both units.
CREATE OR REPLACE FUNCTION inventory_validate_care_task() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Care tasks must be canceled, not deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.organization_id,NEW.unit_id,NEW.patient_id,NEW.appointment_id,NEW.created_by_user_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.unit_id,OLD.patient_id,OLD.appointment_id,OLD.created_by_user_id,OLD.created_at) THEN RAISE EXCEPTION 'Task origin is immutable'; END IF;
 IF TG_OP='UPDATE' AND NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invalid task version'; END IF;
 IF NOT EXISTS(SELECT 1 FROM inventory_patients p JOIN inventory_units u ON u.id=NEW.unit_id WHERE p.id=NEW.patient_id AND p.organization_id=NEW.organization_id AND (TG_OP='UPDATE' OR p.primary_unit_id=NEW.unit_id) AND u.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invalid task patient scope'; END IF;
 IF NEW.appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_care_appointments a WHERE a.id=NEW.appointment_id AND a.organization_id=NEW.organization_id AND a.patient_id=NEW.patient_id AND a.unit_id=NEW.unit_id) THEN RAISE EXCEPTION 'Invalid task appointment scope'; END IF;
 IF NEW.assignee_user_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id) AND NOT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE u.id=NEW.assignee_user_id AND u.active AND m.active AND m.organization_id=NEW.organization_id AND m.role IN ('SUPER_ADMIN','PARTNER_ADMIN','UNIT_MANAGER','CLINICIAN') AND (m.role='SUPER_ADMIN' OR EXISTS(SELECT 1 FROM inventory_unit_access ua WHERE ua.membership_id=m.id AND ua.unit_id=NEW.unit_id))) THEN RAISE EXCEPTION 'Invalid task assignee scope'; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER inventory_care_task_events_no_truncate BEFORE TRUNCATE ON inventory_care_task_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
--> statement-breakpoint
CREATE TRIGGER inventory_care_tasks_no_truncate BEFORE TRUNCATE ON inventory_care_tasks FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_history_change();
