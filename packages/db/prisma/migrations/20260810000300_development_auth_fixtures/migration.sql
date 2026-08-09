-- Development authentication fixtures.
--
-- Development sign-in exists so engineering can proceed before SMS infrastructure is contracted.
-- It is a scaffold, and this migration is what stops a scaffold becoming a back door.
--
-- The flag alone would be a convention. The CHECK constraint makes it a control: a row can only
-- carry `is_development_fixture` if its phone number sits in a reserved block that is never
-- allocated to a person. Flipping the flag on a real user's row is rejected by the database, not
-- by a code review.
--
-- docs/03_ARCHITECTURE.md ADR-22; docs/07_SECURITY.md §3

ALTER TABLE "users" ADD COLUMN "is_development_fixture" BOOLEAN NOT NULL DEFAULT false;

-- +8801700000001 … +8801700000009 — structurally valid Bangladeshi numbers, so fixtures satisfy
-- exactly the same normalisation and constraints as real users, in a block no operator assigns.
ALTER TABLE "users" ADD CONSTRAINT users_dev_fixture_reserved_block CHECK (
  is_development_fixture = false
  OR phone ~ '^\+880170000000[1-9]$'
);

-- Fixtures are findable in one indexed lookup, and the index is tiny because the predicate is
-- false for every real row.
CREATE INDEX users_development_fixtures ON "users" (phone) WHERE is_development_fixture;
