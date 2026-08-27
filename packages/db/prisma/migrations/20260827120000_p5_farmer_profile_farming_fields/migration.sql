-- P5 — Farmer profile: how somebody farms.
--
-- Extends the EXISTING `farmer_profiles` table rather than adding a parallel one. The table
-- already carries identity, verification, payout and reputation; the agronomic answers belong
-- beside them, and a second farmer table would immediately raise the question of which one is
-- the farmer.
--
-- Every column added here is NULLABLE. A farmer signing up on a borrowed phone at the edge of
-- coverage must reach a working account, and "has not answered the irrigation question yet" is
-- not the same as "invalid". The CHECK constraints below therefore police CONSISTENCY, never
-- completeness: a profile may be half-filled, but it may not contradict itself.
--
-- Refs: docs/02_DATABASE.md §5, docs/08_BANGLADESH_CONTEXT.md §2

-- ------------------------------------------------------------------ vocabularies

CREATE TYPE "FarmerType" AS ENUM (
  'CROP', 'VEGETABLE', 'FRUIT', 'FISH', 'LIVESTOCK', 'POULTRY', 'DAIRY', 'MIXED'
);

CREATE TYPE "LandUnit" AS ENUM ('DECIMAL', 'KATHA', 'BIGHA', 'ACRE', 'HECTARE');

CREATE TYPE "LandOwnershipType" AS ENUM (
  'OWNED', 'LEASED', 'SHARECROPPED', 'MIXED', 'COMMUNITY'
);

CREATE TYPE "IrrigationMethod" AS ENUM ('MANUAL', 'FLOOD', 'FURROW', 'SPRINKLER', 'DRIP');

CREATE TYPE "WaterSource" AS ENUM (
  'RAIN', 'RIVER', 'CANAL', 'POND', 'SHALLOW_TUBEWELL', 'DEEP_TUBEWELL', 'SUPPLY'
);

CREATE TYPE "FarmingMethod" AS ENUM ('CONVENTIONAL', 'ORGANIC', 'INTEGRATED', 'MIXED');

-- ------------------------------------------------------------------------ columns

ALTER TABLE "farmer_profiles"
  ADD COLUMN "farming_experience_years" INTEGER,
  ADD COLUMN "farmer_type"              "FarmerType",
  ADD COLUMN "total_land_amount_milli"  INTEGER,
  ADD COLUMN "land_unit"                "LandUnit",
  ADD COLUMN "ownership_type"           "LandOwnershipType",
  ADD COLUMN "irrigation_available"     BOOLEAN,
  ADD COLUMN "irrigation_method"        "IrrigationMethod",
  ADD COLUMN "water_source"             "WaterSource",
  ADD COLUMN "farming_method"           "FarmingMethod";

-- -------------------------------------------------------------------- consistency

-- Nought years is legitimate: a farmer in their first season is a farmer. The upper bound is a
-- typo guard — 80 years means somebody who started as a child and is now past ninety, which is
-- possible; a birth year typed into the box is not.
ALTER TABLE "farmer_profiles"
  ADD CONSTRAINT "farmer_experience_plausible"
  CHECK ("farming_experience_years" IS NULL
         OR ("farming_experience_years" >= 0 AND "farming_experience_years" <= 80));

-- An area without a unit is a number nobody can read; a unit without an area is noise. The pair
-- travels together or not at all.
ALTER TABLE "farmer_profiles"
  ADD CONSTRAINT "farmer_land_amount_needs_unit"
  CHECK (("total_land_amount_milli" IS NULL) = ("land_unit" IS NULL));

-- Positive, and coarsely bounded.
--
-- Deliberately COARSER than the domain's bound, because the real limit depends on the unit and
-- this column does not know it. Converting here would mean copying the bigha/katha/hectare
-- factors into SQL, giving them a second home that would drift from
-- packages/domain/src/farming/land.ts — the exact failure the enum-parity test exists to catch.
--
-- So the split is: SQL rejects the impossible, the domain rejects the implausible. The number
-- below is 100,000 units, which is past absurd even read as decimals (1000 acres) and cannot
-- reject a legitimate answer in any unit.
ALTER TABLE "farmer_profiles"
  ADD CONSTRAINT "farmer_land_amount_positive"
  CHECK ("total_land_amount_milli" IS NULL
         OR ("total_land_amount_milli" > 0 AND "total_land_amount_milli" <= 100000000));

-- The constraint this migration exists for.
--
-- "No irrigation" plus an irrigation METHOD is not missing data, it is contradictory data, and
-- application-level validation alone would not stop a migration, a support script or a future
-- endpoint from writing it. A rain-fed farmer may still record RAIN as their water source —
-- that is an accurate answer, not a contradiction — but a tubewell with no irrigation is not.
ALTER TABLE "farmer_profiles"
  ADD CONSTRAINT "farmer_irrigation_consistent"
  CHECK ("irrigation_available" IS DISTINCT FROM FALSE
         OR ("irrigation_method" IS NULL
             AND ("water_source" IS NULL OR "water_source" = 'RAIN')));

-- ------------------------------------------------------------------------ indexes

-- Supports "farmers near here who grow X", the first query the advisory and sourcing features
-- will need. Partial, because a profile that has not answered is not a candidate for either.
CREATE INDEX "farmer_profiles_farmer_type_idx"
  ON "farmer_profiles" ("farmer_type")
  WHERE "farmer_type" IS NOT NULL;
