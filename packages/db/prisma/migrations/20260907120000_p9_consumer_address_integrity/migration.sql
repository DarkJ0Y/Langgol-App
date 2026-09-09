-- P9 (follow-up) — the consumer's default address becomes a real reference.
--
-- `consumer_profiles.default_address_id` has existed since P2 with NO foreign key and no
-- ownership rule, because nothing ever wrote to it. P9 puts it on a form, and an unconstrained
-- UUID column that a form can write is exactly the shape of an IDOR: a shopper could point their
-- profile at any address id they guessed and read a stranger's recipient name and phone number
-- back out of their own settings screen.
--
-- Closed here the same way P6 closed it for farms and the p9 migration closed it for the three
-- business profiles — with a trigger, because a foreign key can prove the address EXISTS but not
-- that it is THEIRS.
--
-- Refs: docs/07_SECURITY.md §4; docs/02_DATABASE.md §5

-- Any row already pointing somewhere it should not is cleared before the rule is imposed.
--
-- Nothing has ever written this column, so this is expected to affect zero rows. It runs anyway:
-- a migration that only works on a database that matches one's assumptions is a migration that
-- fails in production, and a stale pointer is not worth failing a deploy over.
UPDATE "consumer_profiles" c
   SET "default_address_id" = NULL
 WHERE c."default_address_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "addresses" a
      WHERE a."id" = c."default_address_id" AND a."user_id" = c."user_id"
   );

ALTER TABLE "consumer_profiles"
  ADD CONSTRAINT "consumer_profiles_address_fk"
  FOREIGN KEY ("default_address_id") REFERENCES "addresses"("id") ON DELETE SET NULL;

CREATE INDEX "consumer_profiles_address_id_idx"
  ON "consumer_profiles" ("default_address_id");

-- One function for four tables, not four copies of it.
--
-- The column name travels as a trigger argument because the consumer's is `default_address_id`
-- while the three business profiles use `address_id`. `COALESCE` keeps the default, so the three
-- triggers created by the p9 migration keep working untouched — this replacement is backward
-- compatible by construction rather than by a follow-up ALTER on each of them.
--
-- `to_jsonb(new)` rather than dynamic EXECUTE: it reads the column by name without building a
-- query string, so there is no interpolation here for anybody to get wrong later.
CREATE OR REPLACE FUNCTION profile_address_same_owner_fn()
RETURNS TRIGGER AS $$
DECLARE
  target_column TEXT := COALESCE(TG_ARGV[0], 'address_id');
  chosen        UUID;
  address_owner UUID;
BEGIN
  chosen := (to_jsonb(new) ->> target_column)::uuid;

  IF chosen IS NULL THEN
    RETURN new;
  END IF;

  SELECT a.user_id INTO address_owner FROM addresses a WHERE a.id = chosen;

  IF address_owner IS DISTINCT FROM new.user_id THEN
    RAISE EXCEPTION 'profile address must belong to the same user as the profile'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consumer_profile_address_same_owner
  BEFORE INSERT OR UPDATE OF default_address_id, user_id ON "consumer_profiles"
  FOR EACH ROW EXECUTE FUNCTION profile_address_same_owner_fn('default_address_id');

-- A shop pin, like an address pin, must be a plausible point in Bangladesh.
--
-- The bounds are the ones `packages/domain/src/location/address.ts` applies and the addresses
-- table already enforces. Restated here because a CHECK cannot import, but they are restated
-- from ONE source and tested against it — see the profiles domain tests.
ALTER TABLE "retailer_profiles"
  ADD CONSTRAINT "retailer_shop_location_paired"
  CHECK (("latitude" IS NULL) = ("longitude" IS NULL));

ALTER TABLE "retailer_profiles"
  ADD CONSTRAINT "retailer_shop_location_plausible"
  CHECK (
    "latitude" IS NULL
    OR ("latitude" BETWEEN 20.3 AND 26.7 AND "longitude" BETWEEN 88.0 AND 92.7)
  );
