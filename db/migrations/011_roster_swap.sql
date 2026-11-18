-- Rostering phase 2: WO swaps between two agents of the same caller type, location and TL.
-- Statements are separated by a line containing only "--;;" (see 010_roster.sql). Additive only.

CREATE TABLE IF NOT EXISTS roster_swap (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_email   text NOT NULL,
  partner_email     text NOT NULL,
  requester_entry   uuid NOT NULL REFERENCES roster_entry(id),   -- the requester's WO, which they give up
  partner_entry     uuid NOT NULL REFERENCES roster_entry(id),   -- the partner's WO, which the requester takes
  requester_day     date NOT NULL,                                -- snapshot of the two dates being swapped
  partner_day       date NOT NULL,
  team_key          text NOT NULL,
  agent_type        text NOT NULL,
  location          text NOT NULL,
  is_test           boolean NOT NULL DEFAULT false,
  status            text NOT NULL CHECK (status IN ('awaiting_partner','awaiting_tl','applied','declined','rejected','cancelled','expired','failed')),
  note              text CHECK (length(note) <= 300),
  partner_confirmed_at timestamptz,
  decided_by        text,
  decided_at        timestamptz,
  decision_note     text CHECK (length(decision_note) <= 300),
  fail_reason       text,
  expires_at        timestamptz NOT NULL,
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  request_id        text NOT NULL UNIQUE,
  CHECK (requester_email <> partner_email),
  CHECK (requester_day <> partner_day)
);
--;;
-- an entry is in at most one open swap as the requester's, and at most one as the partner's
CREATE UNIQUE INDEX IF NOT EXISTS roster_swap_open_req_uq ON roster_swap (requester_entry) WHERE status IN ('awaiting_partner','awaiting_tl');
--;;
CREATE UNIQUE INDEX IF NOT EXISTS roster_swap_open_par_uq ON roster_swap (partner_entry) WHERE status IN ('awaiting_partner','awaiting_tl');
--;;
CREATE INDEX IF NOT EXISTS roster_swap_team_idx ON roster_swap (team_key, status);
--;;
CREATE INDEX IF NOT EXISTS roster_swap_requester_idx ON roster_swap (requester_email, created_at DESC);
--;;
CREATE INDEX IF NOT EXISTS roster_swap_partner_idx ON roster_swap (partner_email, created_at DESC);
