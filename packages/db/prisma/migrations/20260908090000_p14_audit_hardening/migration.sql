-- P14 — Audit hardening.
--
-- The application now sanitises every audit entry before writing it: a password, an OTP, a raw
-- identity number, a document key or an authentication token is replaced and the substitution
-- recorded. These constraints are the layer below that, for the same reason every other invariant
-- in this schema is duplicated into the database — an application check protects the path it sits
-- on, and a constraint protects the table.
--
-- Refs: docs/07_SECURITY.md §5, §9, §11

-- An identity number must never reach the audit log.
--
-- Ten digits is the shortest NID in circulation. Deliberately not lower: a four-digit year and a
-- six-digit quantity are ordinary things for a reason to mention, and a constraint that refused
-- them would have operators writing reasons designed to get past it.
--
-- The same rule the P10 migration put on `verification_events.reason`, applied to the table that
-- receives every other event on the platform.
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_reason_has_no_identity_number"
  CHECK ("reason" IS NULL OR "reason" !~ '[0-9]{10,}');

-- Nor a phone number.
--
-- `maskPhone` exists precisely so that a number can appear in a log line in a form that identifies
-- the account without disclosing the number. A reason carrying an unmasked one has bypassed it.
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_reason_has_no_phone_number"
  CHECK ("reason" IS NULL OR "reason" !~ '(\+?88)?01[3-9][0-9]{8}');

-- Nor this codebase's own hash format, nor a bearer credential.
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_reason_has_no_credential"
  CHECK ("reason" IS NULL OR "reason" !~* '(scrypt\$|bearer\s)');

-- An audit row must say who or what it is about.
--
-- An entry with an empty entity is a record that something happened to nothing, which no
-- investigation can follow and no query will group correctly.
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_entity_is_named"
  CHECK (length(btrim("entity_type")) > 0 AND length(btrim("entity_id")) > 0);

-- The action vocabulary is closed in the application and open here, deliberately.
--
-- A CHECK listing the actions would have to be altered by a migration every time one is added,
-- which is friction paid on every feature for a constraint that catches nothing the TypeScript
-- union does not. What is worth constraining is the SHAPE: upper snake case, so a row written by
-- some future script cannot arrive as `farm updated` and sit outside every query that looks for
-- `FARM_UPDATED`.
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_action_is_a_constant"
  CHECK ("action" ~ '^[A-Z][A-Z0-9_]*$');

-- Reading the log is a common operation and filtering by action is how it is read.
CREATE INDEX IF NOT EXISTS "audit_logs_action_created_idx"
  ON "audit_logs" ("action", "created_at");
