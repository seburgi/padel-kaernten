-- The latest free slots the booking sites showed (docs/design/slots.md).
-- One row: each refresh replaces it, nothing older is kept. Only free
-- slots, never bookings or names.
CREATE TABLE snapshot (
    id       smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    data     json        NOT NULL, -- kept as written, served as is
    taken_at timestamptz NOT NULL
);

-- The people Seb invited (docs/design/invitations.md). The platform
-- service holds the same list as invitations of padel; this one is what
-- the app shows. Emails are lower-cased.
CREATE TABLE invitations (
    email      text        PRIMARY KEY CHECK (email = lower(email)),
    invited_by text        NOT NULL,
    invited_at timestamptz NOT NULL DEFAULT now()
);

-- A write the browser sends again with the same Idempotency-Key is done
-- once (standards/api/idempotency.md, internal/platform/idempotency): the
-- key is claimed in the write's own transaction. Keys older than 7 days
-- are deleted at start-up.
CREATE TABLE idempotency_keys (
    key          uuid PRIMARY KEY,
    owner_uid    text NOT NULL,
    operation    text NOT NULL,
    request_hash bytea NOT NULL,
    resource_id  text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
