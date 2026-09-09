-- P9 — Role-specific profiles for the remaining user types.
--
-- Two profiles already existed and are extended; four are new. `preferred_language` is
-- deliberately NOT added to the consumer profile: it lives on `users`, where every role has it,
-- and a copy here would be a second answer to the same question.
--
-- Every added column is nullable, the same decision as P5 and P6. A shopkeeper filling this in
-- at closing time saves what they know and leaves the rest; what the database enforces is
-- consistency and ownership, never completeness.
--
-- Refs: docs/02_DATABASE.md §5; docs/07_SECURITY.md §4, §7

-- ------------------------------------------------------------------- consumer

ALTER TABLE "consumer_profiles"
  ADD COLUMN "dietary_preferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "preferred_products"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "purchase_frequency"  TEXT,
  ADD COLUMN "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ------------------------------------------------------------------- retailer

ALTER TABLE "retailer_profiles"
  ADD COLUMN "tin"               TEXT,
  ADD COLUMN "years_in_business" INTEGER,
  ADD COLUMN "address_id"        UUID,
  ADD COLUMN "latitude"          DECIMAL(9, 6),
  ADD COLUMN "longitude"         DECIMAL(9, 6),
  ADD COLUMN "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "retailer_profiles"
  ADD CONSTRAINT "retailer_profiles_address_fk"
  FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE SET NULL;

CREATE INDEX "retailer_profiles_address_id_idx" ON "retailer_profiles" ("address_id");

-- ----------------------------------------------------------------- wholesaler

CREATE TABLE "wholesaler_profiles" (
  "id"                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                   UUID NOT NULL UNIQUE,
  "business_name"             TEXT NOT NULL,
  "trade_licence"             TEXT,
  "tin"                       TEXT,
  "bin"                       TEXT,
  "warehouse_capacity_tonnes" INTEGER,
  "distribution_reach"        TEXT,
  "owns_transport"            BOOLEAN,
  "address_id"                UUID,
  "verification_status"       "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                TIMESTAMP(3) NOT NULL,

  CONSTRAINT "wholesaler_profiles_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "wholesaler_profiles_address_fk" FOREIGN KEY ("address_id")
    REFERENCES "addresses"("id") ON DELETE SET NULL
);

-- ------------------------------------------------------------------- supplier

CREATE TABLE "supplier_profiles" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"               UUID NOT NULL UNIQUE,
  "company_name"          TEXT NOT NULL,
  "business_registration" TEXT,
  "trade_licence"         TEXT,
  "tin"                   TEXT,
  "bin"                   TEXT,
  "has_warehouse"         BOOLEAN,
  "product_categories"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "address_id"            UUID,
  "verification_status"   "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "supplier_profiles_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "supplier_profiles_address_fk" FOREIGN KEY ("address_id")
    REFERENCES "addresses"("id") ON DELETE SET NULL
);

-- --------------------------------------------------------------------- expert

CREATE TABLE "agricultural_expert_profiles" (
  "id"                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                 UUID NOT NULL UNIQUE,
  "specialisations"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "qualification"           TEXT,
  "institution"             TEXT,
  "years_of_experience"     INTEGER,
  "certifications"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "consultation_fee_poisha" BIGINT,
  "offers_online"           BOOLEAN,
  "offers_offline"          BOOLEAN,
  "bio"                     TEXT,
  "verification_status"     "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"              TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agricultural_expert_profiles_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE
);

-- An unverified "expert" advising on pesticide dosage is the failure this role exists to guard,
-- so finding the verified ones has to be an indexed lookup rather than a scan.
CREATE INDEX "agricultural_expert_profiles_verification_status_idx"
  ON "agricultural_expert_profiles" ("verification_status");

-- ------------------------------------------------------------------ logistics

CREATE TABLE "logistics_provider_profiles" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"              UUID NOT NULL UNIQUE,
  "company_name"         TEXT NOT NULL,
  "vehicle_types"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "cold_chain_available" BOOLEAN,
  "warehouse_available"  BOOLEAN,
  "verification_status"  "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "logistics_provider_profiles_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE
);

-- --------------------------------------------------------------- service area

CREATE TABLE "profile_service_areas" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_area_id"         UUID NOT NULL,
  "wholesaler_profile_id" UUID,
  "supplier_profile_id"   UUID,
  "expert_profile_id"     UUID,
  "logistics_profile_id"  UUID,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "profile_service_areas_area_fk" FOREIGN KEY ("admin_area_id")
    REFERENCES "admin_areas"("id"),
  CONSTRAINT "profile_service_areas_wholesaler_fk" FOREIGN KEY ("wholesaler_profile_id")
    REFERENCES "wholesaler_profiles"("id") ON DELETE CASCADE,
  CONSTRAINT "profile_service_areas_supplier_fk" FOREIGN KEY ("supplier_profile_id")
    REFERENCES "supplier_profiles"("id") ON DELETE CASCADE,
  CONSTRAINT "profile_service_areas_expert_fk" FOREIGN KEY ("expert_profile_id")
    REFERENCES "agricultural_expert_profiles"("id") ON DELETE CASCADE,
  CONSTRAINT "profile_service_areas_logistics_fk" FOREIGN KEY ("logistics_profile_id")
    REFERENCES "logistics_provider_profiles"("id") ON DELETE CASCADE
);

