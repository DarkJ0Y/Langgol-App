-- Behavioural verification: do the guarantees actually reject bad data?
--
-- A constraint that exists but does not bite is worse than none, because it buys false
-- confidence. This script writes and deletes rows, so it is **CI and disposable environments
-- only** — it deliberately refuses to run against a database that already holds real users.
--
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/checks/verify-database-behaviour.sql

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_area_id uuid;
  v_user_id uuid;
  v_geo_present boolean;
  v_created_area boolean := false;
BEGIN
  IF (SELECT count(*) FROM users) > 0 THEN
    RAISE EXCEPTION
      'Refusing to run behavioural checks: this database already contains users. Run against CI or a scratch database only.';
  END IF;

  ----------------------------------------------------------------------------
  -- Phone numbers must be normalised before they reach the database.
  ----------------------------------------------------------------------------
  BEGIN
    INSERT INTO users (id, phone, full_name, updated_at)
    VALUES (gen_random_uuid(), '01712345678', 'Unnormalised Phone', now());
    RAISE EXCEPTION 'users_phone_e164_bd did not reject an unnormalised phone number';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO users (id, phone, full_name, updated_at)
    VALUES (gen_random_uuid(), '+8801212345678', 'Invalid Operator Prefix', now());
    RAISE EXCEPTION 'users_phone_e164_bd accepted an impossible operator prefix';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  ----------------------------------------------------------------------------
  -- An OTP must never be stored in plaintext. Six digits cannot be 32+ characters.
  ----------------------------------------------------------------------------
  BEGIN
    INSERT INTO otp_challenges (id, phone, code_hash, purpose, expires_at)
    VALUES (gen_random_uuid(), '+8801711000001', '123456', 'LOGIN', now() + interval '5 minutes');
    RAISE EXCEPTION 'otp_code_is_hashed accepted a plaintext OTP';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  ----------------------------------------------------------------------------
  -- The development-fixture flag cannot be attached to a real user's number.
  ----------------------------------------------------------------------------
  BEGIN
    INSERT INTO users (id, phone, full_name, is_development_fixture, updated_at)
    VALUES (gen_random_uuid(), '+8801712345678', 'Fake Fixture', true, now());
    RAISE EXCEPTION 'users_dev_fixture_reserved_block allowed a fixture flag outside the reserved block';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  ----------------------------------------------------------------------------
  -- The audit log is append-only.
  ----------------------------------------------------------------------------
  INSERT INTO audit_logs (id, action, entity_type, entity_id)
  VALUES (gen_random_uuid(), 'GUARANTEE_CHECK', 'test', 'test');

  UPDATE audit_logs SET action = 'TAMPERED' WHERE action = 'GUARANTEE_CHECK';
  IF EXISTS (SELECT 1 FROM audit_logs WHERE action = 'TAMPERED') THEN
    RAISE EXCEPTION 'audit_logs is not append-only: an UPDATE took effect';
  END IF;

  DELETE FROM audit_logs WHERE action = 'GUARANTEE_CHECK';
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'GUARANTEE_CHECK') THEN
    RAISE EXCEPTION 'audit_logs is not append-only: a DELETE took effect';
  END IF;

  ----------------------------------------------------------------------------
  -- Published configuration is immutable history.
  ----------------------------------------------------------------------------
  UPDATE platform_configs SET note = 'TAMPERED';
  IF EXISTS (SELECT 1 FROM platform_configs WHERE note = 'TAMPERED') THEN
    RAISE EXCEPTION 'platform_configs is not immutable: an UPDATE took effect';
  END IF;

  ----------------------------------------------------------------------------
  -- The geography trigger derives the PostGIS point from latitude/longitude.
  ----------------------------------------------------------------------------
  SELECT id INTO v_area_id FROM admin_areas WHERE type = 'UNION' LIMIT 1;
  IF v_area_id IS NULL THEN
    SELECT id INTO v_area_id FROM admin_areas LIMIT 1;
  END IF;

  /*
   * Create one if the database has none.
   *
   * This script must run BEFORE the seed — its own precondition refuses a database that already
   * holds users, and seeding creates development fixtures. But it also needs somewhere to hang a
   * test address. Borrowing a seeded area made the two requirements contradictory and left no
   * valid ordering at all; creating what it needs, like it already does for users and addresses,
   * makes it self-contained and correct whenever it is run.
   */
  IF v_area_id IS NULL THEN
    INSERT INTO admin_areas (id, type, name_en, name_bn)
    VALUES (gen_random_uuid(), 'UNION', 'Guarantee Check Union', 'গ্যারান্টি চেক ইউনিয়ন')
    RETURNING id INTO v_area_id;
    v_created_area := true;
  END IF;

  INSERT INTO users (id, phone, full_name, updated_at)
  VALUES (gen_random_uuid(), '+8801711000002', 'Geo Check', now())
  RETURNING id INTO v_user_id;

  INSERT INTO addresses (
    id, user_id, recipient_name, recipient_phone, admin_area_id,
    address_line, latitude, longitude, precision, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, 'Geo Check', '+8801711000002', v_area_id,
    'Test address', 24.374945, 88.604229, 'EXACT', now()
  );

  SELECT geo IS NOT NULL INTO v_geo_present FROM addresses WHERE user_id = v_user_id;
  IF NOT v_geo_present THEN
    RAISE EXCEPTION 'addresses_sync_geo did not populate the geography column';
  END IF;

  -- And a radius query must work against it.
  IF NOT EXISTS (
    SELECT 1 FROM addresses
    WHERE ST_DWithin(geo, ST_SetSRID(ST_MakePoint(88.604229, 24.374945), 4326)::geography, 100)
  ) THEN
    RAISE EXCEPTION 'ST_DWithin radius search returned nothing for a co-located point';
  END IF;

  ----------------------------------------------------------------------------
  -- Coordinates must be plausible.
  ----------------------------------------------------------------------------
  BEGIN
    INSERT INTO addresses (
      id, user_id, recipient_name, recipient_phone, admin_area_id,
      address_line, latitude, longitude, updated_at
    ) VALUES (
      gen_random_uuid(), v_user_id, 'Bad Coords', '+8801711000002', v_area_id,
      'Test', 999, 999, now()
    );
    RAISE EXCEPTION 'addresses_coordinates_valid accepted an impossible coordinate';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  ----------------------------------------------------------------------------
  -- Only one default address per user.
  ----------------------------------------------------------------------------
  UPDATE addresses SET is_default = true WHERE user_id = v_user_id;
  BEGIN
    INSERT INTO addresses (
      id, user_id, recipient_name, recipient_phone, admin_area_id,
      address_line, is_default, updated_at
    ) VALUES (
      gen_random_uuid(), v_user_id, 'Second Default', '+8801711000002', v_area_id,
      'Test', true, now()
    );
    RAISE EXCEPTION 'addresses_one_default_per_user allowed a second default address';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- Clean up everything this script created, in dependency order.
  DELETE FROM addresses WHERE user_id = v_user_id;
  DELETE FROM users WHERE id = v_user_id;
  IF v_created_area THEN
    DELETE FROM admin_areas WHERE id = v_area_id;
  END IF;

  RAISE NOTICE 'Behavioural guarantee checks passed.';
END;
$$;
