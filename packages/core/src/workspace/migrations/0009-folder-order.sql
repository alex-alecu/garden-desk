ALTER TABLE folder_grants
ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE folder_grants
SET sort_order = (
  SELECT COUNT(*)
  FROM folder_grants AS earlier
  WHERE earlier.created_at < folder_grants.created_at
     OR (earlier.created_at = folder_grants.created_at AND earlier.id < folder_grants.id)
);

CREATE INDEX folder_grants_active_order
ON folder_grants(revoked_at, sort_order, created_at, id);

PRAGMA user_version = 9;
