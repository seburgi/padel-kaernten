-- Messages the hourly run already sent, by a key per thing it tells of
-- (docs/design/notify.md: "stale-12", "fits-3-2026-11-05"), so each
-- goes out once. Reaped after 30 days.
CREATE TABLE push_sent (
    key     text        PRIMARY KEY,
    sent_at timestamptz NOT NULL DEFAULT now()
);
