-- Phase 3: country and postcode on an address, plus groundwork for farm boundaries.
--
-- Hand-authored rather than generated. `prisma migrate dev` cannot express the CHECK constraints
-- or the geography column below, and it emits DROP INDEX for the four hand-maintained GIST
-- indexes every time it runs. See docs/DEVELOPMENT.md "Migrations that Prisma cannot generate".
--
-- Nothing here duplicates the existing location model. Division, district, upazila and union
-- already live in the `admin_areas` tree and an address already points into it; village, address
-- line, landmark, latitude and longitude are already columns. Only the two genuinely missing
-- fields are added.

-- ---------------------------------------------------------------- country

-- ISO 3166-1 alpha-2, defaulting to Bangladesh. Existing rows are Bangladeshi by construction:
-- every one of them points into an admin_areas tree that contains only Bangladesh.
ALTER TABLE "addresses" ADD COLUMN "country_code" TEXT NOT NULL DEFAULT 'BD';

ALTER TABLE "addresses" ADD CONSTRAINT "addresses_country_code_iso"
  CHECK (country_code ~ '^[A-Z]{2}$');

-- ---------------------------------------------------------------- postcode

-- Nullable, and it will stay nullable. Many rural locations have no reliable postcode, and
-- "village, union, upazila, near the school" is a complete address in practice — requiring one
-- would reject the majority of this platform's users. docs/08_BANGLADESH_CONTEXT.md §2
ALTER TABLE "addresses" ADD COLUMN "postal_code" TEXT;

ALTER TABLE "addresses" ADD CONSTRAINT "addresses_postal_code_bd"
  CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{4}$');

-- Delivery corridors are planned per postcode where postcodes exist. Without this the query is a
-- sequential scan of every address on the platform.
CREATE INDEX "addresses_postal_code_idx" ON "addresses" ("postal_code");

-- ------------------------------------------------- coordinates belong to the country

-- `addresses_coordinates_valid` already rejects anything that is not a point on Earth. This is
-- the stronger, and far more useful, statement: a Bangladeshi address whose pin is not in
-- Bangladesh is wrong, and by a wide margin the reason is that latitude and longitude were
-- exchanged somewhere. Bangladesh's latitude range (20.3–26.7) and longitude range (88.0–92.7)
-- do not overlap, so a swapped pair always lands outside the box and is caught here rather than
-- becoming a delivery quote for a route across the Bay of Bengal.
--
-- Scoped to country_code = 'BD' so that serving a second country later is a data change, not a
-- constraint change.
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_coordinates_in_country" CHECK (
  country_code <> 'BD'
  OR latitude IS NULL
  OR longitude IS NULL
  OR (latitude BETWEEN 20.3 AND 26.7 AND longitude BETWEEN 88.0 AND 92.7)
);

-- ------------------------------------------------------------- farm boundaries

-- Groundwork. Nothing writes this column yet.
--
-- It is added now, while `farms` is small, because adding a geography column and a GIST index to
-- a hot table later is a lock and a rebuild. Ring validation and the latitude/longitude ordering
-- live in packages/domain/src/location/boundary.ts; PostGIS owns the geometry predicates, which
-- is why validity is asserted here rather than hand-rolled in TypeScript.
ALTER TABLE "farms" ADD COLUMN "boundary" geography(Polygon, 4326);

ALTER TABLE "farms" ADD CONSTRAINT "farms_boundary_valid"
  CHECK (boundary IS NULL OR ST_IsValid(boundary::geometry));

CREATE INDEX "farms_boundary_gix" ON "farms" USING GIST ("boundary");
