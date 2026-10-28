-- Games (docs/design/games.md): a fit proposed in a group, the people who
-- said yes, and whether it is booked. Played games stay, for the ratings
-- that follow; the nightly /reap leaves them alone.

-- A proposed game at one court of one venue. The venue's name is kept as
-- it was, so a game still reads after venues.json changes. state is
-- proposed, booked or cancelled; full is four players in, not a state.
CREATE TABLE games (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id    bigint      NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    venue_id    text        NOT NULL,
    venue_name  text        NOT NULL,
    court       text        NOT NULL,
    day         date        NOT NULL,
    start_min   smallint    NOT NULL CHECK (start_min >= 0 AND start_min < 1440),
    minutes     smallint    NOT NULL CHECK (minutes IN (60, 90, 120)),
    players     smallint    NOT NULL DEFAULT 4 CHECK (players BETWEEN 2 AND 8),
    price_cents integer     CHECK (price_cents IS NULL OR price_cents >= 0),
    state       text        NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'booked', 'cancelled')),
    proposed_by text        NOT NULL CHECK (proposed_by = lower(proposed_by)),
    created_at  timestamptz NOT NULL DEFAULT now(),
    booked_at   timestamptz
);
CREATE INDEX games_group_day_idx ON games (group_id, day);

-- Who answered: in (playing), reserve (said yes when it was full) or out.
-- The order of answers decides who moves up when someone drops out.
CREATE TABLE game_players (
    game_id     bigint      NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    email       text        NOT NULL CHECK (email = lower(email)),
    state       text        NOT NULL CHECK (state IN ('in', 'reserve', 'out')),
    answered_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (game_id, email)
);

-- Who may see a game: the members of its group. Every read joins this.
CREATE VIEW game_visibility AS
    SELECT g.id AS game_id, m.email AS viewer FROM games g JOIN memberships m ON m.group_id = g.group_id;
