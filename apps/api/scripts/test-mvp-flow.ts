import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { hashPassword } from '../src/auth/password';
import 'reflect-metadata';

const { AppModule } = require('../dist/app.module') as typeof import('../src/app.module');

config({ path: resolve(__dirname, '../../../.env') });

async function main() {
  const baseConnectionString = process.env.DATABASE_URL;
  if (!baseConnectionString) throw new Error('DATABASE_URL is required');
  const schema = 'datsan_smoke_' + randomBytes(8).toString('hex');
  const adminPool = new Pool({ connectionString: baseConnectionString });
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;

  try {
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const setup = await adminPool.connect();
    try {
      await setup.query(`SET search_path TO ${schema}, public`);
      const migrationDirectory = resolve(__dirname, '../database/migrations');
      for (const file of (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort()) {
        await setup.query(await readFile(resolve(migrationDirectory, file), 'utf8'));
      }
      const adminPassword = 'smoke-' + randomBytes(18).toString('hex');
      await setup.query(
        "INSERT INTO user_accounts (email, full_name, platform_role, password_hash) " +
        "VALUES ('smoke-admin@example.invalid', 'Smoke Admin', 'platform_admin', $1)",
        [await hashPassword(adminPassword)],
      );

      const isolatedUrl = new URL(baseConnectionString);
      isolatedUrl.searchParams.set('options', `-csearch_path=${schema},public`);
      process.env.DATABASE_URL = isolatedUrl.toString();
      process.env.JWT_SECRET = randomBytes(48).toString('hex');
      delete process.env.SMTP_HOST;
      const isolatedPool = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        const searchPath = await isolatedPool.query<{ search_path: string }>('SHOW search_path');
        assert.equal(searchPath.rows[0].search_path, `${schema},public`);
      } finally {
        await isolatedPool.end();
      }

      app = await NestFactory.create(AppModule, { logger: ['error'] });
      app.setGlobalPrefix('api/v1');
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.listen(0, '127.0.0.1');
      const port = (app.getHttpServer().address() as AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}/api/v1`;

      async function request(path: string, expected: number, token?: string, method = 'GET', body?: object) {
        const response = await fetch(baseUrl + path, {
          method,
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const result = await response.json();
        assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
        return result;
      }

      const admin = await request('/auth/login', 201, undefined, 'POST', {
        email: 'smoke-admin@example.invalid', password: adminPassword,
      });
      const owner = await request('/auth/business/register', 201, undefined, 'POST', {
        email: 'smoke-owner@example.invalid', password: 'owner-secret-1234',
        fullName: 'Smoke Owner', businessName: 'Smoke Sports',
      });
      const businessId = owner.business.id as string;
      const venueBody = {
        name: 'Smoke Venue', address: '123 Smoke Street, Ho Chi Minh City',
        latitude: 10.7769, longitude: 106.7009, sportCodes: ['badminton'],
      };
      await request(`/owner/businesses/${businessId}/venues`, 403, owner.accessToken, 'POST', venueBody);
      await request(`/admin/businesses/${businessId}/review`, 200, admin.accessToken, 'PATCH', { outcome: 'approved' });

      const venue = await request(`/owner/businesses/${businessId}/venues`, 201, owner.accessToken, 'POST', venueBody);
      const venueId = venue.id as string;
      const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
      const court = await request(`/owner/businesses/${businessId}/venues/${venueId}/courts`, 201, owner.accessToken, 'POST', {
        name: 'Court 1', sportCode: 'badminton', defaultDurationMinutes: 60,
        minimumDurationMinutes: 60, maximumDurationMinutes: 120, slotIntervalMinutes: 30,
        operatingHours: [{ weekday, opensAt: '17:00', closesAt: '21:00' }],
        priceRules: [{ weekday, startsAt: '17:00', endsAt: '21:00', pricePerHour: 100000 }],
      });
      const courtId = court.id as string;
      await request(`/owner/businesses/${businessId}/venues/${venueId}/submit`, 201, owner.accessToken, 'POST');
      const hidden = await request(`/venues?date=${date}&startTime=18%3A00`, 200);
      assert.ok(!hidden.some((item: { id: string }) => item.id === venueId));
      await request(`/admin/venues/${venueId}/review`, 200, admin.accessToken, 'PATCH', { outcome: 'approved' });

      const visible = await request(`/venues?date=${date}&startTime=18%3A00&sport=badminton`, 200);
      assert.ok(visible.some((item: { id: string }) => item.id === venueId));
      const availability = await request(`/venues/${venueId}/courts/${courtId}/availability?date=${date}`, 200);
      assert.ok(availability.slots.some((item: { startTime: string }) => item.startTime === '18:00'));

      const customer = await request('/auth/customer/register', 201, undefined, 'POST', {
        email: 'smoke-customer@example.invalid', password: 'customer-secret-1234', fullName: 'Smoke Customer',
      });
      const bookingBody = {
        date, startTime: '18:00', durationMinutes: 60, paymentMethod: 'onsite',
        contactName: 'Smoke Customer', contactPhone: '0900000000',
      };
      const booking = await request(`/bookings/courts/${courtId}`, 201, customer.accessToken, 'POST', bookingBody);
      assert.equal(booking.status, 'confirmed');
      await request(`/bookings/courts/${courtId}`, 409, customer.accessToken, 'POST', bookingBody);
      const mine = await request('/bookings/mine', 200, customer.accessToken);
      assert.ok(mine.some((item: { id: string }) => item.id === booking.id));
      const ownerBookings = await request(`/owner/businesses/${businessId}/bookings?from=${date}&to=${date}`, 200, owner.accessToken);
      assert.ok(ownerBookings.some((item: { id: string }) => item.id === booking.id));
      await request(`/owner/businesses/${businessId}/bookings?from=${date}&to=${date}`, 403, customer.accessToken);

      const outbox = await setup.query<{ kind: string; recipient_email: string }>(
        'SELECT kind, recipient_email FROM notification_outbox WHERE booking_id = $1', [booking.id],
      );
      assert.deepEqual(outbox.rows.map((row) => row.kind).sort(),
        ['booking_confirmation', 'reminder_24h', 'reminder_2h']);
      assert.ok(outbox.rows.every((row) => row.recipient_email === 'smoke-customer@example.invalid'));
      await request(`/bookings/${booking.id}/cancel`, 201, customer.accessToken, 'POST');
      const reopened = await request(`/venues/${venueId}/courts/${courtId}/availability?date=${date}`, 200);
      assert.ok(reopened.slots.some((item: { startTime: string }) => item.startTime === '18:00'));

      const demo = await request(`/bookings/courts/${courtId}`, 201, customer.accessToken, 'POST', {
        ...bookingBody, paymentMethod: 'demo',
      });
      assert.equal(demo.status, 'pending_payment');
      const pendingOutbox = await setup.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM notification_outbox WHERE booking_id = $1', [demo.id],
      );
      assert.equal(pendingOutbox.rows[0].count, 0);
      const paid = await request(`/bookings/${demo.id}/demo-payment`, 201, customer.accessToken, 'POST', {
        outcome: 'succeeded',
      });
      assert.equal(paid.status, 'confirmed');
      const confirmedOutbox = await setup.query<{ kind: string }>(
        'SELECT kind FROM notification_outbox WHERE booking_id = $1', [demo.id],
      );
      assert.deepEqual(confirmedOutbox.rows.map((row) => row.kind).sort(),
        ['booking_confirmation', 'reminder_24h', 'reminder_2h']);

      const block = await request(`/owner/businesses/${businessId}/courts/${courtId}/blocks`, 201,
        owner.accessToken, 'POST', {
          startsAt: `${date}T20:00:00+07:00`, endsAt: `${date}T21:00:00+07:00`, reason: 'Maintenance',
        });
      const blocks = await request(
        `/owner/businesses/${businessId}/courts/${courtId}/blocks?from=${date}&to=${date}`, 200,
        owner.accessToken,
      );
      assert.ok(blocks.some((item: { id: string }) => item.id === block.id));
      await request(`/owner/businesses/${businessId}/blocks/${block.id}`, 200, owner.accessToken, 'DELETE');

      const secondCustomer = await request('/auth/customer/register', 201, undefined, 'POST', {
        email: 'smoke-second@example.invalid', password: 'second-secret-1234', fullName: 'Smoke Second',
      });
      assert.equal((await request('/bookings/mine', 200, secondCustomer.accessToken)).length, 0);
      const game = await request('/community/games', 201, customer.accessToken, 'POST', {
        venueId, sportCode: 'badminton', startsAt: `${date}T19:00:00+07:00`, targetPlayers: 2,
      });
      assert.equal(game.joined_players, 1);
      const joined = await request(`/community/games/${game.id}/join`, 201, secondCustomer.accessToken, 'POST');
      assert.equal(joined.status, 'full');
      await request(`/community/games/${game.id}/join`, 409, owner.accessToken, 'POST');
      const left = await request(`/community/games/${game.id}/join`, 200, secondCustomer.accessToken, 'DELETE');
      assert.equal(left.status, 'open');
      console.log('MVP API flow passed in isolated PostgreSQL schema');
    } finally {
      setup.release();
    }
  } finally {
    if (app) await app.close();
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await adminPool.end();
  }
}

void main();
