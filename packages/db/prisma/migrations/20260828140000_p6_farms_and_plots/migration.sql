-- P6 — Farms and plots.
--
-- Extends the EXISTING `farms` table, which has been in the schema since P2 with its point and
-- polygon columns already in place, and adds `plots` beneath it. No parallel farm table: the one
-- that exists already carries the listings, so a second would immediately raise the question of
-- which farm a crop came from.
--
-- Every descriptive column added here is NULLABLE, the same decision as P5. An incomplete farm is
-- a farm. What the database enforces is consistency and OWNERSHIP, never completeness.
--
-- Refs: docs/02_DATABASE.md §5-6; docs/07_SECURITY.md §4

-- ------------------------------------------------------------------- vocabulary

-- What a farmer would answer, not a pedological classification. SALINE sits alongside the texture
-- classes rather than under them because coastal salinity is a distinct problem with distinct
-- remedies, and it is spreading — a farmer in Khulna needs to be able to say it.
CREATE TYPE "SoilType" AS ENUM (
  'LOAM', 'CLAY', 'CLAY_LOAM', 'SANDY', 'SANDY_LOAM', 'SILT', 'PEAT', 'SALINE'
);

-- ------------------------------------------------------------ farms: description

ALTER TABLE "farms"
  ADD COLUMN "area_amount_milli"    INTEGER,
  ADD COLUMN "area_unit"            "LandUnit",
  ADD COLUMN "ownership_type"       "LandOwnershipType",
  ADD COLUMN "soil_type"            "SoilType",
  ADD COLUMN "irrigation_available" BOOLEAN,
  ADD COLUMN "irrigation_method"    "IrrigationMethod",
  ADD COLUMN "water_source"         "WaterSource",
  ADD COLUMN "farming_method"       "FarmingMethod",
  ADD COLUMN "verification_status"  "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "address_id"           UUID;

-- `land_area_decimals` was added in P2 and never read or written by any code. It could only hold
-- decimals, so a farmer who said "two bigha" had their answer converted away before it was
-- stored — the precise mistake P5 was careful not to make. Replaced by the (amount, unit) pair
-- above. Verified empty across the estate before dropping.
ALTER TABLE "farms" DROP COLUMN "land_area_decimals";

ALTER TABLE "farms"
  ADD CONSTRAINT "farms_address_fk"
  FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE SET NULL;

CREATE INDEX "farms_address_id_idx" ON "farms" ("address_id");

-- ------------------------------------------------------------------------ plots

CREATE TABLE "plots" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "farm_id"           UUID NOT NULL,
  "name"              TEXT NOT NULL,
  "area_amount_milli" INTEGER,
  "area_unit"         "LandUnit",
  "soil_type"         "SoilType",
  "irrigation_method" "IrrigationMethod",
  "latitude"          DECIMAL(9, 6),
  "longitude"         DECIMAL(9, 6),
  "geo"               geography(Point, 4326),
  "boundary"          geography(Polygon, 4326),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  "deleted_at"        TIMESTAMP(3),

  -- CASCADE, unlike the farm→farmer relation. A plot has no meaning apart from its farm, so
  -- deleting the farm must not leave orphans behind for an ownership query to trip over.
  CONSTRAINT "plots_farm_fk" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE
);

CREATE INDEX "plots_farm_id_idx" ON "plots" ("farm_id");

-- The index the mapping surface will need. Created now, while the table is empty, rather than on
-- a table holding every plot in the pilot.
CREATE INDEX "plots_boundary_gix" ON "plots" USING GIST ("boundary");
CREATE INDEX "plots_geo_gix" ON "plots" USING GIST ("geo");

-- -------------------------------------------------------------------- consistency

ALTER TABLE "plots"
  ADD CONSTRAINT "plots_name_present" CHECK (btrim("name") <> '');

-- The same pair rule as the farmer profile: an area without a unit is a number nobody can read.
ALTER TABLE "farms"
  ADD CONSTRAINT "farms_area_needs_unit"
  CHECK (("area_amount_milli" IS NULL) = ("area_unit" IS NULL));

