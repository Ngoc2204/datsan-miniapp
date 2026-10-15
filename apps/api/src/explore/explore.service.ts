import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AvailabilityQueryDto, ExploreQueryDto } from './explore.dto';

type CourtInfo = {
  id: string;
  timezone: string;
  default_duration_minutes: number;
  minimum_duration_minutes: number;
  maximum_duration_minutes: number;
  slot_interval_minutes: number;
};

type TimeRule = { start: number; end: number; price: number };

@Injectable()
export class ExploreService {
  constructor(private readonly database: DatabaseService) {}

  async listVenues(query: ExploreQueryDto) {
    if (query.date) this.assertRealDate(query.date);
    if (query.startTime && !query.date) {
      throw new BadRequestException('Cần chọn ngày khi lọc theo giờ');
    }
    if (query.durationMinutes !== undefined && !query.date) {
      throw new BadRequestException('Cần chọn ngày khi lọc theo thời lượng');
    }
    if ((query.latitude === undefined) !== (query.longitude === undefined)) {
      throw new BadRequestException('Cần truyền cả latitude và longitude');
    }
    if (query.maxDistanceKm !== undefined && query.latitude === undefined) {
      throw new BadRequestException('Cần vị trí khi lọc theo khoảng cách');
    }
    if (query.minPrice !== undefined && query.maxPrice !== undefined && query.minPrice > query.maxPrice) {
      throw new BadRequestException('minPrice không được lớn hơn maxPrice');
    }
    const result = await this.database.query(
      `WITH matches AS (
        SELECT v.id, v.business_id, v.name, v.address, v.latitude, v.longitude,
          v.description, v.timezone, v.created_at, b.display_name AS business_name,
          array_agg(DISTINCT s.code ORDER BY s.code) AS sport_codes,
          (SELECT min(p.price_per_hour) FROM courts pc
            JOIN sports ps ON ps.id = pc.sport_id AND ps.active = true
            JOIN price_rules p ON p.business_id = pc.business_id AND p.court_id = pc.id
            WHERE pc.business_id = v.business_id AND pc.venue_id = v.id
              AND pc.active = true AND p.active = true
              AND ($1::text IS NULL OR ps.code = $1)) AS starting_price,
          (SELECT array_agg(vm.media_url ORDER BY vm.sort_order) FROM venue_media vm
            WHERE vm.business_id = v.business_id AND vm.venue_id = v.id) AS media_urls,
          CASE WHEN $5::numeric IS NULL OR v.latitude IS NULL OR v.longitude IS NULL THEN NULL
            ELSE 6371 * acos(least(1::double precision, greatest(-1::double precision,
              sin(radians($5::double precision)) * sin(radians(v.latitude::double precision)) +
              cos(radians($5::double precision)) * cos(radians(v.latitude::double precision)) *
              cos(radians(v.longitude::double precision - $6::double precision))))) END AS distance_km
        FROM venues v JOIN businesses b ON b.id = v.business_id
          JOIN venue_sports vs ON vs.business_id = v.business_id AND vs.venue_id = v.id
          JOIN sports s ON s.id = vs.sport_id AND s.active = true
        WHERE v.status = 'approved' AND b.status = 'approved'
          AND ($1::text IS NULL OR s.code = $1)
          AND ($2::text IS NULL OR v.name ILIKE $2 OR v.address ILIKE $2)
          AND EXISTS (SELECT 1 FROM courts active_court
            WHERE active_court.business_id = v.business_id
              AND active_court.venue_id = v.id AND active_court.active = true
              AND ($1::text IS NULL OR active_court.sport_id = s.id))
        GROUP BY v.id, b.display_name
      )
      SELECT m.id, m.name, m.address, m.latitude, m.longitude, m.description,
        m.timezone, m.business_name, m.sport_codes, m.starting_price,
        m.media_urls, m.distance_km
      FROM matches m
      WHERE ($3::bigint IS NULL OR m.starting_price >= $3)
        AND ($4::bigint IS NULL OR m.starting_price <= $4)
        AND ($7::double precision IS NULL OR m.distance_km <= $7)
        AND ($8::date IS NULL OR EXISTS (
          SELECT 1 FROM courts c
            JOIN sports cs ON cs.id = c.sport_id AND cs.active = true
            JOIN court_booking_rules r ON r.business_id = c.business_id AND r.court_id = c.id
            JOIN court_operating_hours h ON h.business_id = c.business_id AND h.court_id = c.id
            CROSS JOIN LATERAL generate_series(0, GREATEST(-1,
              (EXTRACT(EPOCH FROM h.closes_at)::int / 60 - EXTRACT(EPOCH FROM h.opens_at)::int / 60
                - COALESCE($10::int, r.default_duration_minutes)) / r.slot_interval_minutes)) AS step(n)
            CROSS JOIN LATERAL (SELECT
              EXTRACT(EPOCH FROM h.opens_at)::int / 60 + step.n * r.slot_interval_minutes AS start_min,
              EXTRACT(EPOCH FROM h.opens_at)::int / 60 + step.n * r.slot_interval_minutes
                + COALESCE($10::int, r.default_duration_minutes) AS end_min) slot
            CROSS JOIN LATERAL (SELECT
              ($8::date + make_interval(mins => slot.start_min)) AT TIME ZONE m.timezone AS start_at,
              ($8::date + make_interval(mins => slot.end_min)) AT TIME ZONE m.timezone AS end_at) times
          WHERE c.business_id = m.business_id AND c.venue_id = m.id AND c.active = true
            AND ($1::text IS NULL OR cs.code = $1)
            AND h.active = true AND h.weekday = EXTRACT(DOW FROM $8::date)
            AND ($10::int IS NULL OR ($10 BETWEEN r.minimum_duration_minutes AND r.maximum_duration_minutes
              AND $10 % r.slot_interval_minutes = 0))
            AND ($9::text IS NULL OR slot.start_min =
              split_part($9, ':', 1)::int * 60 + split_part($9, ':', 2)::int)
            AND times.start_at > now()
            AND COALESCE((SELECT range_agg(int4range(
              EXTRACT(EPOCH FROM p.starts_at)::int / 60,
              EXTRACT(EPOCH FROM p.ends_at)::int / 60, '[)'))
              FROM price_rules p WHERE p.business_id = c.business_id AND p.court_id = c.id
                AND p.weekday = h.weekday AND p.active = true
                AND p.effective_from <= $8::date
                AND (p.effective_to IS NULL OR p.effective_to >= $8::date)),
              '{}'::int4multirange) @> int4range(slot.start_min, slot.end_min, '[)')
            AND NOT EXISTS (SELECT 1 FROM bookings booked WHERE booked.court_id = c.id
              AND (booked.status = 'confirmed' OR
                (booked.status = 'pending_payment' AND booked.hold_expires_at > now()))
              AND tstzrange(booked.start_at, booked.end_at, '[)') &&
                tstzrange(times.start_at, times.end_at, '[)'))
            AND NOT EXISTS (SELECT 1 FROM court_blocks cb WHERE cb.court_id = c.id
              AND tstzrange(cb.starts_at, cb.ends_at, '[)') &&
                tstzrange(times.start_at, times.end_at, '[)'))
        ))
      ORDER BY m.distance_km NULLS LAST, m.created_at DESC LIMIT 100`,
      [
        query.sport ?? null,
        query.q ? '%' + query.q + '%' : null,
        query.minPrice ?? null,
        query.maxPrice ?? null,
        query.latitude ?? null,
        query.longitude ?? null,
        query.maxDistanceKm ?? null,
        query.date ?? null,
        query.startTime ?? null,
        query.durationMinutes ?? null,
      ],
    );
    return result.rows;
  }

