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
    'users_dev_fixture_reserved_block',

    -- P1: users and roles
    'users_full_name_present',
    'users_optional_text_not_blank',
    'users_email_lowercase',
    'users_date_of_birth_plausible',
    'role_revocation_attributed',
    'role_definition_labelled',

    -- P2: verification
    'users_email_verified_requires_email',
    'verification_token_destination_lowercase',
    'verification_token_expires_after_issue',

    -- P3: addresses and farm boundaries
    'addresses_country_code_iso',
    'addresses_postal_code_bd',
    'addresses_coordinates_in_country',
    'farms_boundary_valid',

    -- P4: consent
    'consent_version_positive',
    'consent_revoked_after_granted'
  ];

  expected_indexes text[] := ARRAY[
    'addresses_geo_gix',
    'admin_areas_geo_gix',
    'addresses_one_default_per_user',
    'outbox_events_pending',
    'users_development_fixtures',

    -- P1: one live grant per (user, role); P2: one live verification link per (user, purpose)
    'user_role_assignments_user_id_role_key',
    'verification_token_one_live_per_purpose',

    -- P3: postcode corridor lookups, and the farm boundary index
    'addresses_postal_code_idx',
    'farms_boundary_gix',

    -- P4: one live decision per user and permission
    'consent_one_live_per_type'
  ];

  expected_triggers text[] := ARRAY[
    'addresses_sync_geo',
    'admin_areas_sync_geo',

    -- P2: changing an email address retracts the proof that it was verified, whatever wrote the
    -- row. The application does this too; the trigger is what makes it true from psql.
    'users_email_change_retracts_verification'
  ];

  /*
   * Foreign keys whose DELETE behaviour is itself the guarantee. `granted_by_id` and
   * `revoked_by_id` are RESTRICT so that deleting an administrator cannot silently erase the
   * record of who granted whom what; a migration that recreated them as CASCADE would compile,
   * deploy, and quietly destroy the audit trail.
   */
  expected_restrict_fks text[] := ARRAY[
    'user_role_assignments_granted_by_id_fkey',
    'user_role_assignments_revoked_by_id_fkey'
  ];

  expected_rules text[] := ARRAY[
    'audit_logs_no_update',
    'audit_logs_no_delete',
    'platform_configs_no_update',
    'platform_configs_no_delete',

    -- P4: consent that can be edited after the fact is not evidence.
    'consent_records_no_delete',
    'consent_records_supersede_only'
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

  FOREACH item IN ARRAY expected_restrict_fks LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = item AND contype = 'f' AND confdeltype = 'r'
    ) THEN
      missing := missing || ('restrict-fk:' || item);
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
    + array_length(expected_triggers, 1) + array_length(expected_rules, 1)
    + array_length(expected_restrict_fks, 1);
END;
$$;
