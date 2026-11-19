-- Changing a game afterwards (docs/design/games.md, Seb 2026-11-18): whoever
-- proposed it moves it, takes someone out or cancels it with a reason.

-- asked: was in, the game moved to another time or venue, and their new
-- answer is still missing. It holds a place but does not count as in.
ALTER TABLE game_players DROP CONSTRAINT game_players_state_check;
ALTER TABLE game_players ADD CONSTRAINT game_players_state_check
    CHECK (state IN ('in', 'asked', 'reserve', 'out'));

-- The last change only, so the game can say "Vorher: …"; no history.
ALTER TABLE games
    ADD COLUMN changed_at        timestamptz,
    ADD COLUMN change_note       text CHECK (change_note IS NULL OR char_length(change_note) <= 140),
    ADD COLUMN before_day        date,
    ADD COLUMN before_start      smallint,
    ADD COLUMN before_minutes    smallint,
    ADD COLUMN before_venue_name text,
    ADD COLUMN before_court      text,
    ADD COLUMN cancel_note       text CHECK (cancel_note IS NULL OR char_length(cancel_note) <= 140);
