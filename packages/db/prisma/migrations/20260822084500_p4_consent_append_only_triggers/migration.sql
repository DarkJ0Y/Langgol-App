-- Replace the consent append-only RULES with triggers.
--
-- The rules were wrong, and CI caught it:
--
--   ERROR: referential integrity query on "users" from constraint
--          "consent_records_user_id_fkey" on "consent_records" gave unexpected result
--   HINT:  This is most likely due to a rule having rewritten the query.
--
-- A rule rewrites the QUERY, and PostgreSQL's referential-integrity machinery issues its own
-- internal queries against the child table. `DO INSTEAD NOTHING` rewrote those too, so deleting
-- ANY user failed — even one with no consent records at all, because the RI check runs regardless
-- of whether there is anything to cascade.
--
-- `audit_logs` and `platform_configs` carry the same kind of rule safely, which is what made this
-- look like an established pattern. The difference is that neither of them is the CHILD of a
-- foreign key with a referential action. `consent_records` is.
--
-- Triggers fire per row instead of rewriting the statement, so RI is unaffected. They also remove
-- a second, quieter trap: PostgreSQL refuses `UPDATE ... RETURNING` on a table carrying a
-- CONDITIONAL rule, and `prisma.update()` uses RETURNING — so the obvious Prisma method would
-- have failed at runtime with an error pointing nowhere near the cause.

DROP RULE IF EXISTS consent_records_no_delete ON "consent_records";
DROP RULE IF EXISTS consent_records_supersede_only ON "consent_records";

-- ------------------------------------------------------------------ deletion

/*
 * Consent dies with the account, but cannot be picked off individually.
 *
 * Those two rules pull in opposite directions and the discriminator is whether the parent still
 * exists. A cascade from `users` runs after the parent row has already gone, so an absent user
 * means this delete is part of erasing the whole account — which docs/07 §9.2 supports, consent
 * being personal data rather than a financial record that must be retained.
 *
 * A delete while the user is still there is somebody removing one consent record, which is the
 * thing append-only exists to prevent.
 */
CREATE OR REPLACE FUNCTION consent_records_guard_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = old.user_id) THEN
    RETURN old;
  END IF;
  -- Discarded silently, matching how audit_logs and platform_configs behave.
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consent_records_block_direct_delete
  BEFORE DELETE ON "consent_records"
  FOR EACH ROW EXECUTE FUNCTION consent_records_guard_delete();

-- -------------------------------------------------------------------- update

/*
 * Exactly one edit is permitted: stamping `revoked_at` on a decision that is still live.
 *
 * Everything else — who agreed, to what, at which version, when — is discarded. Consent that can
 * be rewritten after the fact is not evidence, and the value of this table is entirely that it
 * can be trusted years later.
 *
 * `updated_at` is deliberately not compared: Prisma maintains it, and it carries no claim about
 * what was agreed.
 */
CREATE OR REPLACE FUNCTION consent_records_guard_update()
RETURNS TRIGGER AS $$
BEGIN
  IF old.revoked_at IS NOT NULL
     OR new.granted IS DISTINCT FROM old.granted
     OR new.version IS DISTINCT FROM old.version
     OR new.consent_type IS DISTINCT FROM old.consent_type
     OR new.user_id IS DISTINCT FROM old.user_id
     OR new.granted_at IS DISTINCT FROM old.granted_at
     OR new.source IS DISTINCT FROM old.source
  THEN
    RETURN NULL;
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consent_records_block_history_rewrite
  BEFORE UPDATE ON "consent_records"
  FOR EACH ROW EXECUTE FUNCTION consent_records_guard_update();
