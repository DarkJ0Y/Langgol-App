-- Extensions must exist before any table that uses their types.
--
-- PostGIS: radius search over listings and delivery addresses runs through ST_DWithin against a
-- GIST index. Haversine in SQL cannot use an index and degenerates to a full scan; the migration
-- cost later is far higher than enabling this now. docs/02_DATABASE.md §4
CREATE EXTENSION IF NOT EXISTS postgis;

-- gen_random_uuid() for primary keys.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
