-- Changing an email address retracts the proof that it was verified.
--
-- `accountRepository.updateProfile` already clears `email_verified_at` in the same statement that
-- changes `email`, so the application never produces the bad state. That is not enough: a data
-- migration, an admin console, a psql session or a future repository method that forgets would
-- leave `email_verified_at` set on an address nobody has ever proven. Something downstream would
-- then read that column and believe it.
--
-- The invariant belongs in the database for the same reason the ledger balance and the audit-log
-- immutability do: it must hold regardless of which code path wrote the row.
--
-- A trigger rather than a CHECK because this is a rule about a TRANSITION, not about a row —
-- a CHECK cannot see the previous value.
--
-- Note the null-safe comparison. `old.email <> new.email` is NULL rather than true when either
-- side is NULL, so plain inequality would silently skip exactly the case where an address is
-- added to an account that had none, or removed from one that had.

CREATE OR REPLACE FUNCTION retract_email_verification()
RETURNS TRIGGER AS $$
BEGIN
  IF old.email IS DISTINCT FROM new.email THEN
    -- Re-stamping in the same statement is legitimate: `markEmailVerified` sets the address and
    -- the timestamp together. Only clear when the caller did not set a fresh one.
    IF new.email_verified_at IS NOT DISTINCT FROM old.email_verified_at THEN
      new.email_verified_at := NULL;
    END IF;
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_email_change_retracts_verification
  BEFORE UPDATE OF email ON "users"
  FOR EACH ROW
  EXECUTE FUNCTION retract_email_verification();
