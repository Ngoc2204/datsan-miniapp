CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE user_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zalo_user_id text UNIQUE,
  email text,
  phone text,
  full_name text,
  platform_role text NOT NULL DEFAULT 'customer'
    CHECK (platform_role IN ('customer', 'platform_admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_accounts_email_lower_uq
  ON user_accounts (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected', 'suspended')),
  review_reason text,
  reviewed_by_user_id uuid REFERENCES user_accounts(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  membership_role text NOT NULL
    CHECK (membership_role IN ('owner', 'manager', 'staff')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, user_id)
);

CREATE TABLE sports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_-]+$'),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sports (code, name)
VALUES
  ('badminton', 'Cầu lông'),
  ('football', 'Bóng đá'),
  ('pickleball', 'Pickleball'),
  ('tennis', 'Tennis')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL,
  latitude numeric(9, 6) CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) CHECK (longitude BETWEEN -180 AND 180),
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  description text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended')),
  review_reason text,
  reviewed_by_user_id uuid REFERENCES user_accounts(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);

CREATE INDEX venues_business_status_idx
  ON venues (business_id, status);

CREATE TABLE venue_sports (
  business_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  sport_id uuid NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, venue_id, sport_id),
  FOREIGN KEY (venue_id, business_id)
    REFERENCES venues (id, business_id) ON DELETE CASCADE
);

CREATE TABLE venue_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  media_url text NOT NULL,
  alt_text text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (venue_id, business_id)
    REFERENCES venues (id, business_id) ON DELETE CASCADE
);

CREATE TABLE venue_cancellation_policies (
  business_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(rules) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, venue_id),
  FOREIGN KEY (venue_id, business_id)
    REFERENCES venues (id, business_id) ON DELETE CASCADE
);

CREATE TABLE venue_staff (
  business_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  user_id uuid NOT NULL,
  venue_role text NOT NULL DEFAULT 'staff'
    CHECK (venue_role IN ('manager', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, user_id),
  FOREIGN KEY (venue_id, business_id)
    REFERENCES venues (id, business_id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, user_id)
    REFERENCES business_memberships (business_id, user_id) ON DELETE CASCADE
);

CREATE TABLE courts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  venue_id uuid NOT NULL,
  sport_id uuid NOT NULL,
  name text NOT NULL,
  court_type text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id),
  FOREIGN KEY (business_id, venue_id, sport_id)
    REFERENCES venue_sports (business_id, venue_id, sport_id) ON DELETE CASCADE
);

CREATE INDEX courts_venue_active_idx
  ON courts (business_id, venue_id, active);

CREATE TABLE court_booking_rules (
  business_id uuid NOT NULL,
  court_id uuid NOT NULL,
  default_duration_minutes integer NOT NULL CHECK (default_duration_minutes > 0),
  minimum_duration_minutes integer NOT NULL CHECK (minimum_duration_minutes > 0),
  maximum_duration_minutes integer NOT NULL CHECK (maximum_duration_minutes >= minimum_duration_minutes),
  slot_interval_minutes integer NOT NULL CHECK (slot_interval_minutes > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, court_id),
  CHECK (default_duration_minutes BETWEEN minimum_duration_minutes AND maximum_duration_minutes),
  FOREIGN KEY (court_id, business_id)
    REFERENCES courts (id, business_id) ON DELETE CASCADE
);

CREATE TABLE court_operating_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  court_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at < closes_at),
  UNIQUE (business_id, court_id, weekday, opens_at),
  FOREIGN KEY (court_id, business_id)
    REFERENCES courts (id, business_id) ON DELETE CASCADE
);

CREATE TABLE price_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  court_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  price_per_hour bigint NOT NULL CHECK (price_per_hour >= 0),
  currency char(3) NOT NULL DEFAULT 'VND',
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (court_id, business_id)
    REFERENCES courts (id, business_id) ON DELETE CASCADE
);

CREATE INDEX price_rules_lookup_idx
  ON price_rules (business_id, court_id, weekday, active);

CREATE TABLE court_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  court_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  source text NOT NULL DEFAULT 'maintenance'
    CHECK (source IN ('maintenance', 'event', 'external_booking')),
  created_by_user_id uuid REFERENCES user_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at),
  FOREIGN KEY (court_id, business_id)
    REFERENCES courts (id, business_id) ON DELETE CASCADE
);

CREATE INDEX court_blocks_lookup_idx
  ON court_blocks (business_id, court_id, starts_at, ends_at);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  court_id uuid NOT NULL,
  customer_id uuid REFERENCES user_accounts(id) ON DELETE RESTRICT,
  source text NOT NULL DEFAULT 'mini_app'
    CHECK (source IN ('mini_app', 'staff')),
  status text NOT NULL
    CHECK (status IN ('pending_payment', 'confirmed', 'cancelled', 'completed', 'expired')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  hold_expires_at timestamptz,
  quoted_total bigint NOT NULL CHECK (quoted_total >= 0),
  currency char(3) NOT NULL DEFAULT 'VND',
  contact_name text,
  contact_phone text,
  contact_email text,
  cancellation_policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES user_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_at < end_at),
  CHECK (status <> 'pending_payment' OR hold_expires_at IS NOT NULL),
  CHECK (source <> 'mini_app' OR customer_id IS NOT NULL),
  UNIQUE (id, business_id),
  FOREIGN KEY (court_id, business_id)
    REFERENCES courts (id, business_id) ON DELETE RESTRICT,
  CONSTRAINT bookings_no_active_overlap
    EXCLUDE USING gist (
      court_id WITH =,
      tstzrange(start_at, end_at, '[)') WITH &&
    )
    WHERE (status IN ('pending_payment', 'confirmed'))
);

CREATE INDEX bookings_business_start_status_idx
  ON bookings (business_id, start_at, status);

CREATE INDEX bookings_customer_start_idx
  ON bookings (customer_id, start_at DESC);

CREATE TABLE booking_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('onsite', 'demo')),
  status text NOT NULL
    CHECK (status IN ('unpaid', 'pending', 'succeeded', 'failed', 'refunded')),
  amount bigint NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'VND',
  provider_reference text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (booking_id, business_id)
    REFERENCES bookings (id, business_id) ON DELETE CASCADE
);

CREATE INDEX booking_payments_booking_idx
  ON booking_payments (business_id, booking_id, created_at DESC);

CREATE TABLE booking_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_user_id uuid REFERENCES user_accounts(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (booking_id, business_id)
    REFERENCES bookings (id, business_id) ON DELETE CASCADE
);

CREATE TABLE admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES user_accounts(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_log_created_idx
  ON admin_audit_log (created_at DESC);