  async getVenue(venueId: string) {
    const venueResult = await this.database.query(
      "SELECT v.id, v.name, v.address, v.latitude, v.longitude, v.description, v.timezone, v.business_id, " +
      "b.display_name AS business_name, COALESCE((SELECT json_agg(json_build_object('url', vm.media_url, 'altText', vm.alt_text) ORDER BY vm.sort_order) FROM venue_media vm " +
      "WHERE vm.business_id = v.business_id AND vm.venue_id = v.id), '[]'::json) AS media, " +
      "COALESCE((SELECT json_agg(json_build_object('code', s.code, 'name', s.name) ORDER BY s.name) " +
      "FROM venue_sports vs JOIN sports s ON s.id = vs.sport_id AND s.active = true " +
      "WHERE vs.business_id = v.business_id AND vs.venue_id = v.id), '[]'::json) AS sports " +
      "FROM venues v JOIN businesses b ON b.id = v.business_id " +
      "WHERE v.id = $1 AND v.status = 'approved' AND b.status = 'approved'",
      [venueId],
    );
    const venue = venueResult.rows[0] as Record<string, unknown> | undefined;
    if (!venue) throw new NotFoundException('Không tìm thấy địa điểm');
    const courts = await this.database.query(
      "SELECT c.id, c.name, c.court_type, s.code AS sport_code, s.name AS sport_name, " +
      "r.default_duration_minutes, r.minimum_duration_minutes, r.maximum_duration_minutes, r.slot_interval_minutes, " +
      "COALESCE((SELECT json_agg(json_build_object('weekday', h.weekday, 'opensAt', h.opens_at, 'closesAt', h.closes_at) ORDER BY h.weekday, h.opens_at) " +
      "FROM court_operating_hours h WHERE h.business_id = c.business_id AND h.court_id = c.id AND h.active = true), '[]'::json) AS operating_hours, " +
      "COALESCE((SELECT json_agg(json_build_object('weekday', p.weekday, 'startsAt', p.starts_at, 'endsAt', p.ends_at, 'pricePerHour', p.price_per_hour, 'currency', p.currency) ORDER BY p.weekday, p.starts_at) " +
      "FROM price_rules p WHERE p.business_id = c.business_id AND p.court_id = c.id AND p.active = true), '[]'::json) AS price_rules " +
      "FROM courts c JOIN sports s ON s.id = c.sport_id " +
      "LEFT JOIN court_booking_rules r ON r.business_id = c.business_id AND r.court_id = c.id " +
      "WHERE c.business_id = $1 AND c.venue_id = $2 AND c.active = true ORDER BY s.name, c.name",
      [venue.business_id, venueId],
    );
    delete venue.business_id;
    return { ...venue, courts: courts.rows };
  }

