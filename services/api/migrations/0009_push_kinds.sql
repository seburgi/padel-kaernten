-- Kinds of Mitteilungen someone turned off (docs/design/notify.md); a
-- person with no row hears of every kind.
CREATE TABLE push_off (
    email text NOT NULL CHECK (email = lower(email)),
    kind  text NOT NULL,
    PRIMARY KEY (email, kind)
);

-- Who already had their one message of the day that is not about a game
-- of their own (Seb, 2026-11-04), by Vienna's day. Reaped after two days.
CREATE TABLE push_daily (
    email text NOT NULL CHECK (email = lower(email)),
    day   date NOT NULL,
    PRIMARY KEY (email, day)
);
CREATE INDEX push_daily_day_idx ON push_daily (day);
