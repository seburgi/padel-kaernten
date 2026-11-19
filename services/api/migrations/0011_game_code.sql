-- The access code of a booked game (Seb, 2026-11-19; docs/design/games.md):
-- some venues, like Padel Ten, give one to type in at the door. Whoever
-- proposed the game enters it when booking or later; only those playing,
-- the reserves and the proposer see it. NULL when there is none.
ALTER TABLE games ADD COLUMN code text CHECK (code IS NULL OR char_length(code) BETWEEN 1 AND 40);
