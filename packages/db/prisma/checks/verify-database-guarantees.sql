-- Structural verification: are the database guarantees actually present?
--
-- Migrations that "ran successfully" are not evidence that the constraints exist. A hand-edited
-- migration, a partially applied deploy, or an environment restored from an old backup can all
-- leave the schema without them. This script is read-only and safe to run anywhere, including
-- production.
--
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/checks/verify-database-guarantees.sql

\set ON_ERROR_STOP on

DO $$
DECLARE
  missing text[] := ARRAY[]::text[];

  expected_checks text[] := ARRAY[
    'addresses_coordinates_valid',
    'addresses_recipient_phone_e164_bd',
    'admin_areas_centroid_valid',
    'admin_areas_not_self_parent',
    'users_phone_e164_bd',
    'otp_attempts_sane',
    'otp_expiry_after_creation',
    'otp_code_is_hashed',
    'sessions_token_is_hashed',
    'sessions_expiry_after_creation',
    'platform_config_version_positive',
    'notifications_attempts_nonneg',
    'outbox_attempts_nonneg',
    'idempotency_expiry_after_creation',
    'users_dev_fixture_reserved_block'
  ];

  expected_indexes text[] := ARRAY[
    'addresses_geo_gix',
    'admin_areas_geo_gix',
    'addresses_one_default_per_user',
    'outbox_events_pending',
    'users_development_fixtures'
  ];

  expected_triggers text[] := ARRAY[
    'addresses_sync_geo',
    'admin_areas_sync_geo'
  ];

  expected_rules text[] := ARRAY[
    'audit_logs_no_update',
    'audit_logs_no_delete',
    'platform_configs_no_update',
    'platform_configs_no_delete'
  ];

  item text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    missing := missing || 'extension:postgis';
  END IF;

  FOREACH item IN ARRAY expected_checks LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = item AND contype = 'c') THEN
      missing := missing || ('check:' || item);
    END IF;
  END LOOP;

  FOREACH item IN ARRAY expected_indexes LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = item AND relkind = 'i') THEN
      missing := missing || ('index:' || item);
    END IF;
  END LOOP;

  FOREACH item IN ARRAY expected_triggers LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = item AND NOT tgisinternal) THEN
      missing := missing || ('trigger:' || item);
    END IF;
  END LOOP;

  FOREACH item IN ARRAY expected_rules LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_rules WHERE rulename = item) THEN
      missing := missing || ('rule:' || item);
    END IF;
  END LOOP;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Database guarantees missing: %', array_to_string(missing, ', ');
  END IF;

  RAISE NOTICE 'All % database guarantees are present.',
    array_length(expected_checks, 1) + array_length(expected_indexes, 1)
    + array_length(expected_triggers, 1) + array_length(expected_rules, 1);
END;
$$;
