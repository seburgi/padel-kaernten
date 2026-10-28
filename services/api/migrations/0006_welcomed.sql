-- Who has seen the welcome (docs/design/help.md). NULL until they tap
-- through /welcome; everyone already in the app has found their way and
-- is not welcomed again.
ALTER TABLE people ADD COLUMN welcomed_at timestamptz;
UPDATE people SET welcomed_at = now();
