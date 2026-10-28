-- Groups and when people can play (docs/design/groups.md,
-- docs/design/availability.md). A person is the lower-cased email from the
-- gateway's note; there is no account row beyond people.

-- Everyone who has opened the app, and the name the others see. A row is
-- written on the first /api/v1/me; it is what makes an open group visible
-- to someone outside it.
CREATE TABLE people (
    email      text        PRIMARY KEY CHECK (email = lower(email)),
    name       text        CHECK (name IS NULL OR length(name) BETWEEN 1 AND 40),
    first_seen timestamptz NOT NULL DEFAULT now()
);

-- A group of people who play together. private: invitation only, unseen
-- from outside; on_request: seen, a member lets someone in; open: anyone in
-- the app may join.
CREATE TABLE groups (
    id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
    kind       text        NOT NULL CHECK (kind IN ('private', 'on_request', 'open')),
    created_by text        NOT NULL CHECK (created_by = lower(created_by)),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
    group_id  bigint      NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    email     text        NOT NULL CHECK (email = lower(email)),
    role      text        NOT NULL CHECK (role IN ('admin', 'member')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, email)
);
CREATE INDEX memberships_email_idx ON memberships (email);

-- An invitation into a group that is not answered yet. The platform service
-- holds the same invitation under the ref group-<id>, which keeps the
-- person in the sign-in group padel while it or their membership stands.
CREATE TABLE group_invitations (
    group_id   bigint      NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    email      text        NOT NULL CHECK (email = lower(email)),
    invited_by text        NOT NULL CHECK (invited_by = lower(invited_by)),
    invited_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, email)
);
CREATE INDEX group_invitations_email_idx ON group_invitations (email);
CREATE INDEX group_invitations_by_idx ON group_invitations (invited_by, invited_at);

-- Someone asking into a group that is open on request.
CREATE TABLE join_requests (
    group_id bigint      NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    email    text        NOT NULL CHECK (email = lower(email)),
    asked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, email)
);

-- Who may see a group, and why: a member, someone invited into it, or
-- anyone in the app when it is not private. Every read of a group joins
-- this (standards/architecture/slices.md).
CREATE VIEW group_visibility AS
    SELECT group_id, email AS viewer, 'member' AS how FROM memberships
    UNION ALL
    SELECT i.group_id, i.email, 'invited' FROM group_invitations i
     WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.group_id = i.group_id AND m.email = i.email)
    UNION ALL
    SELECT g.id, p.email, 'listed' FROM groups g CROSS JOIN people p
     WHERE g.kind <> 'private'
       AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.group_id = g.id AND m.email = p.email)
       AND NOT EXISTS (SELECT 1 FROM group_invitations i WHERE i.group_id = g.id AND i.email = p.email);

-- When someone can play: spans on calendar days, in minutes after midnight
-- in Vienna on a 30-minute grid from 6:00 to 24:00. A day's spans never
-- overlap or touch; the service merges them before it writes.
CREATE TABLE availability_spans (
    email    text     NOT NULL CHECK (email = lower(email)),
    day      date     NOT NULL,
    from_min smallint NOT NULL CHECK (from_min >= 360 AND from_min % 30 = 0),
    to_min   smallint NOT NULL CHECK (to_min <= 1440 AND to_min % 30 = 0 AND to_min > from_min),
    PRIMARY KEY (email, day, from_min)
);
CREATE INDEX availability_spans_day_idx ON availability_spans (day);

-- "Wie meistens": the spans a person usually has on a weekday (1 Monday ..
-- 7 Sunday), offered for days with nothing entered yet.
CREATE TABLE availability_templates (
    email    text     NOT NULL CHECK (email = lower(email)),
    weekday  smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    from_min smallint NOT NULL CHECK (from_min >= 360 AND from_min % 30 = 0),
    to_min   smallint NOT NULL CHECK (to_min <= 1440 AND to_min % 30 = 0 AND to_min > from_min),
    PRIMARY KEY (email, weekday, from_min)
);

-- The venues a person drives to (ids from venues.json). None chosen means
-- every venue.
CREATE TABLE venue_choices (
    email    text NOT NULL CHECK (email = lower(email)),
    venue_id text NOT NULL,
    PRIMARY KEY (email, venue_id)
);
