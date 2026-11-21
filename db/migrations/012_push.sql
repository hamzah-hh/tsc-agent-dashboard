-- Web push: one row per browser or phone that turned notifications on. Additive only.
-- Statements are separated by a line containing only "--;;" (see 010_roster.sql).

CREATE TABLE IF NOT EXISTS push_subscription (
  id           bigserial PRIMARY KEY,
  endpoint     text NOT NULL UNIQUE,                 -- the push service address of this device
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  login_email  text NOT NULL,                        -- who turned it on
  keys         text[] NOT NULL DEFAULT '{}',         -- the inbox keys this person receives (as in app_notification.recipient)
  user_agent   text,
  failed_count int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
--;;
CREATE INDEX IF NOT EXISTS push_subscription_keys_idx ON push_subscription USING gin (keys);
--;;
-- A notification is pushed once: the sender claims it by setting this
ALTER TABLE app_notification ADD COLUMN IF NOT EXISTS pushed_at timestamptz;
--;;
UPDATE app_notification SET pushed_at = now() WHERE pushed_at IS NULL;
