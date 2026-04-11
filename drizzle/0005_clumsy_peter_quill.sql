-- Chain repair for a previously missing migration file.
-- The corresponding snapshot drift did not represent a durable schema change
-- in the current repo state, so this migration is intentionally a no-op.
SELECT 1;
