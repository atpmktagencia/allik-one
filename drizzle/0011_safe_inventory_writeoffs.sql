CREATE OR REPLACE FUNCTION inventory_apply_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE controlled boolean; active_product boolean;
BEGIN
  SELECT p.stock_controlled, p.active INTO controlled, active_product
    FROM inventory_products p JOIN inventory_lots l ON l.product_id=p.id WHERE l.id=NEW.lot_id;
  IF NOT controlled OR NOT active_product THEN RAISE EXCEPTION 'Product does not allow stock movement'; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_locations WHERE id=NEW.location_id AND active) THEN RAISE EXCEPTION 'Location is inactive'; END IF;
  IF NEW.type IN ('OUT','CONSUMPTION') AND EXISTS(
    SELECT 1 FROM inventory_lots
    WHERE id=NEW.lot_id
      AND (status<>'AVAILABLE' OR expires_on < (NOW() AT TIME ZONE 'America/Fortaleza')::date)
  ) THEN RAISE EXCEPTION 'Lot is not available for consumption'; END IF;
  IF NEW.type='EXPIRED' AND EXISTS(
    SELECT 1 FROM inventory_lots
    WHERE id=NEW.lot_id AND expires_on >= (NOW() AT TIME ZONE 'America/Fortaleza')::date
  ) THEN RAISE EXCEPTION 'Lot is not expired'; END IF;
  INSERT INTO inventory_balances(lot_id,location_id,quantity) VALUES(NEW.lot_id,NEW.location_id,0)
    ON CONFLICT(lot_id,location_id) DO NOTHING;
  UPDATE inventory_balances SET quantity=quantity+NEW.delta WHERE lot_id=NEW.lot_id AND location_id=NEW.location_id;
  INSERT INTO inventory_audit(movement_id,actor,actor_user_id,action) VALUES(NEW.id,NEW.actor,NEW.actor_user_id,NEW.type);
  RETURN NEW;
END;
$$;
