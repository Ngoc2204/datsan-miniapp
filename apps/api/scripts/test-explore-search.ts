import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { ExploreService } from '../src/explore/explore.service';
import { DatabaseService } from '../src/database/database.service';

config({ path: resolve(__dirname, '../../../.env') });

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    const sport = await client.query<{ id: string }>("SELECT id FROM sports WHERE code = 'badminton'");
    assert.ok(sport.rows[0], 'Run database migrations before this test');
    const business = await client.query<{ id: string }>(
      "INSERT INTO businesses (display_name, status) VALUES ('Search test', 'approved') RETURNING id",
    );
    const businessId = business.rows[0].id;
    const venue = await client.query<{ id: string }>(
      "INSERT INTO venues (business_id, name, address, latitude, longitude, status) " +
      "VALUES ($1, 'Search test venue', 'Search test address', 10, 106, 'approved') RETURNING id",
      [businessId],
    );
    const venueId = venue.rows[0].id;
    await client.query(
      'INSERT INTO venue_sports (business_id, venue_id, sport_id) VALUES ($1, $2, $3)',
      [businessId, venueId, sport.rows[0].id],
    );
    const court = await client.query<{ id: string }>(
      "INSERT INTO courts (business_id, venue_id, sport_id, name) VALUES ($1, $2, $3, 'Court 1') RETURNING id",
      [businessId, venueId, sport.rows[0].id],
    );
    const courtId = court.rows[0].id;
    await client.query(
      'INSERT INTO court_booking_rules (business_id, court_id, default_duration_minutes, minimum_duration_minutes, maximum_duration_minutes, slot_interval_minutes) ' +
      'VALUES ($1, $2, 60, 30, 120, 30)',
      [businessId, courtId],
    );
    await client.query(
      "INSERT INTO court_operating_hours (business_id, court_id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, '17:00', '21:00')",
      [businessId, courtId, weekday],
    );
    await client.query(
      "INSERT INTO price_rules (business_id, court_id, weekday, starts_at, ends_at, price_per_hour, effective_from) " +
      "VALUES ($1, $2, $3, '17:00', '19:00', 100000, $4), ($1, $2, $3, '19:00', '21:00', 120000, $4)",
      [businessId, courtId, weekday, date],
    );

    const service = new ExploreService({ query: client.query.bind(client) } as unknown as DatabaseService);
    const base = { sport: 'badminton', date, latitude: 10, longitude: 106 };
    assert.equal((await service.listVenues({ ...base, startTime: '18:30' })).length, 1);
    assert.equal((await service.listVenues({ ...base, startTime: '18:30', maxDistanceKm: 1 })).length, 1);
    assert.equal((await service.listVenues({ ...base, startTime: '18:30', maxDistanceKm: 1, latitude: 11 })).length, 0);
    assert.equal((await service.listVenues({ ...base, startTime: '16:00' })).length, 0);

    await client.query(
      "INSERT INTO bookings (business_id, court_id, source, status, start_at, end_at, quoted_total) " +
      "VALUES ($1, $2, 'staff', 'confirmed', ($3::date + time '18:00') AT TIME ZONE 'Asia/Ho_Chi_Minh', " +
      "($3::date + time '19:00') AT TIME ZONE 'Asia/Ho_Chi_Minh', 100000)",
      [businessId, courtId, date],
    );
    assert.equal((await service.listVenues({ ...base, startTime: '18:30' })).length, 0);
    assert.equal((await service.listVenues({ ...base, startTime: '19:00' })).length, 1);
    assert.equal((await service.listVenues(base)).length, 1);

    await client.query(
      "INSERT INTO court_blocks (business_id, court_id, starts_at, ends_at) " +
      "VALUES ($1, $2, ($3::date + time '19:00') AT TIME ZONE 'Asia/Ho_Chi_Minh', " +
      "($3::date + time '20:00') AT TIME ZONE 'Asia/Ho_Chi_Minh')",
      [businessId, courtId, date],
    );
    assert.equal((await service.listVenues({ ...base, startTime: '19:00' })).length, 0);
    assert.equal((await service.listVenues({ ...base, startTime: '20:00' })).length, 1);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
}

void main().then(() => console.log('Explore search integration test passed'));
