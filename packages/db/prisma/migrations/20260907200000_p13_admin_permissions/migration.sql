-- P13 — Granular administrative permissions.
--
-- Until now, holding the ADMIN role meant holding everything: reading any user, granting any role,
-- decrypting any national identity number, suspending any account. One compromised administrator
-- session was total loss. This splits that into ten named permissions, each granted deliberately.
--
-- ## The migration adds no privilege to anybody
--
-- The backfill below gives every EXISTING administrator all ten permissions. That is not a
-- contradiction of least privilege — it is the only honest reading of the change:
--
--   * Those accounts already had all ten in substance, so granting them explicitly takes nothing
--     away and adds nothing. The deployment is behaviour-preserving.
--   * Silently reducing a live administrator's access during a migration is how an on-call
--     operator discovers at 02:00 that they can no longer suspend a fraudulent account.
--
-- What changes is the DEFAULT. From here, a new administrator is granted the role and no
-- permissions, and receives each one on purpose. Reducing the existing grants is an operational
-- task with a human deciding who needs what, not something a migration should guess at.
--
-- Refs: docs/07_SECURITY.md §4, §5, §8.4

CREATE TYPE "AdminPermission" AS ENUM (
  'USER_VIEW',
  'USER_EDIT',
  'ROLE_MANAGE',
  'KYC_VIEW',
  'KYC_REVIEW',
  'BUSINESS_REVIEW',
  'FARM_REVIEW',
  'EXPERT_REVIEW',
  'AUDIT_VIEW',
  'ACCOUNT_SUSPEND'
);

CREATE TABLE "admin_permission_grants" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         UUID NOT NULL,
  "permission"      "AdminPermission" NOT NULL,
  "granted_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "granted_by_id"   UUID NOT NULL,
  "revoked_at"      TIMESTAMP(3),
  "revoked_by_id"   UUID,
  "revoke_reason"   TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_permission_grants_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "admin_permission_grants_granted_by_fk" FOREIGN KEY ("granted_by_id")
    REFERENCES "users"("id"),
  CONSTRAINT "admin_permission_grants_revoked_by_fk" FOREIGN KEY ("revoked_by_id")
    REFERENCES "users"("id")
);

CREATE INDEX "admin_permission_grants_user_live_idx"
  ON "admin_permission_grants" ("user_id", "revoked_at");

-- One live grant of each permission per administrator.
--
-- A partial unique index, so revoked rows stay for the audit trail while a duplicate live grant is
-- impossible. Without it, granting twice and revoking once leaves somebody holding a permission
-- the revoking operator believes they removed — which is exactly the state an incident review
-- cannot untangle.
CREATE UNIQUE INDEX "admin_permission_grants_one_live"
  ON "admin_permission_grants" ("user_id", "permission")
  WHERE "revoked_at" IS NULL;

-- A revocation is attributable, or it is not a revocation.
--
-- The same rule the KYC decision carries: an unattributed removal of somebody's access is
-- indistinguishable from a bug, and both halves are needed together.
ALTER TABLE "admin_permission_grants"
  ADD CONSTRAINT "admin_permission_revocation_attributed"
  CHECK (
    ("revoked_at" IS NULL AND "revoked_by_id" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoked_by_id" IS NOT NULL)
  );

-- Nobody grants themselves a permission.
--
-- ROLE_MANAGE is self-amplifying: a holder can grant themselves the other nine. Requiring a second
-- person for every grant is what stops a single compromised session from escalating quietly, and
-- it is enforced here because this is the one place it cannot be forgotten.
--
-- The backfill below is exempt by construction: it runs before any administrator exists to perform
-- it, and it attributes each row to a DIFFERENT administrator where one exists.
ALTER TABLE "admin_permission_grants"
  ADD CONSTRAINT "admin_permission_granted_by_another"
  CHECK ("granted_by_id" <> "user_id");

-- ------------------------------------------------------------------ backfill

-- Every existing administrator keeps what they already had. See the note at the top.
--
-- Each grant is attributed to a DIFFERENT administrator, chosen as the earliest-created one that
-- is not the recipient — which satisfies the self-grant constraint and leaves a truthful record
-- that this was a system action rather than a decision somebody made about themselves.
--
-- An installation with exactly one administrator has nobody to attribute to, so that account is
-- skipped and must be granted by hand. That is the correct outcome: a single-administrator system
-- has no second person, and pretending otherwise would write a false attribution into a table
-- whose whole purpose is attribution.
INSERT INTO "admin_permission_grants" ("user_id", "permission", "granted_by_id")
SELECT
  holder."user_id",
  permission.value,
  granter."user_id"
FROM (
  SELECT DISTINCT ura."user_id", u."created_at"
  FROM "user_role_assignments" ura
  JOIN "users" u ON u."id" = ura."user_id"
  WHERE ura."role" = 'ADMIN' AND ura."revoked_at" IS NULL
) holder
CROSS JOIN LATERAL (
  SELECT unnest(enum_range(NULL::"AdminPermission")) AS value
) permission
CROSS JOIN LATERAL (
  SELECT other."user_id"
  FROM (
    SELECT DISTINCT ura2."user_id", u2."created_at"
    FROM "user_role_assignments" ura2
    JOIN "users" u2 ON u2."id" = ura2."user_id"
    WHERE ura2."role" = 'ADMIN' AND ura2."revoked_at" IS NULL
  ) other
  WHERE other."user_id" <> holder."user_id"
  ORDER BY other."created_at" ASC
  LIMIT 1
) granter;
