-- Development fixtures for every role.
--
-- P9 gave profiles to WHOLESALER, SUPPLIER, AGRICULTURAL_EXPERT and LOGISTICS_PROVIDER. All four
-- are CONTROLLED roles: no account may self-select them at registration. So the only way to open
-- a wholesaler's or an expert's screens is a fixture that already holds the role — and the
-- reserved block was full at nine.
--
-- Widening it is the deliberate act the original migration asked for, which is why it is a
-- migration and not a code change. The constraint is the control, so the control moves where the
-- database can see it move.
--
-- The second run of endings starts at 21 rather than 10. `+8801700000011` and `+8801700000012`
-- are the fixed-code OTP test numbers: they sign in WITH a code, where a fixture signs in
-- WITHOUT one. A number reachable both ways would be secured by whichever path is weaker, so the
-- two runs are kept disjoint.
--
-- docs/03_ARCHITECTURE.md ADR-22; docs/07_SECURITY.md §3

ALTER TABLE "users" DROP CONSTRAINT users_dev_fixture_reserved_block;

-- +8801700000001 … +8801700000009 and +8801700000020 … +8801700000029. Structurally valid
-- Bangladeshi numbers, so fixtures satisfy exactly the same normalisation and constraints as
-- real users, in an area no operator assigns.
ALTER TABLE "users" ADD CONSTRAINT users_dev_fixture_reserved_block CHECK (
  is_development_fixture = false
  OR phone ~ '^\+88017000000(0[1-9]|2[0-9])$'
);
