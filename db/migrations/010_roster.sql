-- Rostering (weekly offs and planned leave): limits, entries, audit trail and the in-app inbox.
-- Statements are separated by a line containing only "--;;" so the runner can send them one at a time
-- (the Neon HTTP driver cannot run a multi-statement script with parameters).
-- Additive only: nothing here touches doc_store or any existing table.

CREATE TABLE IF NOT EXISTS roster_limit (
  id            bigserial PRIMARY KEY,
  team_key      text NOT NULL,                 -- the TL's official email (else personal, else 'loc:<location>')
  day           date,                          -- NULL = every day
  max_inactive  int  NOT NULL CHECK (max_inactive BETWEEN 0 AND 200),
  note          text CHECK (length(note) <= 200),
  set_by        text NOT NULL,
  set_at        timestamptz NOT NULL DEFAULT now()
);
--;;
CREATE UNIQUE INDEX IF NOT EXISTS roster_limit_default_uq ON roster_limit (team_key) WHERE day IS NULL;
--;;
CREATE UNIQUE INDEX IF NOT EXISTS roster_limit_day_uq ON roster_limit (team_key, day) WHERE day IS NOT NULL;
--;;
-- One row per agent per day off (WO or PL), whatever its status
CREATE TABLE IF NOT EXISTS roster_entry (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_email      text NOT NULL,              -- official email, lower-case
  day              date NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('WO','PL')),
  status           text NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled','expired','revoked')),
  needs_approval   boolean NOT NULL,
  team_key         text NOT NULL,              -- snapshot at creation
  agent_type       text NOT NULL,
  location         text NOT NULL,
  source           text NOT NULL CHECK (source IN ('self','tl','manager','swap')),
  swap_id          uuid,
  reason           text CHECK (length(reason) <= 300),
  over_limit       boolean NOT NULL DEFAULT false,
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_by       text,
  decided_at       timestamptz,
  decision_note    text CHECK (length(decision_note) <= 300),
  request_id       text NOT NULL UNIQUE,       -- idempotency key from the client
  is_test          boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
--;;
-- an agent holds at most one active entry per day
CREATE UNIQUE INDEX IF NOT EXISTS roster_entry_active_uq ON roster_entry (agent_email, day) WHERE status IN ('pending','approved');
--;;
CREATE INDEX IF NOT EXISTS roster_entry_team_day_idx ON roster_entry (team_key, day);
--;;
CREATE INDEX IF NOT EXISTS roster_entry_agent_day_idx ON roster_entry (agent_email, day DESC);
--;;
CREATE INDEX IF NOT EXISTS roster_entry_pending_idx ON roster_entry (team_key, created_at) WHERE status = 'pending';
--;;
-- Append-only history of every action
CREATE TABLE IF NOT EXISTS roster_audit (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor        text NOT NULL,
  actor_role   text NOT NULL,
  action       text NOT NULL,                  -- book, cancel, approve, reject, revoke, limit_set, limit_clear
  entry_id     uuid,
  agent_email  text,
  team_key     text,
  day          date,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  note         text
);
--;;
CREATE INDEX IF NOT EXISTS roster_audit_team_idx ON roster_audit (team_key, at DESC);
--;;
CREATE INDEX IF NOT EXISTS roster_audit_agent_idx ON roster_audit (agent_email, at DESC);
--;;
-- In-app inbox (mail is a later phase and will be driven from here)
CREATE TABLE IF NOT EXISTS app_notification (
  id          bigserial PRIMARY KEY,
  recipient   text NOT NULL,                   -- an agent's official email, or a TL's team key
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text,
  entry_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
--;;
CREATE INDEX IF NOT EXISTS app_notification_recipient_idx ON app_notification (recipient, created_at DESC);
