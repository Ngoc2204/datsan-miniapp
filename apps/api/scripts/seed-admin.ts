import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { hashPassword } from '../src/auth/password';

config({ path: resolve(__dirname, '../../../.env') });

async function seedAdmin(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL || 'admin@datsan247.vn').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const connectionString = process.env.DATABASE_URL;
  if (!password || password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be set to a unique password of at least 12 characters');
  }
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }
  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  const useSsl = process.env.DATABASE_SSL === 'true' || (!isLocal && !connectionString.includes('sslmode=disable'));
  const pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  try {
    const passwordHash = await hashPassword(password);
    await pool.query(
      "INSERT INTO user_accounts (email, full_name, platform_role, password_hash) " +
      "VALUES ($1, 'DatSan Admin', 'platform_admin', $2) " +
      'ON CONFLICT (lower(email)) WHERE email IS NOT NULL ' +
      "DO UPDATE SET password_hash = EXCLUDED.password_hash, platform_role = 'platform_admin', active = true",
      [email, passwordHash],
    );
    console.log('Admin account ready: ' + email);
  } finally {
    await pool.end();
  }
}

void seedAdmin();
