-- P8 — Farmer production history.
--
-- The history that yield prediction, forecasting, credit scoring and price prediction will all
-- read from. That places one obligation above every other on this table: nothing in it may be
-- invented. Every column is either something the farmer stated or something derived from what
-- they stated — never a default standing in for an answer they did not give, which is why almost
-- everything is nullable and nothing defaults to zero.
--
-- Refs: docs/06_FINANCIAL_ARCHITECTURE.md §4; docs/02_DATABASE.md §6

CREATE TYPE "Season" AS ENUM ('BORO', 'AUS', 'AMAN', 'RABI', 'KHARIF', 'YEAR_ROUND');

CREATE TABLE "productions" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "farmer_profile_id"        UUID NOT NULL,
  "farm_id"                  UUID NOT NULL,
  "plot_id"                  UUID,
  "product_id"               UUID,
  "variety_id"               UUID,
  "season"                   "Season",
  "year"                     INTEGER,
  "cultivated_area_milli"    INTEGER,
  "cultivated_area_unit"     "LandUnit",
  "production_quantity_base" BIGINT,
  "production_unit"          "SaleUnit",
  "production_cost_poisha"   BIGINT,
  "selling_quantity_base"    BIGINT,
  "selling_price_poisha"     BIGINT,
  "revenue_poisha"           BIGINT,
  "buyer_user_id"            UUID,
  "harvest_date"             DATE,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,
  "deleted_at"               TIMESTAMP(3),

  CONSTRAINT "productions_farmer_fk" FOREIGN KEY ("farmer_profile_id")
    REFERENCES "farmer_profiles"("id") ON DELETE CASCADE,
  CONSTRAINT "productions_farm_fk" FOREIGN KEY ("farm_id")
    REFERENCES "farms"("id") ON DELETE CASCADE,
  -- SET NULL rather than CASCADE: deleting a plot must not erase the history of what it grew.
  CONSTRAINT "productions_plot_fk" FOREIGN KEY ("plot_id")
    REFERENCES "plots"("id") ON DELETE SET NULL,
  CONSTRAINT "productions_product_fk" FOREIGN KEY ("product_id")
    REFERENCES "products"("id"),
  CONSTRAINT "productions_variety_fk" FOREIGN KEY ("variety_id")
    REFERENCES "product_varieties"("id"),
  CONSTRAINT "productions_buyer_fk" FOREIGN KEY ("buyer_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL
);

-- The indexes the required filters need: by year, by crop, by season.
CREATE INDEX "productions_farmer_year_idx" ON "productions" ("farmer_profile_id", "year");
CREATE INDEX "productions_farmer_product_idx" ON "productions" ("farmer_profile_id", "product_id");
CREATE INDEX "productions_farmer_season_idx"
  ON "productions" ("farmer_profile_id", "season", "year");
CREATE INDEX "productions_farm_id_idx" ON "productions" ("farm_id");
CREATE INDEX "productions_plot_id_idx" ON "productions" ("plot_id");

-- -------------------------------------------------------------------- consistency

-- A typo guard, not a claim about farming history. A record dated 1900 would distort every
-- average computed over this column, and a four-digit year is easy to fat-finger.
ALTER TABLE "productions"
  ADD CONSTRAINT "productions_year_plausible"
  CHECK ("year" IS NULL OR ("year" >= 2000 AND "year" <= 2100));

-- Quantities and money are never negative. Cost and price may be zero — produce is given away,
-- and seed saved from last season costs nothing — so the floor is zero rather than one.
ALTER TABLE "productions"
  ADD CONSTRAINT "productions_amounts_nonneg"
  CHECK (
    ("production_quantity_base" IS NULL OR "production_quantity_base" >= 0)
    AND ("selling_quantity_base" IS NULL OR "selling_quantity_base" >= 0)
    AND ("production_cost_poisha" IS NULL OR "production_cost_poisha" >= 0)
    AND ("selling_price_poisha" IS NULL OR "selling_price_poisha" >= 0)
  );

-- The same pair rule as every other area in the schema.
ALTER TABLE "productions"
  ADD CONSTRAINT "productions_area_needs_unit"
  CHECK (("cultivated_area_milli" IS NULL) = ("cultivated_area_unit" IS NULL));

ALTER TABLE "productions"
  ADD CONSTRAINT "productions_area_positive"
  CHECK ("cultivated_area_milli" IS NULL
         OR ("cultivated_area_milli" > 0 AND "cultivated_area_milli" <= 100000000));

-- A quantity without a unit is a number nobody can read.
ALTER TABLE "productions"
  ADD CONSTRAINT "productions_quantity_needs_unit"
  CHECK ("production_quantity_base" IS NULL OR "production_unit" IS NOT NULL);

-- You cannot sell more than you grew. Both sides are in base units of the same sale unit, so the
-- comparison is meaningful; either being absent makes the rule vacuous rather than false.
ALTER TABLE "productions"
  ADD CONSTRAINT "productions_sold_not_more_than_grown"
  CHECK ("selling_quantity_base" IS NULL
         OR "production_quantity_base" IS NULL
         OR "selling_quantity_base" <= "production_quantity_base");

-- --------------------------------------------------- revenue is derived, not entered
--
-- The rule this migration exists for.
--
-- `revenue = quantity sold × price per sale unit`. A farmer may state what they sold and what
-- they were paid; the product of the two is not theirs to state. A stored revenue that disagrees
-- with its own inputs is unfalsifiable a season later, and a credit score built on it would be
-- scoring a typo rather than a harvest.
--
-- A trigger rather than a GENERATED column, because the conversion needs the unit table and a
-- generated expression would have to hard-code every factor — a second home for numbers that
-- already live in packages/domain/src/quantity/units.ts. The factors below are the mass and
-- count conversions from that table; the parity test in the integration suite is what keeps
-- them honest.
--
-- The application computes the same value and stores it. This trigger is not that computation
-- repeated for its own sake — it is what makes the value impossible to forge from psql, from a
-- support script, or from an endpoint somebody adds later without reading this comment.
CREATE OR REPLACE FUNCTION productions_derive_revenue_fn()
RETURNS TRIGGER AS $$
DECLARE
  per_unit BIGINT;
BEGIN
  IF new.selling_quantity_base IS NULL
     OR new.selling_price_poisha IS NULL
     OR new.production_unit IS NULL THEN
    -- No sale recorded. NULL, never 0: "sold nothing" and "sold for nothing" are different facts.
    new.revenue_poisha := NULL;
    RETURN new;
  END IF;

  per_unit := CASE new.production_unit
    WHEN 'MILLIGRAM'  THEN 1
    WHEN 'GRAM'       THEN 1000
    WHEN 'KG'         THEN 1000000
    WHEN 'SEER'       THEN 933100
    WHEN 'MON'        THEN 37324000
    WHEN 'TONNE'      THEN 1000000000
    WHEN 'MILLILITRE' THEN 1
    WHEN 'LITRE'      THEN 1000
    WHEN 'PIECE'      THEN 1
    WHEN 'HALI'       THEN 4
    WHEN 'DOZEN'      THEN 12
  END;

  IF per_unit IS NULL OR per_unit <= 0 THEN
    new.revenue_poisha := NULL;
    RETURN new;
  END IF;

  -- Integer division: poisha is the smallest unit of money there is, so this truncates rather
  -- than rounding into money that does not exist.
  new.revenue_poisha := (new.selling_quantity_base * new.selling_price_poisha) / per_unit;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER productions_derive_revenue
  BEFORE INSERT OR UPDATE ON "productions"
  FOR EACH ROW EXECUTE FUNCTION productions_derive_revenue_fn();
