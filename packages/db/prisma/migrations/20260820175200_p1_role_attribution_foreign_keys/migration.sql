-- Referential integrity for role-grant attribution.
--
-- `granted_by_id` and `revoked_by_id` answer "who did this, and who undid it?". Until now they
-- were bare UUID columns: nothing stopped a value that points at no user at all, and an audit
-- trail that can point nowhere is not an audit trail.
--
-- ON DELETE RESTRICT, deliberately, and NOT the CASCADE used for `user_id`:
--
--   * CASCADE is right for `user_id` — deleting a user should take their own role rows with them.
--   * CASCADE would be catastrophic here. Deleting an administrator would silently delete every
--     grant and revocation they ever performed, erasing the record of who gave whom what.
--   * SET NULL would violate `role_revocation_attributed`, which requires `revoked_by_id` to be
--     present whenever `revoked_at` is — a revocation must stay attributed, so the FK cannot be
--     allowed to blank it.
--
-- RESTRICT therefore means: an account that has granted or revoked a role cannot be hard-deleted
-- while that history stands. That is the intended answer. Ordinary account closure is the soft
-- delete (`users.deleted_at`), which this does not touch.
--
-- The supporting indexes are not optional. Postgres has to scan the referencing table on every
-- delete of a user to enforce RESTRICT, and without them that is a sequential scan of every role
-- assignment on the platform.

CREATE INDEX IF NOT EXISTS "user_role_assignments_granted_by_id_idx"
  ON "user_role_assignments" ("granted_by_id");

CREATE INDEX IF NOT EXISTS "user_role_assignments_revoked_by_id_idx"
  ON "user_role_assignments" ("revoked_by_id");

ALTER TABLE "user_role_assignments"
  ADD CONSTRAINT "user_role_assignments_granted_by_id_fkey"
  FOREIGN KEY ("granted_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_role_assignments"
  ADD CONSTRAINT "user_role_assignments_revoked_by_id_fkey"
  FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
