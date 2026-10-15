CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  recipient_email text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('booking_confirmation', 'reminder_24h', 'reminder_2h')),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, kind),
  FOREIGN KEY (booking_id, business_id)
    REFERENCES bookings (id, business_id) ON DELETE CASCADE
);

CREATE INDEX notification_outbox_ready_idx
  ON notification_outbox (scheduled_for, next_attempt_at)
  WHERE status IN ('pending', 'sending');

CREATE TABLE community_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES user_accounts(id) ON DELETE RESTRICT,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  sport_id uuid NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  target_players integer NOT NULL CHECK (target_players BETWEEN 2 AND 100),
  note text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'full', 'closed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX community_games_discovery_idx
  ON community_games (status, starts_at, venue_id);

CREATE TABLE community_game_participants (
  game_id uuid NOT NULL REFERENCES community_games(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES user_accounts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);

CREATE INDEX community_participants_user_idx
  ON community_game_participants (user_id, status);

CREATE TABLE community_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES community_games(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES user_accounts(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'dismissed')),
  reviewed_by_user_id uuid REFERENCES user_accounts(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, reporter_id)
);

CREATE INDEX community_reports_status_created_idx
  ON community_reports (status, created_at);
