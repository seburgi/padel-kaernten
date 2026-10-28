-- Web Push (docs/design/notify.md): the addresses browsers hand out when
-- someone allows notifications, one row per browser. Only the address and
-- its keys, no content; the app sends a row again whenever it opens, so
-- seen_at says the browser is still in use, and /reap drops rows not seen
-- for 90 days. A push service answering 404 or 410 drops its row at once.
CREATE TABLE push_subscriptions (
    id         text        PRIMARY KEY,
    email      text        NOT NULL CHECK (email = lower(email)),
    endpoint   text        NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%'),
    p256dh     text        NOT NULL,
    auth       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    seen_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_email ON push_subscriptions (email);
