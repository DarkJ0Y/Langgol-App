-- P15 — Row Level Security as a deny-all backstop.
--
-- ADR-06 decided this at the start and it was never applied: Langgol authorizes in the application
-- layer, through Prisma connecting as the table owner, and RLS stays ENABLED with no policies so
-- that nothing else can read the data. docs/03_ARCHITECTURE.md §6.3
--
-- On Supabase that is not theoretical. Every table in `public` is served by the project's REST
-- API, and the key that API accepts (the anon key) is public by design. With RLS off, anyone who
-- has the project URL can read and write users, sessions and identity documents directly.
--
-- What this does NOT change: the owner bypasses RLS unless it is FORCEd, and Prisma connects as
-- the owner, so the application sees exactly what it saw before. No policies are created; a
-- policy would be a second authorization model, which ADR-06 rejects.
--
-- Every later migration that creates a table must enable RLS on it too.
-- prisma/checks/verify-database-guarantees.sql fails CI on any table in `public` without it.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      -- PostGIS's own reference table, owned by the extension. Read-only coordinate system data.
      AND c.relname <> 'spatial_ref_sys'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END;
$$;

-- Supabase's API roles. They exist only on Supabase, so the block is a no-op on plain PostgreSQL
-- (CI, local development, Neon).
--
-- RLS already denies them every row. Revoking the privileges as well means a policy added by
-- mistake later still does not open a table to the public key, and the DEFAULT PRIVILEGES line
-- stops Supabase from granting them each new table as it is created.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  END IF;
END;
$$;