  async getAvailability(venueId: string, courtId: string, query: AvailabilityQueryDto) {
    this.assertRealDate(query.date);
    const courtResult = await this.database.query<CourtInfo>(
      'SELECT c.id, v.timezone, r.default_duration_minutes, r.minimum_duration_minutes, ' +
      'r.maximum_duration_minutes, r.slot_interval_minutes ' +
      'FROM courts c JOIN venues v ON v.business_id = c.business_id AND v.id = c.venue_id ' +
      'JOIN businesses b ON b.id = v.business_id ' +
      'JOIN court_booking_rules r ON r.business_id = c.business_id AND r.court_id = c.id ' +
      "WHERE c.id = $1 AND c.venue_id = $2 AND c.active = true AND v.status = 'approved' AND b.status = 'approved'",
      [courtId, venueId],
    );
    const court = courtResult.rows[0];
    if (!court) throw new NotFoundException('Không tìm thấy sân đang hoạt động');
    const duration = query.durationMinutes ?? court.default_duration_minutes;
    if (duration < court.minimum_duration_minutes || duration > court.maximum_duration_minutes ||
        duration % court.slot_interval_minutes !== 0) {
      throw new BadRequestException('Thời lượng không hợp lệ theo cấu hình của sân');
    }

    const date = new Date(query.date + 'T00:00:00.000Z');
    const weekday = date.getUTCDay();
    const [hoursResult, pricesResult] = await Promise.all([
      this.database.query<{ opens_at: string; closes_at: string }>(
        'SELECT opens_at::text, closes_at::text FROM court_operating_hours ' +
        'WHERE court_id = $1 AND weekday = $2 AND active = true ORDER BY opens_at',
        [courtId, weekday],
      ),
      this.database.query<{ starts_at: string; ends_at: string; price_per_hour: string }>(
        'SELECT starts_at::text, ends_at::text, price_per_hour::text FROM price_rules ' +
        'WHERE court_id = $1 AND weekday = $2 AND active = true ' +
        'AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $3::date) ORDER BY starts_at',
        [courtId, weekday, query.date],
      ),
    ]);
    const priceRules: TimeRule[] = pricesResult.rows.map((rule) => ({
      start: this.timeMinutes(rule.starts_at),
      end: this.timeMinutes(rule.ends_at),
      price: Number(rule.price_per_hour),
    }));
    const candidates: Array<{ start: string; end: string; startMinute: number; total: number }> = [];
    for (const hours of hoursResult.rows) {
      const opening = this.timeMinutes(hours.opens_at);
      const closing = this.timeMinutes(hours.closes_at);
      for (let start = opening; start + duration <= closing; start += court.slot_interval_minutes) {
        const total = this.quotePrice(start, duration, priceRules);
        if (total !== null) {
          candidates.push({
            start: this.formatTime(start),
            end: this.formatTime(start + duration),
            startMinute: start,
            total,
          });
        }
      }
    }
    if (candidates.length === 0) return { date: query.date, durationMinutes: duration, slots: [] };

    const availability = await this.database.transaction(async (client) => {
      await client.query(
        "WITH expired AS (UPDATE bookings SET status = 'expired', updated_at = now() WHERE court_id = $1 " +
        "AND status = 'pending_payment' AND hold_expires_at <= now() RETURNING business_id, id) " +
        "INSERT INTO booking_status_history (business_id, booking_id, from_status, to_status, reason) " +
        "SELECT business_id, id, 'pending_payment', 'expired', 'hold_expired' FROM expired",
        [courtId],
      );
      return client.query<{ idx: number; start_at: Date; end_at: Date }>(
        'WITH candidates AS (SELECT c.idx, ($1::date + c.start_time::time) AT TIME ZONE $2 AS start_at, ' +
        '($1::date + c.end_time::time) AT TIME ZONE $2 AS end_at FROM unnest($3::text[], $4::text[], $5::int[]) ' +
        'AS c(start_time, end_time, idx)) ' +
        'SELECT c.idx, c.start_at, c.end_at FROM candidates c WHERE c.start_at > now() ' +
        'AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.court_id = $6 ' +
        "AND (b.status = 'confirmed' OR (b.status = 'pending_payment' AND b.hold_expires_at > now())) " +
        "AND tstzrange(b.start_at, b.end_at, '[)') && tstzrange(c.start_at, c.end_at, '[)')) " +
        'AND NOT EXISTS (SELECT 1 FROM court_blocks cb WHERE cb.court_id = $6 ' +
        "AND tstzrange(cb.starts_at, cb.ends_at, '[)') && tstzrange(c.start_at, c.end_at, '[)')) " +
        'ORDER BY c.start_at',
        [
          query.date,
          court.timezone,
          candidates.map((candidate) => candidate.start),
          candidates.map((candidate) => candidate.end),
          candidates.map((_, index) => index),
          courtId,
        ],
      );
    });
    const slots = availability.rows.map((row) => {
      const candidate = candidates[row.idx];
      return {
        startAt: row.start_at,
        endAt: row.end_at,
        startTime: candidate.start,
        endTime: candidate.end,
        durationMinutes: duration,
        totalPrice: candidate.total,
        currency: 'VND',
      };
    });
    return { date: query.date, durationMinutes: duration, slots };
  }

  private assertRealDate(value: string) {
    const parsed = new Date(value + 'T00:00:00.000Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Ngày không hợp lệ');
    }
  }

  private timeMinutes(value: string): number {
    const parts = value.split(':').map(Number);
    return parts[0] * 60 + parts[1];
  }

  private formatTime(minutes: number): string {
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' +
      String(minutes % 60).padStart(2, '0');
  }

  private quotePrice(start: number, duration: number, rules: TimeRule[]): number | null {
    let cursor = start;
    const end = start + duration;
    let total = 0;
    while (cursor < end) {
      const rule = rules.find((candidate) => candidate.start <= cursor && candidate.end > cursor);
      if (!rule) return null;
      const segmentEnd = Math.min(end, rule.end);
      total += rule.price * (segmentEnd - cursor) / 60;
      cursor = segmentEnd;
    }
    return Math.round(total);
  }
}
