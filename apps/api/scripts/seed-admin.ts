import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { hashPassword } from '../src/auth/password';

config({ path: resolve(__dirname, '../../../.env') });

async function seedAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) in .env');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
