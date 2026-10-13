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
    'consent_revoked_after_granted',

    -- P5: the farmer profile may be incomplete, but never self-contradictory
    'farmer_experience_plausible',
    'farmer_land_amount_needs_unit',
    'farmer_land_amount_positive',
    'farmer_irrigation_consistent',

    -- P6: farms and plots may be incomplete, never self-contradictory
    'farms_area_needs_unit',
    'farms_area_positive',
    'farms_irrigation_consistent',
    'plots_area_needs_unit',
    'plots_area_positive',
    'plots_name_present',
    'plots_coordinates_valid',
    'plots_coordinates_in_country',

    -- P8: a production record may be incomplete, never impossible
    'productions_year_plausible',
    'productions_amounts_nonneg',
    'productions_area_needs_unit',
    'productions_area_positive',
    'productions_quantity_needs_unit',
    'productions_sold_not_more_than_grown',

    -- P9: role profiles may be incomplete, never impossible or ambiguously owned
    'profile_service_area_exactly_one_owner',
    'retailer_years_plausible',
    'expert_years_plausible',
    'wholesaler_capacity_plausible',
    'expert_fee_nonneg',

    -- P9: a shop pin is a pair inside Bangladesh, or it is nothing at all
    'retailer_shop_location_paired',
    'retailer_shop_location_plausible',

    -- P10: a KYC decision is attributable, reasoned, and never made by its own subject
    'verification_rejection_has_reason',
    'verification_decision_attributed',
    'verification_reviewer_is_not_subject',
    'verification_event_reason_has_no_identity_number',
    'verification_rejection_reason_has_no_identity_number',
    'identity_masked_is_masked',
    'identity_last4_is_four_digits',
    'identity_ciphertext_is_enveloped',
    'identity_documents_are_storage_keys',

    -- P11: a public agricultural identifier that is random, shaped, and not a number
    'agri_id_has_published_shape',
    'agri_id_is_not_a_number',
    'agri_identity_country_known',
    'agri_id_country_matches_row',

    -- P13: a permission grant is attributable and never self-awarded
    'admin_permission_revocation_attributed',
    'admin_permission_granted_by_another',

    -- P14: nothing forbidden reaches the audit log, and every row names its subject
    'audit_reason_has_no_identity_number',
    'audit_reason_has_no_phone_number',
    'audit_reason_has_no_credential',
    'audit_entity_is_named',
    'audit_action_is_a_constant'
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
    'consent_one_live_per_type',

    -- P5: "farmers near here who grow X"
    'farmer_profiles_farmer_type_idx',

    -- P6: plot lookups and the mapping surface the boundary column is waiting for
    'plots_farm_id_idx',
    'plots_boundary_gix',
    'plots_geo_gix',
    'farms_address_id_idx',

    -- P8: the history filters — by year, by crop, by season
    'productions_farmer_year_idx',
    'productions_farmer_product_idx',
    'productions_farmer_season_idx',

    -- P9: finding a verified expert must be a lookup, not a scan
    'agricultural_expert_profiles_verification_status_idx',
    'profile_service_areas_area_idx',
    'consumer_profiles_address_id_idx',

    -- P10: the review queue is a lookup, and one document verifies one person
    'verifications_status_submitted_idx',
    'verifications_user_type_key',
    'identity_records_blind_index_key',

    -- P11: one identifier, one person, in both directions
    'agri_identities_agri_id_key',
    'agri_identities_user_id_key',

    -- P13: one live grant of each permission per administrator
    'admin_permission_grants_one_live',

    -- P14: filtering the audit log by action is how it is actually read
    'audit_logs_action_created_idx'
  ];

  expected_triggers text[] := ARRAY[
    'addresses_sync_geo',
    'admin_areas_sync_geo',

    -- P2: changing an email address retracts the proof that it was verified, whatever wrote the
    -- row. The application does this too; the trigger is what makes it true from psql.
    'users_email_change_retracts_verification',

    -- P4: consent that can be edited after the fact is not evidence. Triggers rather than rules,
    -- because a rule on the child of a foreign key breaks referential integrity — see the
    -- p4_consent_append_only_triggers migration.
    'consent_records_block_direct_delete',
    'consent_records_block_history_rewrite',

    -- P6: the geography column is derived from the pin, and a farm's address must belong to the
    -- same user as the farm. The foreign key proves the address exists, not that it is theirs.
    'plots_sync_geo',
    'farms_address_same_owner',

    -- P8: revenue is DERIVED. A farmer may say what they sold and what they were paid; the
    -- product of the two is not theirs to state, and this trigger overwrites whatever is sent.
    'productions_derive_revenue',

    -- P9: a profile's address must belong to the same user. The foreign key proves the address
    -- exists, not that it is theirs — the same IDOR the farms table closed in P6.
    'retailer_profile_address_same_owner',
    'wholesaler_profile_address_same_owner',
    'supplier_profile_address_same_owner',
    'consumer_profile_address_same_owner',

    -- P10: a record of who approved what, which the approver can edit, is not evidence.
    'verification_events_no_update',
    'verification_events_no_delete'
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

  -- ADR-06: RLS deny-all on every table, so a hosted database's public API cannot reach them.
  -- Checked by inventory rather than by name, so a table added later without it fails here.
  FOR item IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> 'spatial_ref_sys'
      AND NOT c.relrowsecurity
  LOOP
    missing := missing || ('rls:' || item);
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
