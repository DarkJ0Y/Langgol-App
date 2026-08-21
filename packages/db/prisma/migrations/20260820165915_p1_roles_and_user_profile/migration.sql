-- NOTE: `prisma migrate dev` emitted DROP INDEX for all four hand-authored GIST indexes again
-- (addresses_geo_gix, admin_areas_geo_gix, farms_geo_gix, listings_geo_gix). Removed by hand, as
-- docs/DEVELOPMENT.md warns. Prisma cannot represent a GIST index on an
-- `Unsupported("geography(...)")` column, so it reads them as drift on EVERY migration. Dropping
-- them fails no test — it silently turns every radius search into a full table scan.

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('REGISTERED', 'ROLE_SELECTED', 'PROFILE_COMPLETE', 'READY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'WHOLESALER';
ALTER TYPE "Role" ADD VALUE 'SUPPLIER';
ALTER TYPE "Role" ADD VALUE 'AGRICULTURAL_EXPERT';
ALTER TYPE "Role" ADD VALUE 'LOGISTICS_PROVIDER';

-- AlterTable
ALTER TABLE "user_role_assignments" ADD COLUMN     "revoke_reason" TEXT,
ADD COLUMN     "revoked_by_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "date_of_birth" DATE,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "onboarding_status" "OnboardingStatus" NOT NULL DEFAULT 'REGISTERED',
ADD COLUMN     "profile_photo_key" TEXT;

-- CreateTable
CREATE TABLE "role_definitions" (
    "role" "Role" NOT NULL,
    "name_bn" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "description_bn" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "self_selectable" BOOLEAN NOT NULL DEFAULT false,
    "privileged" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_definitions_pkey" PRIMARY KEY ("role")
);

-- CreateIndex
CREATE INDEX "role_definitions_is_active_sort_order_idx" ON "role_definitions"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "users_onboarding_status_idx" ON "users"("onboarding_status");


-- ===========================================================================
-- Phase 1 guarantees
-- ===========================================================================
--
-- Validation the application also performs, repeated here because the application is not the only
-- thing that writes to this database. A seed, a migration, an ops psql session and a future
-- service all bypass the use case; none of them bypass a CHECK.

-- A name is the one profile field that is never optional: it is what a farmer is called on a
-- delivery note. An empty string is not a name, and is the value a naive form post produces.
ALTER TABLE "users" ADD CONSTRAINT "users_full_name_present"
  CHECK (length(btrim(full_name)) > 0);

-- Optional fields are NULL when absent, never an empty string. Two representations of "not set"
-- is how `WHERE email IS NULL` starts missing rows.
ALTER TABLE "users" ADD CONSTRAINT "users_optional_text_not_blank" CHECK (
  (email IS NULL OR length(btrim(email)) > 0)
  AND (profile_photo_key IS NULL OR length(btrim(profile_photo_key)) > 0)
);

-- Email is stored lower-cased so the UNIQUE index actually prevents duplicates. Without this,
-- Rahim@example.com and rahim@example.com are two accounts.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase"
  CHECK (email IS NULL OR email = lower(email));

/*
 * Date of birth must be a plausible one. The lower bound is 1900 rather than a computed age so
 * the constraint stays IMMUTABLE — a CHECK referencing now() is not allowed, and would in any
 * case make a row's validity depend on when it is read. The minimum-age rule (13) lives in the
 * domain, where it can produce a message a user can act on.
 */
ALTER TABLE "users" ADD CONSTRAINT "users_date_of_birth_plausible" CHECK (
  date_of_birth IS NULL
  OR (date_of_birth >= DATE '1900-01-01' AND date_of_birth <= DATE '2100-01-01')
);

-- A revoked role must say who revoked it and why. An unattributed revocation can lock a farmer
-- out of their own listings with no record of the decision — the same principle as fault
-- attribution on a failed order (docs/05 §5.1).
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "role_revocation_attributed" CHECK (
  revoked_at IS NULL
  OR (revoked_by_id IS NOT NULL AND revoke_reason IS NOT NULL AND length(btrim(revoke_reason)) > 0)
);

-- Role metadata must actually be a label. A blank name renders as an empty menu item.
ALTER TABLE "role_definitions" ADD CONSTRAINT "role_definition_labelled" CHECK (
  length(btrim(name_bn)) > 0 AND length(btrim(name_en)) > 0
);

-- A user holds a role at most once. The unique index already existed on (user_id, role); this
-- partial index makes the ACTIVE holding unique too, so a revoked row and a live row can coexist
-- as history without permitting two live ones.
CREATE UNIQUE INDEX "user_role_active_unique"
  ON "user_role_assignments" (user_id, role)
  WHERE revoked_at IS NULL;
