-- P16 — AI crop diagnoses.
--
-- The application layer has had the diagnose use case, its ports and its spend guard since the
-- advisory work; this is the table its repository writes to. One row per answer served.
--
-- There is no image column, on purpose. The photograph is forwarded to the provider and
-- discarded; a table with nowhere to put it cannot leak it. docs/07_SECURITY.md
CREATE TABLE "diagnoses" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        UUID NOT NULL,
  "answer"         TEXT NOT NULL,
  "confidence"     TEXT NOT NULL,
  "unusable_image" BOOLEAN NOT NULL,
  "prompt_version" INTEGER NOT NULL,
  "provider"       TEXT NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "diagnoses_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE
);

-- The spend guard counts per day across the platform and per farmer per day.
CREATE INDEX "diagnoses_user_id_created_at_idx" ON "diagnoses"("user_id", "created_at");
CREATE INDEX "diagnoses_created_at_idx" ON "diagnoses"("created_at");

-- The three confidence levels the domain knows (DIAGNOSIS_CONFIDENCE). A fourth would be an
-- answer the interface cannot label honestly.
ALTER TABLE "diagnoses"
  ADD CONSTRAINT "diagnoses_confidence_known"
  CHECK ("confidence" IN ('LOW', 'MEDIUM', 'HIGH'));

ALTER TABLE "diagnoses"
  ADD CONSTRAINT "diagnoses_answer_present"
  CHECK (btrim("answer") <> '');

ALTER TABLE "diagnoses"
  ADD CONSTRAINT "diagnoses_prompt_version_positive"
  CHECK ("prompt_version" > 0);

ALTER TABLE "diagnoses"
  ADD CONSTRAINT "diagnoses_provider_present"
  CHECK (btrim("provider") <> '');

-- ADR-06: deny-all row-level security on every table (P15). The guarantees check fails CI on a
-- public table without it.
ALTER TABLE "diagnoses" ENABLE ROW LEVEL SECURITY;
