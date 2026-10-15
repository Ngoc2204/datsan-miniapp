ALTER TABLE user_accounts ADD COLUMN password_hash text;

CREATE INDEX business_memberships_user_active_idx
  ON business_memberships (user_id, active);
