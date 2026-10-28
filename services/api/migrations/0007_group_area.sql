-- Where a group plays (docs/design/groups.md): alle, or only halle or only
-- freiluft. The fits leave the other courts out; überdacht counts as halle.
ALTER TABLE groups ADD COLUMN area text NOT NULL DEFAULT 'alle'
    CHECK (area IN ('alle', 'halle', 'freiluft'));