ALTER TABLE "plots"
  ADD CONSTRAINT "plots_area_needs_unit"
  CHECK (("area_amount_milli" IS NULL) = ("area_unit" IS NULL));

ALTER TABLE "farms"
  ADD CONSTRAINT "farms_area_positive"
  CHECK ("area_amount_milli" IS NULL
         OR ("area_amount_milli" > 0 AND "area_amount_milli" <= 100000000));

ALTER TABLE "plots"
  ADD CONSTRAINT "plots_area_positive"
  CHECK ("area_amount_milli" IS NULL
         OR ("area_amount_milli" > 0 AND "area_amount_milli" <= 100000000));

-- "No irrigation, drip method" is contradictory rather than incomplete, exactly as on the farmer
-- profile. A rain-fed farm may still record RAIN as its water source.
ALTER TABLE "farms"
  ADD CONSTRAINT "farms_irrigation_consistent"
  CHECK ("irrigation_available" IS DISTINCT FROM FALSE
         OR ("irrigation_method" IS NULL
             AND ("water_source" IS NULL OR "water_source" = 'RAIN')));

-- Coordinates come as a pair or not at all, and must be inside Bangladesh's bounding box —
-- the same rule addresses and farms already carry.
ALTER TABLE "plots"
  ADD CONSTRAINT "plots_coordinates_valid"
  CHECK (("latitude" IS NULL) = ("longitude" IS NULL));

ALTER TABLE "plots"
  ADD CONSTRAINT "plots_coordinates_in_country"
  CHECK ("latitude" IS NULL
         OR ("latitude" BETWEEN 20.3 AND 26.7 AND "longitude" BETWEEN 88.0 AND 92.7));

-- ------------------------------------------------------- geography from the pin

-- Mirrors the addresses and farms triggers. The geography column is derived, never written by
-- application code, so it cannot disagree with the latitude and longitude beside it.
CREATE OR REPLACE FUNCTION plots_sync_geo_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF new.latitude IS NULL OR new.longitude IS NULL THEN
    new.geo := NULL;
  ELSE
    -- ST_MakePoint takes longitude FIRST. The one place in the schema that ordering matters.
    new.geo := ST_SetSRID(ST_MakePoint(new.longitude::double precision,
                                       new.latitude::double precision), 4326)::geography;
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plots_sync_geo
  BEFORE INSERT OR UPDATE OF latitude, longitude ON "plots"
  FOR EACH ROW EXECUTE FUNCTION plots_sync_geo_fn();

-- --------------------------------------------------- the ownership guarantee

-- A farm may only point at an address belonging to the SAME user.
--
-- The foreign key alone is not enough: it proves the address exists, not that it is the farmer's.
-- Without this, a farmer could attach any address id they could guess to their own farm and read
-- a stranger's recipient name and phone number back out of their own farm detail screen — an IDOR
-- that no amount of care in the use case would prevent, because the check would live in code that
-- a later endpoint could forget.
--
-- A trigger rather than a rule: rules rewrite the statement and break referential-integrity
-- queries on the child table, which is the mistake the P4 consent guard made and had to undo.
CREATE OR REPLACE FUNCTION farms_address_same_owner_fn()
RETURNS TRIGGER AS $$
DECLARE
  address_owner UUID;
  farm_owner    UUID;
BEGIN
  IF new.address_id IS NULL THEN
    RETURN new;
  END IF;

  SELECT a.user_id INTO address_owner FROM addresses a WHERE a.id = new.address_id;
  SELECT fp.user_id INTO farm_owner
    FROM farmer_profiles fp WHERE fp.id = new.farmer_profile_id;

  IF address_owner IS DISTINCT FROM farm_owner THEN
    RAISE EXCEPTION 'farm address must belong to the same user as the farm'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER farms_address_same_owner
  BEFORE INSERT OR UPDATE OF address_id, farmer_profile_id ON "farms"
  FOR EACH ROW EXECUTE FUNCTION farms_address_same_owner_fn();
