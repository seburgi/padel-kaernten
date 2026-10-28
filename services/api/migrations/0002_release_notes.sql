-- What's new (docs/design/whats-new.md): the notes are files in
-- release_notes/, shipped in the image. release_notes is every note the
-- API has met and when it first did, which orders a day's notes;
-- release_note_reads is what each person has read. Emails are lower-cased.
CREATE TABLE release_notes (
    slug       text        PRIMARY KEY,
    arrived_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE release_note_reads (
    email   text        NOT NULL CHECK (email = lower(email)),
    slug    text        NOT NULL REFERENCES release_notes (slug) ON DELETE CASCADE,
    read_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (email, slug)
);