CREATE INDEX "profile_service_areas_area_idx" ON "profile_service_areas" ("admin_area_id");
CREATE INDEX "profile_service_areas_wholesaler_idx"
  ON "profile_service_areas" ("wholesaler_profile_id");
CREATE INDEX "profile_service_areas_supplier_idx"
  ON "profile_service_areas" ("supplier_profile_id");
CREATE INDEX "profile_service_areas_expert_idx" ON "profile_service_areas" ("expert_profile_id");
CREATE INDEX "profile_service_areas_logistics_idx"
  ON "profile_service_areas" ("logistics_profile_id");

-- One table serves four roles, so exactly one of the four owners must be set.
--
-- Without this, a row with every column null belongs to nobody and is invisible to every query
-- that reads it, while a row with two owners appears in two businesses' service areas at once.
-- Neither is recoverable afterwards, because there is no way to tell which owner was intended.
ALTER TABLE "profile_service_areas"
  ADD CONSTRAINT "profile_service_area_exactly_one_owner"
  CHECK (
    (("wholesaler_profile_id" IS NOT NULL)::int
     + ("supplier_profile_id" IS NOT NULL)::int
     + ("expert_profile_id" IS NOT NULL)::int
     + ("logistics_profile_id" IS NOT NULL)::int) = 1
  );

-- ------------------------------------------------------------------ integrity

-- A profile may only point at an address belonging to the SAME user.
--
-- The foreign key proves the address exists, not that it is theirs. Without this a retailer could
-- attach any address id they could guess and read a stranger's recipient name and phone number
-- back out of their own profile screen — the same IDOR the farms table closed in P6, and closed
-- the same way, with a trigger rather than a rule.
CREATE OR REPLACE FUNCTION profile_address_same_owner_fn()
RETURNS TRIGGER AS $$
DECLARE
  address_owner UUID;
BEGIN
  IF new.address_id IS NULL THEN
    RETURN new;
  END IF;

  SELECT a.user_id INTO address_owner FROM addresses a WHERE a.id = new.address_id;

  IF address_owner IS DISTINCT FROM new.user_id THEN
    RAISE EXCEPTION 'profile address must belong to the same user as the profile'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER retailer_profile_address_same_owner
  BEFORE INSERT OR UPDATE OF address_id, user_id ON "retailer_profiles"
  FOR EACH ROW EXECUTE FUNCTION profile_address_same_owner_fn();

CREATE TRIGGER wholesaler_profile_address_same_owner
  BEFORE INSERT OR UPDATE OF address_id, user_id ON "wholesaler_profiles"
  FOR EACH ROW EXECUTE FUNCTION profile_address_same_owner_fn();

CREATE TRIGGER supplier_profile_address_same_owner
  BEFORE INSERT OR UPDATE OF address_id, user_id ON "supplier_profiles"
  FOR EACH ROW EXECUTE FUNCTION profile_address_same_owner_fn();

-- Plausibility guards, in the same spirit as the farmer profile's. Nought is always allowed: a
-- business opened this year has been trading for nought years, and that is an answer.
ALTER TABLE "retailer_profiles"
  ADD CONSTRAINT "retailer_years_plausible"
  CHECK ("years_in_business" IS NULL
         OR ("years_in_business" >= 0 AND "years_in_business" <= 100));

ALTER TABLE "agricultural_expert_profiles"
  ADD CONSTRAINT "expert_years_plausible"
  CHECK ("years_of_experience" IS NULL
         OR ("years_of_experience" >= 0 AND "years_of_experience" <= 70));

ALTER TABLE "wholesaler_profiles"
  ADD CONSTRAINT "wholesaler_capacity_plausible"
  CHECK ("warehouse_capacity_tonnes" IS NULL
         OR ("warehouse_capacity_tonnes" >= 0 AND "warehouse_capacity_tonnes" <= 100000));

-- A fee may be zero — an expert who consults without charge is a real and welcome case — but
-- never negative, which would be the platform paying a farmer to receive advice.
ALTER TABLE "agricultural_expert_profiles"
  ADD CONSTRAINT "expert_fee_nonneg"
  CHECK ("consultation_fee_poisha" IS NULL OR "consultation_fee_poisha" >= 0);
