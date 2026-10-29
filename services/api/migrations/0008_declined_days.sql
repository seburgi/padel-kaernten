-- Days someone said do not suit them (docs/design/availability.md). A day
-- here has no spans; a day with neither is still open. Both mean "can't"
-- for the fits, but only an open day makes someone worth asking.
CREATE TABLE availability_declined (
    email text NOT NULL CHECK (email = lower(email)),
    day   date NOT NULL,
    PRIMARY KEY (email, day)
);
CREATE INDEX availability_declined_day_idx ON availability_declined (day);
