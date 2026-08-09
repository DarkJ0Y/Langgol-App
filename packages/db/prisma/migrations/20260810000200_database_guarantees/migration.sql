-- Database guarantees.
--
-- These objects are part of the SECURITY MODEL, not a convenience. TypeScript validation
-- protects against mistakes; these protect against bugs, against a future code path nobody
-- reviewed, and against anyone with a database connection. docs/07_SECURITY.md §2, §10
--
-- Prisma cannot express CHECK constraints, rules, triggers, partial indexes or GIST indexes, so
-- they are hand-authored here and verified by prisma/checks/verify-database-guarantees.sql,
-- which CI runs after every migration.

-- ===========================================================================
-- 1. Geography: keep the PostGIS point in step with latitude/longitude
-- ===========================================================================
--
-- A trigger rather than a GENERATED ALWAYS column, so the physical schema matches what Prisma
-- believes exists and migrations never drift. Application code writes lat/lng; the database
-- derives the geography.

CREATE OR REPLACE FUNCTION langgol_sync_geo_from_latlng()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geo := ST_SetSRID(
      ST_MakePoint(NEW.longitude::float8, NEW.latitude::float8), 4326
    )::geography;
  ELSE
    NEW.geo := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER addresses_sync_geo
  BEFORE INSERT OR UPDATE OF latitude, longitude ON "addresses"
  FOR EACH ROW EXECUTE FUNCTION langgol_sync_geo_from_latlng();

CREATE OR REPLACE FUNCTION langgol_sync_geo_from_centroid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.centroid_lat IS NOT NULL AND NEW.centroid_lng IS NOT NULL THEN
    NEW.geo := ST_SetSRID(
      ST_MakePoint(NEW.centroid_lng::float8, NEW.centroid_lat::float8), 4326
    )::geography;
  ELSE
    NEW.geo := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER admin_areas_sync_geo
  BEFORE INSERT OR UPDATE OF centroid_lat, centroid_lng ON "admin_areas"
  FOR EACH ROW EXECUTE FUNCTION langgol_sync_geo_from_centroid();

CREATE INDEX addresses_geo_gix ON "addresses" USING GIST ("geo");
CREATE INDEX admin_areas_geo_gix ON "admin_areas" USING GIST ("geo");

-- Coordinates must actually be coordinates, and must be plausibly on Earth.
ALTER TABLE "addresses" ADD CONSTRAINT addresses_coordinates_valid CHECK (
  (latitude IS NULL AND longitude IS NULL)
  OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);

ALTER TABLE "admin_areas" ADD CONSTRAINT admin_areas_centroid_valid CHECK (
  (centroid_lat IS NULL AND centroid_lng IS NULL)
  OR (centroid_lat BETWEEN -90 AND 90 AND centroid_lng BETWEEN -180 AND 180)
);

-- An area cannot be its own parent.
ALTER TABLE "admin_areas" ADD CONSTRAINT admin_areas_not_self_parent CHECK (parent_id IS DISTINCT FROM id);

-- ===========================================================================
-- 2. Identity and contact integrity
-- ===========================================================================

-- Phone numbers are stored normalised to E.164 for Bangladesh. Storing "01712-345678" and
-- "+8801712345678" as different users is how one person becomes two accounts and a duplicate
-- payout. docs/08_BANGLADESH_CONTEXT.md §4
ALTER TABLE "users" ADD CONSTRAINT users_phone_e164_bd CHECK (phone ~ '^\+8801[3-9][0-9]{8}$');

ALTER TABLE "addresses" ADD CONSTRAINT addresses_recipient_phone_e164_bd
  CHECK (recipient_phone ~ '^\+8801[3-9][0-9]{8}$');

-- Exactly one default address per user, ignoring soft-deleted rows.
CREATE UNIQUE INDEX addresses_one_default_per_user
  ON "addresses" (user_id) WHERE is_default AND deleted_at IS NULL;

-- ===========================================================================
-- 3. OTP and session safety
-- ===========================================================================

ALTER TABLE "otp_challenges" ADD CONSTRAINT otp_attempts_sane CHECK (
  attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts
);

ALTER TABLE "otp_challenges" ADD CONSTRAINT otp_expiry_after_creation CHECK (expires_at > created_at);

-- A stored OTP must be a hash, never the code itself. Six digits can never produce a 32+ char
-- hash, so this constraint makes "we accidentally stored the plaintext OTP" impossible rather
-- than merely forbidden. docs/07_SECURITY.md §3.1
ALTER TABLE "otp_challenges" ADD CONSTRAINT otp_code_is_hashed CHECK (length(code_hash) >= 32);

ALTER TABLE "sessions" ADD CONSTRAINT sessions_token_is_hashed CHECK (length(token_hash) >= 32);
ALTER TABLE "sessions" ADD CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at);

-- ===========================================================================
-- 4. Append-only records
-- ===========================================================================
--
-- The audit log is the instrument used to reconstruct an incident. If it can be edited, it
-- cannot be trusted, and the one time it matters is the one time someone had a reason to edit
-- it. Enforced in the database so it holds for every connection, not merely for our code.

CREATE RULE audit_logs_no_update AS ON UPDATE TO "audit_logs" DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_delete AS ON DELETE TO "audit_logs" DO INSTEAD NOTHING;

-- ===========================================================================
-- 5. Platform configuration integrity
-- ===========================================================================

ALTER TABLE "platform_configs" ADD CONSTRAINT platform_config_version_positive CHECK (version >= 1);

-- Configuration is versioned history. A published version is never edited in place, because
-- every order records the version it was priced under and that record must stay truthful.
-- docs/03_ARCHITECTURE.md §7
CREATE RULE platform_configs_no_update AS ON UPDATE TO "platform_configs" DO INSTEAD NOTHING;
CREATE RULE platform_configs_no_delete AS ON DELETE TO "platform_configs" DO INSTEAD NOTHING;

-- ===========================================================================
-- 6. Delivery machinery
-- ===========================================================================

ALTER TABLE "notifications" ADD CONSTRAINT notifications_attempts_nonneg CHECK (attempts >= 0);
ALTER TABLE "outbox_events" ADD CONSTRAINT outbox_attempts_nonneg CHECK (attempts >= 0);

-- Dispatcher hot path: unprocessed events that are due.
CREATE INDEX outbox_events_pending ON "outbox_events" (available_at) WHERE processed_at IS NULL;

ALTER TABLE "idempotency_records" ADD CONSTRAINT idempotency_expiry_after_creation
  CHECK (expires_at > created_at);
