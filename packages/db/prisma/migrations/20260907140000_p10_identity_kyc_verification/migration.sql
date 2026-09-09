-- P10 — Identity, KYC and verification.
--
-- Three tables: the verification hub that all seven types share, the identity document behind an
-- IDENTITY verification, and an append-only history of every decision.
--
-- The rules below are in the database rather than only in the application because they are the
-- ones whose violation is unrecoverable. A rejection with no reason cannot be reconstructed
-- afterwards; an approval with no reviewer cannot be attributed to anybody; and a history that
-- can be edited is not evidence of anything. docs/07_SECURITY.md §4, §7, §11

-- ------------------------------------------------------------------- enums

CREATE TYPE "KycVerificationType" AS ENUM (
  'PHONE', 'EMAIL', 'IDENTITY', 'FARM', 'BUSINESS', 'EXPERT', 'PAYMENT'
);

CREATE TYPE "KycStatus" AS ENUM (
  'PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED'
);

CREATE TYPE "KycMethod" AS ENUM (
  'MANUAL_REVIEW', 'AUTOMATED_CHALLENGE', 'GOVERNMENT_REGISTRY', 'FIELD_AGENT'
);

CREATE TYPE "IdentityDocumentType" AS ENUM (
  'NID', 'BIRTH_CERTIFICATE', 'PASSPORT', 'DRIVING_LICENCE'
);

-- ------------------------------------------------------------ verifications

CREATE TABLE "verifications" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"          UUID NOT NULL,
  "type"             "KycVerificationType" NOT NULL,
  "status"           "KycStatus" NOT NULL DEFAULT 'PENDING',
  "method"           "KycMethod",
  "submitted_at"     TIMESTAMP(3),
  "reviewed_at"      TIMESTAMP(3),
  "reviewer_user_id" UUID,
  "rejection_reason" TEXT,
  "expires_at"       TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "verifications_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "verifications_reviewer_fk" FOREIGN KEY ("reviewer_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL
);

-- One verification of each kind per user.
--
-- Two taps on a slow connection must produce ONE row in the reviewer's queue. Only the database
-- can arbitrate that; a read-then-write check in the application loses the race with itself.
CREATE UNIQUE INDEX "verifications_user_type_key" ON "verifications" ("user_id", "type");

-- The queue: pending work, oldest first. A KYC backlog is a first-come obligation, so the
-- ordering is part of the index rather than a sort applied afterwards.
CREATE INDEX "verifications_status_submitted_idx" ON "verifications" ("status", "submitted_at");
CREATE INDEX "verifications_user_idx" ON "verifications" ("user_id");
CREATE INDEX "verifications_reviewer_idx" ON "verifications" ("reviewer_user_id");

-- A rejection must say why.
--
-- The person is going to re-submit. "Rejected" with no reason tells them nothing about what to
-- change, so they guess, send the same documents again, and occupy the queue twice. The reason is
-- the difference between a decision and a wall.
ALTER TABLE "verifications"
  ADD CONSTRAINT "verification_rejection_has_reason"
  CHECK ("status" <> 'REJECTED' OR ("rejection_reason" IS NOT NULL
         AND length(btrim("rejection_reason")) >= 4));

-- A decision must be attributable.
--
-- An approval nobody signed is the single most damaging row this table could hold: it is exactly
-- what a fraudulent verification looks like afterwards, and it is indistinguishable from a bug.
-- Both halves are required together — a reviewer with no timestamp is as useless as a timestamp
-- with no reviewer.
ALTER TABLE "verifications"
  ADD CONSTRAINT "verification_decision_attributed"
  CHECK (
    "status" NOT IN ('VERIFIED', 'REJECTED')
    OR ("reviewer_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)
  );

-- Nobody reviews their own document.
--
-- The conflict of interest that every KYC fraud write-up begins with. Enforced here as well as in
-- the policy layer, because this is the one place it cannot be forgotten.
ALTER TABLE "verifications"
  ADD CONSTRAINT "verification_reviewer_is_not_subject"
  CHECK ("reviewer_user_id" IS NULL OR "reviewer_user_id" <> "user_id");

-- ------------------------------------------------------------ identity data

CREATE TABLE "identity_records" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         UUID NOT NULL UNIQUE,
  "verification_id" UUID NOT NULL UNIQUE,
  "identity_type"   "IdentityDocumentType" NOT NULL,

  -- AES-256-GCM, under a key that is not in this database, bound to the owning user so a
  -- ciphertext lifted into another row fails to decrypt rather than moving an identity.
  "identity_number_ciphertext"  TEXT NOT NULL,
  -- Keyed HMAC. Lets "is this document already registered?" be answered without decrypting.
  "identity_number_blind_index" TEXT NOT NULL,
  -- Already masked, so rendering never needs a decryption.
  "identity_number_masked"      TEXT NOT NULL,
  "identity_number_last4"       TEXT NOT NULL,

  "document_front_key" TEXT NOT NULL,
  "document_back_key"  TEXT,

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "identity_records_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "identity_records_verification_fk" FOREIGN KEY ("verification_id")
    REFERENCES "verifications"("id") ON DELETE CASCADE
);

