-- P12 — Progressive onboarding.
--
-- Widens `OnboardingStatus` from four milestones to eight, and renames two of the four so the
-- names mean what they say.
--
-- ## What the states are, and what they are not
--
-- They describe progress. They do not grant or withhold anything: a user at PHONE_VERIFIED can
-- browse, order, list and be paid exactly as one at FULLY_ONBOARDED can. Nothing in the platform
-- branches on this column to decide whether an action is permitted — that is the policy engine's
-- job, and it reads roles and ownership.
--
-- ## Why the type is replaced rather than extended
--
-- `ALTER TYPE ... ADD VALUE` would add the four new labels in place, which is less work. It cannot
-- rename the two that were wrong: `PROFILE_COMPLETE` claimed a finished profile when it only meant
-- a confirmed name, and `READY` said nothing about what somebody was ready for. Leaving those
-- would leave the enum permanently misleading to anybody reading it in SQL.
--
-- The replacement is done in one transaction, which every Prisma migration already is, so there is
-- no window in which the column has no type.
--
-- Refs: docs/01_MVP_REQUIREMENTS.md §79; docs/02_DATABASE.md §5

CREATE TYPE "OnboardingStatus_new" AS ENUM (
  'REGISTERED',
  'PHONE_VERIFIED',
  'ROLE_SELECTED',
  'PROFILE_STARTED',
  'PROFILE_COMPLETED',
  'KYC_PENDING',
  'KYC_VERIFIED',
  'FULLY_ONBOARDED'
);

-- The default has to go before the column can be retyped: Postgres will not cast a default that
-- belongs to the type being replaced.
ALTER TABLE "users" ALTER COLUMN "onboarding_status" DROP DEFAULT;

-- Old label to new, and the two renames.
--
-- `PROFILE_COMPLETE` becomes PROFILE_COMPLETED rather than PROFILE_STARTED, deliberately. The old
-- value was over-claiming, but demoting a live row would move users backwards through their own
-- onboarding and re-trigger flows they had finished — which the domain forbids everywhere else.
-- Keeping the more generous reading is the one that does no harm to anybody's account.
ALTER TABLE "users"
  ALTER COLUMN "onboarding_status" TYPE "OnboardingStatus_new"
  USING (
    CASE "onboarding_status"::text
      WHEN 'PROFILE_COMPLETE' THEN 'PROFILE_COMPLETED'
      WHEN 'READY'            THEN 'FULLY_ONBOARDED'
      ELSE "onboarding_status"::text
    END
  )::"OnboardingStatus_new";

DROP TYPE "OnboardingStatus";
ALTER TYPE "OnboardingStatus_new" RENAME TO "OnboardingStatus";

ALTER TABLE "users"
  ALTER COLUMN "onboarding_status" SET DEFAULT 'REGISTERED';

-- The index on this column already exists and follows the column through the retype, so it is not
-- rebuilt here. Named for the record: `users_onboarding_status_idx`, added in the P1 migration.
