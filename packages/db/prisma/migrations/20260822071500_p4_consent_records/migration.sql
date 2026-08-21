-- Phase 4: consent records.
--
-- Hand-authored. `prisma migrate dev` cannot express the CHECK constraints or the append-only
-- rule below, and it emits DROP INDEX for the hand-maintained GIST indexes every time it runs.
-- See docs/DEVELOPMENT.md "Migrations that Prisma cannot generate".

CREATE TYPE "ConsentType" AS ENUM (
  'TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'LOCATION', 'FARM_DATA', 'FINANCIAL_DATA',
  'MARKETING', 'PERSONALIZATION', 'AI_DATA_PROCESSING', 'TRANSACTION_DATA'
);

-- No ADMIN member, deliberately. Nobody decides for somebody else, and an enum that cannot
-- express it beats a check that can be forgotten.
CREATE TYPE "ConsentSource" AS ENUM ('SIGNUP', 'ACCOUNT_SETTINGS', 'REPROMPT');

CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "consent_type" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "source" "ConsentSource" NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consent_records_user_id_consent_type_granted_at_idx"
  ON "consent_records" ("user_id", "consent_type", "granted_at");

-- Answers "how many users allow marketing?" without scanning every row on the platform.
CREATE INDEX "consent_records_consent_type_granted_idx"
  ON "consent_records" ("consent_type", "granted");

ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- invariants

-- A version is a document revision, counted from one. Zero or negative is a caller that lost
-- track of which text it was showing, and recording an agreement to it would be meaningless.
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_version_positive" CHECK (version > 0);

-- A decision cannot be superseded before it was made.
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_revoked_after_granted" CHECK (
  revoked_at IS NULL OR revoked_at >= granted_at
);

-- At most one live decision per user and consent type. Changing your mind supersedes the old row
-- and inserts a new one; two live rows for the same permission would make "do they allow this?"
-- a question with two answers.
CREATE UNIQUE INDEX "consent_one_live_per_type"
  ON "consent_records" (user_id, consent_type)
  WHERE revoked_at IS NULL;

-- ------------------------------------------------------------- append-only

-- Consent that can be edited after the fact is not evidence.
--
-- The same `DO INSTEAD NOTHING` treatment already applied to `audit_logs` and `platform_configs`:
-- a DELETE is silently discarded, and an UPDATE is allowed ONLY to stamp `revoked_at` on a row
-- that is still live. Nothing can change who agreed, to what, at which version, or when — not a
-- support tool, not a migration, not a mistaken repository method.
--
-- Written as a rule rather than a trigger to match the two tables that already work this way.
CREATE RULE consent_records_no_delete AS
  ON DELETE TO "consent_records" DO INSTEAD NOTHING;

CREATE RULE consent_records_supersede_only AS
  ON UPDATE TO "consent_records"
  WHERE old.revoked_at IS NOT NULL
     OR new.granted IS DISTINCT FROM old.granted
     OR new.version IS DISTINCT FROM old.version
     OR new.consent_type IS DISTINCT FROM old.consent_type
     OR new.user_id IS DISTINCT FROM old.user_id
     OR new.granted_at IS DISTINCT FROM old.granted_at
  DO INSTEAD NOTHING;