-- One document verifies one person.
--
-- Without this, the same NID can be submitted on any number of accounts and every one of them can
-- be approved. That is the primary abuse this whole feature exists to prevent, so it is a UNIQUE
-- rather than a check the application performs before inserting.
CREATE UNIQUE INDEX "identity_records_blind_index_key"
  ON "identity_records" ("identity_number_blind_index");

-- The masked value must actually be masked.
--
-- The failure this catches is a code path that writes the raw number into the column meant for
-- display. It would be invisible in testing — the screen would simply show the whole NID, which
-- looks like data rather than like a bug — and every reader of that page would see it.
ALTER TABLE "identity_records"
  ADD CONSTRAINT "identity_masked_is_masked"
  CHECK ("identity_number_masked" LIKE '%' || chr(8226) || '%');

-- Four digits, and only four. A longer tail stored "temporarily" is a wider disclosure on every
-- screen that renders it.
ALTER TABLE "identity_records"
  ADD CONSTRAINT "identity_last4_is_four_digits"
  CHECK ("identity_number_last4" ~ '^[0-9]{4}$');

-- The ciphertext must be a ciphertext.
--
-- Guards the failure mode that matters most: a bug, or a future refactor, writing the plaintext
-- NID into this column. Every ciphertext this application produces carries the version prefix,
-- and a bare ten-digit number does not.
ALTER TABLE "identity_records"
  ADD CONSTRAINT "identity_ciphertext_is_enveloped"
  CHECK ("identity_number_ciphertext" LIKE 'v1$%');

-- Documents are keys into private object storage, never URLs. A URL here would mean the bytes
-- are reachable without passing the authorization that guards them.
ALTER TABLE "identity_records"
  ADD CONSTRAINT "identity_documents_are_storage_keys"
  CHECK (
    "document_front_key" LIKE 'kyc-documents/%'
    AND ("document_back_key" IS NULL OR "document_back_key" LIKE 'kyc-documents/%')
  );

-- --------------------------------------------------------- verification log

CREATE TABLE "verification_events" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "verification_id" UUID NOT NULL,
  "actor_user_id"   UUID,
  "action"          TEXT NOT NULL,
  "from_status"     "KycStatus",
  "to_status"       "KycStatus" NOT NULL,
  "reason"          TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "verification_events_verification_fk" FOREIGN KEY ("verification_id")
    REFERENCES "verifications"("id") ON DELETE CASCADE,
  CONSTRAINT "verification_events_actor_fk" FOREIGN KEY ("actor_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "verification_events_record_time_idx"
  ON "verification_events" ("verification_id", "created_at");

-- The history is append-only.
--
-- A record of who approved what, which the approver can later edit, is not evidence — it is a
-- note. This is the same rule and the same mechanism already applied to `audit_logs` and
-- `platform_configs`, and it is applied here for the same reason.
--
-- Deletion is refused too. A cascade from `verifications` still works, because the CASCADE runs
-- as a referential action rather than a statement-level DELETE against this table.
CREATE OR REPLACE FUNCTION verification_events_append_only_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'verification_events is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER verification_events_no_update
  BEFORE UPDATE ON "verification_events"
  FOR EACH ROW EXECUTE FUNCTION verification_events_append_only_fn();

CREATE TRIGGER verification_events_no_delete
  BEFORE DELETE ON "verification_events"
  FOR EACH ROW EXECUTE FUNCTION verification_events_append_only_fn();

-- An identity number must never reach this table.
--
-- `reason` holds a reviewer's own words, and a reviewer typing "NID 1234567890 does not match"
-- would copy the number into a table with a different retention policy and a much wider audience
-- than the encrypted column it belongs in.
--
-- Deliberately narrow: it refuses long digit runs, not every number. A reason saying "photo is
-- blurred on line 3" must still be writable, or reviewers will work around the rule.
ALTER TABLE "verification_events"
  ADD CONSTRAINT "verification_event_reason_has_no_identity_number"
  CHECK ("reason" IS NULL OR "reason" !~ '[0-9]{10,}');

ALTER TABLE "verifications"
  ADD CONSTRAINT "verification_rejection_reason_has_no_identity_number"
  CHECK ("rejection_reason" IS NULL OR "rejection_reason" !~ '[0-9]{10,}');
