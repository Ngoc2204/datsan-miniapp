import { config } from 'dotenv';
import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../.env') });

async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString });
  const migrationDirectory = resolve(__dirname, '../database/migrations');

  try {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );

    const files = (await readdir(migrationDirectory))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    for (const name of files) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const alreadyApplied = await client.query(
          'SELECT 1 FROM schema_migrations WHERE name = $1',
          [name],
        );

        if (alreadyApplied.rows.length > 0) {
          await client.query('COMMIT');
          console.log('Already applied:', name);
          continue;
        }

        const sql = await readFile(resolve(migrationDirectory, name), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
          name,
        ]);
        await client.query('COMMIT');
        console.log('Applied:', name);
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original migration error.
        }
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

runMigrations().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
