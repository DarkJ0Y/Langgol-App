-- NOTE: Prisma does not model GIST indexes, so `migrate dev` proposes dropping the four
-- *_geo_gix indexes on every migration. Those statements are removed by hand each time.
-- See docs/DEVELOPMENT.md "Migrations that Prisma cannot generate".

-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('EMAIL_VERIFY');

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'PHONE_VERIFY';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL,
    "destination" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "request_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_purpose_created_at_idx" ON "verification_tokens"("user_id", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "verification_tokens_expires_at_idx" ON "verification_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- invariants

-- A verified email with no email address is a contradiction the application must never be able
-- to produce. Clearing the address must clear the proof along with it.
ALTER TABLE "users" ADD CONSTRAINT "users_email_verified_requires_email" CHECK (
  email_verified_at IS NULL OR email IS NOT NULL
);

-- The destination is compared against users.email, which a CHECK already forces to lower case.
-- Storing a mixed-case copy here would make that comparison silently fail and hand the user a
-- link that can never be redeemed.
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_token_destination_lowercase" CHECK (
  destination = lower(destination) AND length(btrim(destination)) > 0
);

-- A token that expires before it was issued is dead on arrival; a zero-length window is almost
-- always a unit mix-up (seconds passed where milliseconds were meant).
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_token_expires_after_issue" CHECK (
  expires_at > created_at
);

-- At most one live token per user and purpose. Requesting a new link must invalidate the old one
-- rather than leaving a widening set of valid credentials in circulation; this makes that true
-- regardless of which code path issued them.
CREATE UNIQUE INDEX "verification_token_one_live_per_purpose"
  ON "verification_tokens" (user_id, purpose)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
