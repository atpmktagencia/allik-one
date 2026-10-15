CREATE TABLE "inventory_professional_registrations" (
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"registry_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_professional_registrations" ADD CONSTRAINT "inventory_professional_registrations_membership_id_inventory_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."inventory_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_professional_registrations" ADD CONSTRAINT "inventory_professional_registrations_organization_id_inventory_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."inventory_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "professional_registration_identity_unique" ON "inventory_professional_registrations" USING btree ("organization_id","registry_key");--> statement-breakpoint
CREATE FUNCTION inventory_professional_registration_key(council text, number text, region text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c text := regexp_replace(upper(coalesce(council,'')), '[^A-Z]', '', 'g');
 n text := regexp_replace(upper(coalesce(number,'')), '[^A-Z0-9]', '', 'g');
 r text := upper(trim(coalesce(region,'')));
BEGIN
 IF c NOT IN ('CRM','COREN','CREFITO','CRP','CRN','CREFONO','CRO','CREF') OR
 r NOT IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') THEN RETURN NULL; END IF;
 IF left(n,length(c))=c THEN n:=substr(n,length(c)+1); END IF;
 n:=regexp_replace(n,'^0+','');
 IF n !~ '[1-9]' OR length(n)>30 OR (c='CRM' AND n !~ '^[0-9]+$') THEN RETURN NULL; END IF;
 RETURN c || '|' || n || '|' || r;
END $$;
--> statement-breakpoint
CREATE FUNCTION inventory_professional_registration_state(uid uuid, org uuid)
RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE
 WHEN coalesce(u.professional_council,u.council_number,u.council_region) IS NULL THEN 'UNREGISTERED'
 WHEN inventory_professional_registration_key(u.professional_council,u.council_number,u.council_region) IS NULL THEN 'INVALID'
 WHEN EXISTS (SELECT 1 FROM inventory_users other JOIN inventory_memberships m ON m.user_id=other.id
 WHERE m.organization_id=org AND other.id<>uid AND
 inventory_professional_registration_key(other.professional_council,other.council_number,other.council_region)=
 inventory_professional_registration_key(u.professional_council,u.council_number,u.council_region)) THEN 'DUPLICATE'
 ELSE 'OK' END FROM inventory_users u WHERE u.id=uid
$$;
--> statement-breakpoint
-- Conflicting historical profiles are retained without assigning an arbitrary owner.
INSERT INTO inventory_professional_registrations(membership_id,organization_id,registry_key)
SELECT m.id,m.organization_id,inventory_professional_registration_key(u.professional_council,u.council_number,u.council_region)
FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id
WHERE inventory_professional_registration_state(u.id,m.organization_id)='OK';
--> statement-breakpoint
CREATE FUNCTION inventory_refresh_professional_registration(mid uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE row record; k text;
BEGIN
 SELECT u.*,m.organization_id INTO row FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id WHERE m.id=mid;
 k:=inventory_professional_registration_key(row.professional_council,row.council_number,row.council_region);
 IF coalesce(row.professional_council,row.council_number,row.council_region) IS NULL THEN
 DELETE FROM inventory_professional_registrations WHERE membership_id=mid; RETURN;
 END IF;
 IF k IS NULL THEN RAISE EXCEPTION 'Invalid professional registration' USING ERRCODE='23514',CONSTRAINT='professional_registration_format_valid'; END IF;
 IF inventory_professional_registration_state(row.id,row.organization_id)='DUPLICATE' THEN
 RAISE EXCEPTION 'Professional registration already assigned' USING ERRCODE='23505',CONSTRAINT='professional_registration_identity_unique'; END IF;
 INSERT INTO inventory_professional_registrations(membership_id,organization_id,registry_key) VALUES(mid,row.organization_id,k)
 ON CONFLICT(membership_id) DO UPDATE SET organization_id=excluded.organization_id,registry_key=excluded.registry_key;
END $$;
--> statement-breakpoint
CREATE FUNCTION inventory_professional_registration_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mid uuid;
BEGIN
 IF TG_TABLE_NAME='inventory_memberships' THEN PERFORM inventory_refresh_professional_registration(NEW.id);
 ELSE
 IF ROW(NEW.professional_council,NEW.council_number,NEW.council_region) IS NOT DISTINCT FROM
 ROW(OLD.professional_council,OLD.council_number,OLD.council_region) THEN RETURN NEW; END IF;
 IF inventory_professional_registration_key(NEW.professional_council,NEW.council_number,NEW.council_region) IS NOT NULL AND
 inventory_professional_registration_key(NEW.professional_council,NEW.council_number,NEW.council_region)=
 inventory_professional_registration_key(OLD.professional_council,OLD.council_number,OLD.council_region) THEN RETURN NEW; END IF;
 FOR mid IN SELECT id FROM inventory_memberships WHERE user_id=NEW.id ORDER BY organization_id LOOP
 PERFORM inventory_refresh_professional_registration(mid);
 END LOOP;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER professional_registration_membership_sync AFTER INSERT OR UPDATE OF user_id,organization_id ON inventory_memberships
FOR EACH ROW EXECUTE FUNCTION inventory_professional_registration_sync();
--> statement-breakpoint
CREATE TRIGGER professional_registration_user_sync AFTER UPDATE OF professional_council,council_number,council_region ON inventory_users
FOR EACH ROW EXECUTE FUNCTION inventory_professional_registration_sync();
--> statement-breakpoint
CREATE FUNCTION inventory_guard_professional_registration_author() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF inventory_professional_registration_state(NEW.author_user_id,NEW.organization_id) IN ('DUPLICATE','INVALID') THEN
 RAISE EXCEPTION 'Professional registration requires administrative correction' USING ERRCODE='23514',CONSTRAINT='clinical_professional_registration_conflict';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER professional_registry_note_guard BEFORE INSERT OR UPDATE ON inventory_clinical_notes FOR EACH ROW EXECUTE FUNCTION inventory_guard_professional_registration_author();
--> statement-breakpoint
CREATE TRIGGER professional_registry_prescription_guard BEFORE INSERT OR UPDATE ON inventory_encounter_prescriptions FOR EACH ROW EXECUTE FUNCTION inventory_guard_professional_registration_author();
--> statement-breakpoint
CREATE TRIGGER professional_registry_document_guard BEFORE INSERT OR UPDATE ON inventory_encounter_documents FOR EACH ROW EXECUTE FUNCTION inventory_guard_professional_registration_author();
--> statement-breakpoint
CREATE FUNCTION inventory_guard_professional_reservation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM inventory_memberships m JOIN inventory_users u ON u.id=m.user_id
 WHERE m.id=NEW.membership_id AND m.organization_id=NEW.organization_id AND NEW.registry_key=
 inventory_professional_registration_key(u.professional_council,u.council_number,u.council_region)) THEN
 RAISE EXCEPTION 'Professional reservation scope mismatch' USING ERRCODE='23514',CONSTRAINT='professional_registration_format_valid'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER professional_registration_scope_guard BEFORE INSERT OR UPDATE ON inventory_professional_registrations
FOR EACH ROW EXECUTE FUNCTION inventory_guard_professional_reservation_scope();
