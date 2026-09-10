-- P11 — Digital agricultural identity.
--
-- One table, one column that matters. The AGRI-ID is the public name a person carries in the
-- agricultural economy, and every future module — credit, traceability, insurance, a government
-- programme, a certificate — will join to it rather than to a user id, because a user id is an
-- internal key that should never be printed on anything.
--
-- Refs: docs/07_SECURITY.md §7; docs/02_DATABASE.md §5

CREATE TABLE "agri_identities" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"      UUID NOT NULL UNIQUE,
  "agri_id"      TEXT NOT NULL UNIQUE,
  "country_code" TEXT NOT NULL DEFAULT 'BD',
  "issued_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agri_identities_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE
);

-- One identifier, one person, in both directions.
--
-- The application generates a candidate and asks the database whether it is free. A read-then-write
-- check loses the race with itself, and two people sharing an AGRI-ID is not a state this system
-- could recover from once either of them has printed it on a delivery note.
--
-- The two unique indexes that enforce this are created by the inline UNIQUE on `user_id` and
-- `agri_id` above. Postgres names an implicit index `<table>_<column>_key`, which is the same name
-- Prisma expects for an `@unique` field — so declaring them again here as explicit CREATE UNIQUE
-- INDEX statements failed with "relation already exists" and took the whole migration down.
--
-- Stated rather than deleted, because the constraint is the point and the next person reading this
-- file needs to know where it lives.

-- The identifier must have the published shape.
--
-- `AGRI-<2 letters>-<8 symbols>`, where the symbols are Crockford base32: no I, L, O or U. The
-- first three are unreadable beside 1 and 0 in the handwriting this will actually be copied in,
-- and U is excluded so that no accidental word appears on somebody's certificate.
--
-- The same expression is exported from the domain as `AGRI_ID_SQL_PATTERN`, so the constraint and
-- the generator are written from one source rather than two that drift.
ALTER TABLE "agri_identities"
  ADD CONSTRAINT "agri_id_has_published_shape"
  CHECK ("agri_id" ~ '^AGRI-[A-Z]{2}-[0-9A-HJ-NP-TV-Z]{8}$');

-- The identifier must not be a run of digits.
--
-- Guards the failure this whole design exists to prevent: somebody replacing the random generator
-- with something derived from an NID or a phone number. A derived identifier would almost
-- certainly be numeric, and this refuses to store one — a loud failure at the first write rather
-- than a quiet disclosure on every certificate thereafter.
ALTER TABLE "agri_identities"
  ADD CONSTRAINT "agri_id_is_not_a_number"
  CHECK (substring("agri_id" from 9) !~ '^[0-9]+$');

-- Country codes are two upper-case letters, and Bangladesh is the only one issued today.
ALTER TABLE "agri_identities"
  ADD CONSTRAINT "agri_identity_country_known"
  CHECK ("country_code" = 'BD');

-- The country in the identifier must be the country on the row.
--
-- Without this the two can drift, and the printed identifier is the one that wins every argument.
ALTER TABLE "agri_identities"
  ADD CONSTRAINT "agri_id_country_matches_row"
  CHECK (substring("agri_id" from 6 for 2) = "country_code");
