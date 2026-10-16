import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PoolClient } from 'pg';
import { assertDateOnly, quotePrice, timeToMinutes, formatTime } from '../common/slot-pricing';
import { AssignStaffDto, CourtBlocksQueryDto, CreateCourtBlockDto, ManualBookingDto, OwnerBookingQueryDto, UpdateBookingStatusDto, UpdateBusinessDto, UpdateVenueDto } from './owner.dto';
import { CreateCourtDto, CreateVenueDto, OperatingHourDto, PriceRuleDto } from './owner.dto';

type AccessRow = { membership_role: 'owner' | 'manager' | 'staff'; status: string };

@Injectable()
export class OwnerService {
  constructor(private readonly database: DatabaseService) {}

  async listBusinesses(userId: string) {
    const result = await this.database.query(
      'SELECT b.id, b.display_name, b.status, b.review_reason, m.membership_role ' +
      'FROM business_memberships m JOIN businesses b ON b.id = m.business_id ' +
      'WHERE m.user_id = $1 AND m.active = true ORDER BY b.created_at',
      [userId],
    );
    return result.rows;
  }

  private async requireManager(client: PoolClient, userId: string, businessId: string) {
    const result = await client.query<AccessRow>(
      'SELECT m.membership_role, b.status FROM business_memberships m ' +
      'JOIN businesses b ON b.id = m.business_id ' +
      'WHERE m.user_id = $1 AND m.business_id = $2 AND m.active = true',
      [userId, businessId],
    );
    const access = result.rows[0];
    if (!access || !['owner', 'manager'].includes(access.membership_role)) {
      throw new ForbiddenException('Bạn không có quyền quản lý doanh nghiệp này');
    }
    if (access.status !== 'approved') {
      throw new ForbiddenException('Hồ sơ doanh nghiệp cần được admin duyệt trước');
    }
  }

  async listVenues(userId: string, businessId: string) {
    const access = await this.database.query<{ membership_role: string }>(
      'SELECT membership_role FROM business_memberships WHERE user_id = $1 AND business_id = $2 AND active = true',
      [userId, businessId],
    );
    if (!access.rows[0]) throw new ForbiddenException('Bạn không có quyền xem doanh nghiệp này');
    const role = access.rows[0].membership_role;
    const venuesResult = role === 'staff'
      ? await this.database.query(
          'SELECT v.id, v.business_id, v.name, v.address, v.latitude, v.longitude, v.description, v.status, v.review_reason, v.created_at, ' +
          "COALESCE((SELECT json_agg(s.code ORDER BY s.code) FROM venue_sports vs JOIN sports s ON s.id = vs.sport_id WHERE vs.business_id = v.business_id AND vs.venue_id = v.id), '[]'::json) AS sport_codes, " +
          "COALESCE((SELECT json_agg(vm.media_url ORDER BY vm.sort_order) FROM venue_media vm WHERE vm.business_id = v.business_id AND vm.venue_id = v.id), '[]'::json) AS media_urls " +
          'FROM venues v JOIN venue_staff vs ON vs.venue_id = v.id AND vs.business_id = v.business_id ' +
          'WHERE v.business_id = $1 AND vs.user_id = $2 ORDER BY v.created_at',
          [businessId, userId],
        )
      : await this.database.query(
          'SELECT v.id, v.business_id, v.name, v.address, v.latitude, v.longitude, v.description, v.status, v.review_reason, v.created_at, ' +
          "COALESCE((SELECT json_agg(s.code ORDER BY s.code) FROM venue_sports vs JOIN sports s ON s.id = vs.sport_id WHERE vs.business_id = v.business_id AND vs.venue_id = v.id), '[]'::json) AS sport_codes, " +
          "COALESCE((SELECT json_agg(vm.media_url ORDER BY vm.sort_order) FROM venue_media vm WHERE vm.business_id = v.business_id AND vm.venue_id = v.id), '[]'::json) AS media_urls " +
          'FROM venues v WHERE v.business_id = $1 ORDER BY v.created_at',
          [businessId],
        );
    const venues = venuesResult.rows as Array<Record<string, unknown> & { id: string }>;
    if (venues.length === 0) return [];
    const venueIds = venues.map((venue) => venue.id);
    const courtsResult = await this.database.query(
      "SELECT c.id, c.venue_id, c.name, c.court_type, c.active, s.code AS sport_code, s.name AS sport_name, " +
      'r.default_duration_minutes, r.minimum_duration_minutes, r.maximum_duration_minutes, r.slot_interval_minutes, ' +
      "COALESCE((SELECT json_agg(json_build_object('weekday', h.weekday, 'opensAt', h.opens_at, 'closesAt', h.closes_at) ORDER BY h.weekday, h.opens_at) FROM court_operating_hours h WHERE h.business_id = c.business_id AND h.court_id = c.id AND h.active = true), '[]'::json) AS operating_hours, " +
      "COALESCE((SELECT json_agg(json_build_object('weekday', p.weekday, 'startsAt', p.starts_at, 'endsAt', p.ends_at, 'pricePerHour', p.price_per_hour) ORDER BY p.weekday, p.starts_at) FROM price_rules p WHERE p.business_id = c.business_id AND p.court_id = c.id AND p.active = true), '[]'::json) AS price_rules " +
      'FROM courts c JOIN sports s ON s.id = c.sport_id LEFT JOIN court_booking_rules r ON r.business_id = c.business_id AND r.court_id = c.id ' +
      'WHERE c.business_id = $1 AND c.venue_id = ANY($2::uuid[]) ORDER BY c.created_at',
      [businessId, venueIds],
    );
    return venues.map((venue) => ({ ...venue, courts: courtsResult.rows.filter((court) => court.venue_id === venue.id) }));
  }

  async createVenue(userId: string, businessId: string, input: CreateVenueDto) {
    return this.database.transaction(async (client) => {
      await this.requireManager(client, userId, businessId);
      const sports = await client.query<{ id: string; code: string }>(
        'SELECT id, code FROM sports WHERE active = true AND code = ANY($1::text[])',
        [input.sportCodes],
      );
      if (sports.rows.length !== input.sportCodes.length) {
        throw new BadRequestException('Danh sách môn thể thao không hợp lệ hoặc bị lặp');
      }
      const venueResult = await client.query(
        'INSERT INTO venues (business_id, name, address, latitude, longitude, description) ' +
        'VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, address, status',
        [businessId, input.name, input.address, input.latitude ?? null, input.longitude ?? null, input.description?.trim() || null],
      );
      const venue = venueResult.rows[0] as { id: string; name: string; address: string; status: string };
      for (const sport of sports.rows) {
        await client.query(
          'INSERT INTO venue_sports (business_id, venue_id, sport_id) VALUES ($1, $2, $3)',
          [businessId, venue.id, sport.id],
        );
      }
      for (const [index, mediaUrl] of (input.mediaUrls ?? []).entries()) {
        await client.query(
          'INSERT INTO venue_media (business_id, venue_id, media_url, sort_order) VALUES ($1, $2, $3, $4)',
          [businessId, venue.id, mediaUrl, index],
        );
      }
      await client.query(
        'INSERT INTO venue_cancellation_policies (business_id, venue_id, rules) VALUES ($1, $2, $3::jsonb)',
        [businessId, venue.id, JSON.stringify({ cancelBeforeHours: 24, refundPercent: 100 })],
      );
      return { ...venue, sportCodes: sports.rows.map((sport) => sport.code) };
    });
  }

  async createCourt(userId: string, businessId: string, venueId: string, input: CreateCourtDto) {
    this.validateSchedule(input.operatingHours, input.priceRules, input);
    return this.database.transaction(async (client) => {
      await this.requireManager(client, userId, businessId);
      const venueResult = await client.query<{ status: string }>(
        'SELECT status FROM venues WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [venueId, businessId],
      );
      const venue = venueResult.rows[0];
      if (!venue) throw new NotFoundException('Không tìm thấy địa điểm');
      if (!['draft', 'rejected'].includes(venue.status)) {
        throw new BadRequestException('Chỉ được cấu hình sân khi địa điểm ở trạng thái nháp hoặc bị trả về');
      }
      const sportResult = await client.query<{ sport_id: string }>(
        'SELECT sport_id FROM venue_sports vs JOIN sports s ON s.id = vs.sport_id ' +
        'WHERE vs.business_id = $1 AND vs.venue_id = $2 AND s.code = $3 AND s.active = true',
        [businessId, venueId, input.sportCode],
      );
      if (!sportResult.rows[0]) throw new BadRequestException('Môn thể thao này chưa được bật cho địa điểm');
      if (!(input.minimumDurationMinutes <= input.defaultDurationMinutes &&
            input.defaultDurationMinutes <= input.maximumDurationMinutes)) {
        throw new BadRequestException('Thời lượng mặc định phải nằm giữa thời lượng tối thiểu và tối đa');
      }

      const courtResult = await client.query(
        'INSERT INTO courts (business_id, venue_id, sport_id, name, court_type) ' +
        'VALUES ($1, $2, $3, $4, $5) RETURNING id, name, court_type, active',
        [businessId, venueId, sportResult.rows[0].sport_id, input.name.trim(), input.courtType?.trim() || null],
      );
      const court = courtResult.rows[0] as { id: string; name: string; court_type: string | null; active: boolean };
      await client.query(
        'INSERT INTO court_booking_rules (business_id, court_id, default_duration_minutes, minimum_duration_minutes, maximum_duration_minutes, slot_interval_minutes) ' +
        'VALUES ($1, $2, $3, $4, $5, $6)',
        [businessId, court.id, input.defaultDurationMinutes, input.minimumDurationMinutes, input.maximumDurationMinutes, input.slotIntervalMinutes],
      );
      for (const hours of input.operatingHours) {
        await client.query(
          'INSERT INTO court_operating_hours (business_id, court_id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, $4, $5)',
          [businessId, court.id, hours.weekday, hours.opensAt, hours.closesAt],
        );
      }
      for (const price of input.priceRules) {
        await client.query(
          'INSERT INTO price_rules (business_id, court_id, weekday, starts_at, ends_at, price_per_hour) ' +
          'VALUES ($1, $2, $3, $4, $5, $6)',
          [businessId, court.id, price.weekday, price.startsAt, price.endsAt, price.pricePerHour],
        );
      }
      return court;
    });
  }

  async submitVenue(userId: string, businessId: string, venueId: string) {
    return this.database.transaction(async (client) => {
      await this.requireManager(client, userId, businessId);
      const venueResult = await client.query<{ id: string; status: string }>(
        'SELECT id, status FROM venues WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [venueId, businessId],
      );
      const venue = venueResult.rows[0];
      if (!venue) throw new NotFoundException('Không tìm thấy địa điểm');
      if (!['draft', 'rejected'].includes(venue.status)) {
        throw new BadRequestException('Địa điểm không ở trạng thái có thể gửi duyệt');
      }
      const configuration = await client.query<{ total: number; complete: number }>(
        'SELECT count(c.id)::int AS total, ' +
        'count(c.id) FILTER (WHERE r.court_id IS NOT NULL ' +
        'AND EXISTS (SELECT 1 FROM court_operating_hours h WHERE h.court_id = c.id AND h.active = true) ' +
        'AND EXISTS (SELECT 1 FROM price_rules p WHERE p.court_id = c.id AND p.active = true))::int AS complete ' +
        'FROM courts c LEFT JOIN court_booking_rules r ON r.business_id = c.business_id AND r.court_id = c.id ' +
        'WHERE c.business_id = $1 AND c.venue_id = $2 AND c.active = true',
        [businessId, venueId],
      );
      const counts = configuration.rows[0];
      if (counts.total < 1 || counts.total !== counts.complete) {
        throw new BadRequestException('Cần có ít nhất một sân với giờ hoạt động và giá đầy đủ trước khi gửi duyệt');
      }
      const updated = await client.query(
        "UPDATE venues SET status = 'pending_review', review_reason = NULL, updated_at = now() " +
        'WHERE id = $1 AND business_id = $2 RETURNING id, name, status',
        [venueId, businessId],
      );
      return updated.rows[0];
    });
  }

  private validateSchedule(hours: OperatingHourDto[], prices: PriceRuleDto[], input: CreateCourtDto) {
    if (input.slotIntervalMinutes > input.minimumDurationMinutes) {
      throw new BadRequestException('Khoảng nhảy khung giờ không được lớn hơn thời lượng tối thiểu');
    }
    const timeToMinutes = (value: string) => {
      const [hour, minute] = value.split(':').map(Number);
      return hour * 60 + minute;
    };
    const validateWindows = (rows: Array<{ weekday: number; start: string; end: string }>) => {
      const byDay = new Map<number, Array<[number, number]>>();
      for (const row of rows) {
        const start = timeToMinutes(row.start);
        const end = timeToMinutes(row.end);
        if (start >= end) throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu và trong cùng một ngày');
        const ranges = byDay.get(row.weekday) ?? [];
        if (ranges.some(([otherStart, otherEnd]) => start < otherEnd && otherStart < end)) {
          throw new BadRequestException('Các khung giờ cùng ngày không được chồng lấn');
        }
        ranges.push([start, end]);
        byDay.set(row.weekday, ranges);
      }
    };
    validateWindows(hours.map((row) => ({ weekday: row.weekday, start: row.opensAt, end: row.closesAt })));
    validateWindows(prices.map((row) => ({ weekday: row.weekday, start: row.startsAt, end: row.endsAt })));

    for (const operating of hours) {
      let cursor = timeToMinutes(operating.opensAt);
      const closing = timeToMinutes(operating.closesAt);
      const dayPrices = prices
        .filter((price) => price.weekday === operating.weekday)
        .map((price) => ({ start: timeToMinutes(price.startsAt), end: timeToMinutes(price.endsAt) }))
        .sort((left, right) => left.start - right.start);
      while (cursor < closing) {
        const rule = dayPrices.find((price) => price.start <= cursor && price.end > cursor);
        if (!rule) {
          throw new BadRequestException('Bảng giá phải phủ toàn bộ giờ hoạt động của từng ngày');
        }
        cursor = Math.min(closing, rule.end);
      }
    }
  }

  async reports(userId: string, businessId: string, query: OwnerBookingQueryDto) {
    const from = new Date(query.from + 'T00:00:00.000Z');
    const to = new Date(query.to + 'T00:00:00.000Z');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) ||
        from.toISOString().slice(0, 10) !== query.from || to.toISOString().slice(0, 10) !== query.to ||
        from > to || to.getTime() - from.getTime() >= 31 * 24 * 60 * 60_000) {
      throw new BadRequestException('Khoảng ngày không hợp lệ (tối đa 31 ngày)');
    }
    return this.database.transaction(async (client) => {
      await this.requireManager(client, userId, businessId);
      const summary = await client.query(
        'SELECT count(*)::int AS bookings_total, ' +
        "count(*) FILTER (WHERE b.status = 'confirmed')::int AS bookings_confirmed, " +
        "count(*) FILTER (WHERE b.status = 'completed')::int AS bookings_completed, " +
        "count(*) FILTER (WHERE b.status = 'cancelled')::int AS bookings_cancelled, " +
        "COALESCE(sum(b.quoted_total) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0)::bigint AS booked_value_vnd " +
        'FROM bookings b JOIN courts c ON c.id = b.court_id AND c.business_id = b.business_id ' +
        'JOIN venues v ON v.id = c.venue_id AND v.business_id = c.business_id ' +
        'WHERE b.business_id = $1 AND b.start_at >= (($2::date + time \'00:00\') AT TIME ZONE v.timezone) ' +
        'AND b.start_at < ((($3::date + 1) + time \'00:00\') AT TIME ZONE v.timezone)',
        [businessId, query.from, query.to],
      );
      const daily = await client.query(
        'SELECT (b.start_at AT TIME ZONE v.timezone)::date AS booking_date, count(*)::int AS bookings_total, ' +
        "count(*) FILTER (WHERE b.status = 'confirmed')::int AS bookings_confirmed, " +
        "count(*) FILTER (WHERE b.status = 'completed')::int AS bookings_completed, " +
        "COALESCE(sum(b.quoted_total) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0)::bigint AS booked_value_vnd " +
        'FROM bookings b JOIN courts c ON c.id = b.court_id AND c.business_id = b.business_id ' +
        'JOIN venues v ON v.id = c.venue_id AND v.business_id = c.business_id ' +
        'WHERE b.business_id = $1 AND b.start_at >= (($2::date + time \'00:00\') AT TIME ZONE v.timezone) ' +
        'AND b.start_at < ((($3::date + 1) + time \'00:00\') AT TIME ZONE v.timezone) ' +
        'GROUP BY booking_date ORDER BY booking_date',
        [businessId, query.from, query.to],
      );
      return { from: query.from, to: query.to, summary: summary.rows[0], daily: daily.rows };
    });
  }
  async listBookings(userId: string, businessId: string, query: OwnerBookingQueryDto) {
    const from = new Date(query.from + 'T00:00:00.000Z');
    const to = new Date(query.to + 'T00:00:00.000Z');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) ||
        from.toISOString().slice(0, 10) !== query.from || to.toISOString().slice(0, 10) !== query.to ||
        from > to || to.getTime() - from.getTime() >= 31 * 24 * 60 * 60_000) {
      throw new BadRequestException('Khoảng ngày không hợp lệ (tối đa 31 ngày)');
    }
    const membership = await this.database.query<{ membership_role: string; status: string }>(
      'SELECT m.membership_role, b.status FROM business_memberships m JOIN businesses b ON b.id = m.business_id ' +
      'WHERE m.business_id = $1 AND m.user_id = $2 AND m.active = true',
      [businessId, userId],
    );
    const access = membership.rows[0];
    if (!access || !['owner', 'manager', 'staff'].includes(access.membership_role)) {
      throw new ForbiddenException('Bạn không có quyền xem lịch của doanh nghiệp này');
    }
    if (access.status !== 'approved') throw new ForbiddenException('Doanh nghiệp chưa được admin duyệt');
    const result = await this.database.query(
      'SELECT b.id, b.status, b.source, b.start_at, b.end_at, b.quoted_total AS total_price, b.currency, ' +
      'b.contact_name, b.contact_phone, b.contact_email, v.id AS venue_id, v.name AS venue_name, ' +
      'c.id AS court_id, c.name AS court_name, p.status AS payment_status ' +
      'FROM bookings b JOIN courts c ON c.id = b.court_id AND c.business_id = b.business_id ' +
      'JOIN venues v ON v.id = c.venue_id AND v.business_id = c.business_id ' +
      'LEFT JOIN LATERAL (SELECT status FROM booking_payments bp WHERE bp.booking_id = b.id ' +
      'AND bp.business_id = b.business_id ORDER BY bp.created_at DESC LIMIT 1) p ON true ' +
      'WHERE b.business_id = $1 ' +
      'AND b.start_at >= (($2::date + time \'00:00\') AT TIME ZONE v.timezone) ' +
      'AND b.start_at < ((($3::date + 1) + time \'00:00\') AT TIME ZONE v.timezone) ' +
      'AND ($4::uuid IS NULL OR v.id = $4) AND ($5::text IS NULL OR b.status = $5) ' +
      'AND ($6::text <> \'staff\' OR EXISTS (SELECT 1 FROM venue_staff vs WHERE vs.business_id = b.business_id ' +
      'AND vs.venue_id = v.id AND vs.user_id = $7)) ' +
      'ORDER BY b.start_at LIMIT 500',
      [businessId, query.from, query.to, query.venueId ?? null, query.status ?? null, access.membership_role, userId],
    );
    return result.rows;
  }

  async updateBookingStatus(userId: string, businessId: string, bookingId: string, input: UpdateBookingStatusDto) {
    return this.database.transaction(async (client) => {
      const result = await client.query<{
        id: string;
        venue_id: string;
        business_id: string;
        status: string;
        end_at: Date;
      }>(
        'SELECT b.id, b.business_id, c.venue_id, b.status, b.end_at FROM bookings b ' +
        'JOIN courts c ON c.id = b.court_id AND c.business_id = b.business_id ' +
        'WHERE b.id = $1 AND b.business_id = $2 FOR UPDATE OF b',
        [bookingId, businessId],
      );
      const booking = result.rows[0];
      if (!booking) throw new NotFoundException('Không tìm thấy lượt đặt');
      await this.requireBooker(client, userId, businessId, booking.venue_id);
      if (!['confirmed', 'pending_payment'].includes(booking.status)) {
        throw new BadRequestException('Lượt đặt hiện không thể cập nhật');
      }
      if (input.status === 'completed' &&
          (booking.status !== 'confirmed' || booking.end_at.getTime() > Date.now())) {
        throw new BadRequestException('Chỉ hoàn tất booking đã xác nhận sau giờ kết thúc');
      }
      const updated = await client.query(
        'UPDATE bookings SET status = $2, hold_expires_at = NULL, updated_at = now() ' +
        'WHERE id = $1 RETURNING id, status',
        [bookingId, input.status],
      );
      if (input.status === 'cancelled') {
        await client.query(
          "UPDATE booking_payments SET status = 'failed', updated_at = now() " +
          "WHERE business_id = $1 AND booking_id = $2 AND status = 'pending'",
          [businessId, bookingId],
        );
      }
      await client.query(
        'INSERT INTO booking_status_history (business_id, booking_id, from_status, to_status, actor_user_id, reason) ' +
        'VALUES ($1, $2, $3, $4, $5, $6)',
        [businessId, bookingId, booking.status, input.status, userId, input.reason?.trim() || 'owner_update'],
      );
      return updated.rows[0];
    });
  }

  async createManualBooking(userId: string, businessId: string, input: ManualBookingDto) {
    try {
      assertDateOnly(input.date);
      return await this.database.transaction(async (client) => {
        const setupResult = await client.query<{
          business_id: string; venue_id: string; court_id: string; timezone: string;
          default_duration_minutes: number; minimum_duration_minutes: number;
          maximum_duration_minutes: number; slot_interval_minutes: number;
          cancellation_rules: Record<string, unknown>;
        }>(
          'SELECT c.business_id, c.venue_id, c.id AS court_id, v.timezone, r.default_duration_minutes, ' +
          'r.minimum_duration_minutes, r.maximum_duration_minutes, r.slot_interval_minutes, ' +
          'COALESCE(cp.rules, \'{}\'::jsonb) AS cancellation_rules ' +
          'FROM courts c JOIN venues v ON v.business_id = c.business_id AND v.id = c.venue_id ' +
          'JOIN businesses b ON b.id = v.business_id ' +
          'JOIN court_booking_rules r ON r.business_id = c.business_id AND r.court_id = c.id ' +
          'LEFT JOIN venue_cancellation_policies cp ON cp.business_id = v.business_id AND cp.venue_id = v.id ' +
          'WHERE c.id = $1 AND c.business_id = $2 AND c.active = true ' +
          "AND v.status = 'approved' AND b.status = 'approved' FOR UPDATE OF c",
          [input.courtId, businessId],
        );
        const setup = setupResult.rows[0];
        if (!setup) throw new NotFoundException('Không tìm thấy sân đang hoạt động');
        await this.requireBooker(client, userId, businessId, setup.venue_id);
        if (input.durationMinutes < setup.minimum_duration_minutes ||
            input.durationMinutes > setup.maximum_duration_minutes ||
            input.durationMinutes % setup.slot_interval_minutes !== 0) {
          throw new BadRequestException('Thời lượng không hợp lệ theo cấu hình của sân');
        }
        await client.query(
          "WITH expired AS (UPDATE bookings SET status = 'expired', updated_at = now() WHERE court_id = $1 " +
          "AND status = 'pending_payment' AND hold_expires_at <= now() RETURNING business_id, id) " +
          'INSERT INTO booking_status_history (business_id, booking_id, from_status, to_status, reason) ' +
          "SELECT business_id, id, 'pending_payment', 'expired', 'hold_expired' FROM expired",
          [input.courtId],
        );
        const weekday = new Date(input.date + 'T00:00:00.000Z').getUTCDay();
        const start = timeToMinutes(input.startTime);
        const end = start + input.durationMinutes;
        const hours = await client.query<{ opens_at: string; closes_at: string }>(
          'SELECT opens_at::text, closes_at::text FROM court_operating_hours ' +
          'WHERE business_id = $1 AND court_id = $2 AND weekday = $3 AND active = true',
          [businessId, input.courtId, weekday],
        );
        if (!hours.rows.some((row) => start >= timeToMinutes(row.opens_at) && end <= timeToMinutes(row.closes_at))) {
          throw new BadRequestException('Khung giờ nằm ngoài giờ hoạt động');
        }
        const prices = await client.query<{ starts_at: string; ends_at: string; price_per_hour: string }>(
          'SELECT starts_at::text, ends_at::text, price_per_hour::text FROM price_rules ' +
          'WHERE business_id = $1 AND court_id = $2 AND weekday = $3 AND active = true ' +
          'AND effective_from <= $4::date AND (effective_to IS NULL OR effective_to >= $4::date) ORDER BY starts_at',
          [businessId, input.courtId, weekday, input.date],
        );
        const total = quotePrice(start, input.durationMinutes, prices.rows.map((row) => ({
          start: timeToMinutes(row.starts_at),
          end: timeToMinutes(row.ends_at),
          pricePerHour: Number(row.price_per_hour),
        })));
        if (total === null) throw new BadRequestException('Sân chưa có giá cho toàn bộ khung giờ đã chọn');
        const times = await client.query<{ start_at: Date; end_at: Date; future: boolean }>(
          'SELECT ($1::date + $2::time) AT TIME ZONE $3 AS start_at, ' +
          '($1::date + $4::time) AT TIME ZONE $3 AS end_at, ' +
          '(($1::date + $2::time) AT TIME ZONE $3) > now() AS future',
          [input.date, input.startTime, setup.timezone, formatTime(end)],
        );
        const slot = times.rows[0];
        if (!slot.future) throw new BadRequestException('Không thể tạo booking cho giờ đã bắt đầu');
        const blocked = await client.query<{ value: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM court_blocks WHERE business_id = $1 AND court_id = $2 ' +
          "AND tstzrange(starts_at, ends_at, '[)') && tstzrange($3, $4, '[)')) AS value",
          [businessId, input.courtId, slot.start_at, slot.end_at],
        );
        if (blocked.rows[0].value) throw new ConflictException('Sân đã bị khóa trong khung giờ này');
        const booking = await client.query<{ id: string; status: string; start_at: Date; end_at: Date }>(
          "INSERT INTO bookings (business_id, court_id, source, status, start_at, end_at, quoted_total, currency, " +
          "contact_name, contact_phone, contact_email, cancellation_policy_snapshot, created_by_user_id) " +
          "VALUES ($1, $2, 'staff', 'confirmed', $3, $4, $5, 'VND', $6, $7, $8, $9::jsonb, $10) " +
          'RETURNING id, status, start_at, end_at',
          [businessId, input.courtId, slot.start_at, slot.end_at, total, input.contactName.trim(),
            input.contactPhone.trim(), input.contactEmail ?? null, JSON.stringify(setup.cancellation_rules), userId],
        );
        const created = booking.rows[0];
        await client.query(
          'INSERT INTO booking_status_history (business_id, booking_id, from_status, to_status, actor_user_id, reason) ' +
          "VALUES ($1, $2, NULL, 'confirmed', $3, 'staff_booking')",
          [businessId, created.id, userId],
        );
        await client.query(
          "INSERT INTO booking_payments (business_id, booking_id, method, status, amount, currency) " +
          "VALUES ($1, $2, 'onsite', 'unpaid', $3, 'VND')",
          [businessId, created.id, total],
        );
        if (input.contactEmail) {
          await client.query(
            "INSERT INTO notification_outbox (business_id, booking_id, recipient_email, kind, scheduled_for) " +
            "VALUES ($1, $2, $3, 'booking_confirmation', now()) ON CONFLICT (booking_id, kind) DO NOTHING",
            [businessId, created.id, input.contactEmail],
          );
          await client.query(
            "INSERT INTO notification_outbox (business_id, booking_id, recipient_email, kind, scheduled_for) " +
            "SELECT business_id, id, contact_email, 'reminder_24h', start_at - interval '24 hours' FROM bookings " +
            "WHERE id = $1 AND contact_email IS NOT NULL AND start_at - interval '24 hours' > now() " +
            "ON CONFLICT (booking_id, kind) DO NOTHING",
            [created.id],
          );
          await client.query(
            "INSERT INTO notification_outbox (business_id, booking_id, recipient_email, kind, scheduled_for) " +
            "SELECT business_id, id, contact_email, 'reminder_2h', start_at - interval '2 hours' FROM bookings " +
            "WHERE id = $1 AND contact_email IS NOT NULL AND start_at - interval '2 hours' > now() " +
            "ON CONFLICT (booking_id, kind) DO NOTHING",
            [created.id],
          );
        }
        return { ...created, totalPrice: total, currency: 'VND', paymentMethod: 'onsite', paymentStatus: 'unpaid' };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23P01') {
        throw new ConflictException('Khung giờ vừa được người khác đặt. Hãy chọn giờ khác.');
      }
      throw error;
    }
  }

  private async requireBooker(client: PoolClient, userId: string, businessId: string, venueId: string) {
    const result = await client.query<{ membership_role: string; status: string }>(
      'SELECT m.membership_role, b.status FROM business_memberships m JOIN businesses b ON b.id = m.business_id ' +
      'WHERE m.business_id = $1 AND m.user_id = $2 AND m.active = true',
      [businessId, userId],
    );
    const access = result.rows[0];
    if (!access || !['owner', 'manager', 'staff'].includes(access.membership_role)) {
      throw new ForbiddenException('Bạn không có quyền thao tác lịch của doanh nghiệp này');
    }
    if (access.status !== 'approved') throw new ForbiddenException('Doanh nghiệp chưa được admin duyệt');
    if (access.membership_role === 'staff') {
      const assigned = await client.query(
        'SELECT 1 FROM venue_staff WHERE business_id = $1 AND venue_id = $2 AND user_id = $3',
        [businessId, venueId, userId],
      );
      if (!assigned.rows[0]) throw new ForbiddenException('Nhân viên chưa được phân công địa điểm này');
    }
  }



  async updateVenue(userId: string, businessId: string, venueId: string, input: UpdateVenueDto) {
    return this.database.transaction(async (client) => {
      await this.requireManager(client, userId, businessId);
      const current = await client.query<{ id: string; status: string }>(
        'SELECT id, status FROM venues WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [venueId, businessId],
      );
      if (!current.rows[0]) throw new NotFoundException('Không tìm thấy địa điểm');
      if (!['draft', 'rejected'].includes(current.rows[0].status)) {
        throw new BadRequestException('Chỉ có thể sửa địa điểm nháp hoặc bị trả về');
      }
      if (input.mediaUrls !== undefined) {
        await client.query('DELETE FROM venue_media WHERE business_id = $1 AND venue_id = $2', [businessId, venueId]);
        for (const [index, mediaUrl] of input.mediaUrls.entries()) {
          await client.query(
            'INSERT INTO venue_media (business_id, venue_id, media_url, sort_order) VALUES ($1, $2, $3, $4)',
            [businessId, venueId, mediaUrl, index],
          );
        }
      }
      const result = await client.query(
        'UPDATE venues SET name = COALESCE($3, name), address = COALESCE($4, address), '+
        'latitude = COALESCE($5, latitude), longitude = COALESCE($6, longitude), ' +
        'description = COALESCE($7, description), updated_at = now() ' +
        'WHERE id = $1 AND business_id = $2 RETURNING id, name, address, latitude, longitude, description, status',
        [venueId, businessId, input.name ?? null, input.address ?? null, input.latitude ?? null,
          input.longitude ?? null, input.description ?? null],
      );
      return result.rows[0];
    });
  }

  async createCourtBlock(userId: string, businessId: string, courtId: string, input: CreateCourtBlockDto) {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) ||
        startsAt <= new Date() || startsAt >= endsAt) {
      throw new BadRequestException('Khoảng thời gian khóa sân không hợp lệ');
    }
    return this.database.transaction(async (client) => {
      const court = await client.query<{ venue_id: string }>(
        'SELECT c.venue_id FROM courts c JOIN venues v ON v.id = c.venue_id AND v.business_id = c.business_id ' +
        "JOIN businesses b ON b.id = c.business_id WHERE c.id = $1 AND c.business_id = $2 AND c.active = true " +
        "AND v.status = 'approved' AND b.status = 'approved' FOR UPDATE OF c",
        [courtId, businessId],
      );
      if (!court.rows[0]) throw new NotFoundException('Không tìm thấy sân đang hoạt động');
      await this.requireVenueManager(client, userId, businessId, court.rows[0].venue_id);
      const conflict = await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM bookings b WHERE b.business_id = $1 AND b.court_id = $2 " +
        "AND (b.status = 'confirmed' OR (b.status = 'pending_payment' AND b.hold_expires_at > now())) " +
        "AND tstzrange(b.start_at, b.end_at, '[)') && tstzrange($3, $4, '[)')) AS exists",
        [businessId, courtId, startsAt, endsAt],
      );
      if (conflict.rows[0].exists) throw new ConflictException('Khoảng thời gian này đã có booking đang giữ chỗ');
      const result = await client.query(
        'INSERT INTO court_blocks (business_id, court_id, starts_at, ends_at, reason, source, created_by_user_id) ' +
        "VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, court_id, starts_at, ends_at, reason, source",
        [businessId, courtId, startsAt, endsAt, input.reason?.trim() || null, input.source ?? 'maintenance', userId],
      );
      return result.rows[0];
    });
  }

  async deleteCourtBlock(userId: string, businessId: string, blockId: string) {
    return this.database.transaction(async (client) => {
      const block = await client.query<{ court_id: string; venue_id: string }>(
        'SELECT cb.court_id, c.venue_id FROM court_blocks cb JOIN courts c ON c.id = cb.court_id ' +
        'AND c.business_id = cb.business_id WHERE cb.id = $1 AND cb.business_id = $2 FOR UPDATE OF cb',
        [blockId, businessId],
      );
      if (!block.rows[0]) throw new NotFoundException('Không tìm thấy khung giờ khóa sân');
      await this.requireVenueManager(client, userId, businessId, block.rows[0].venue_id);
      await client.query('DELETE FROM court_blocks WHERE id = $1 AND business_id = $2', [blockId, businessId]);
      return { id: blockId, deleted: true };
    });
  }

  async updateCourtConfiguration(userId: string, businessId: string, courtId: string, input: CreateCourtDto) {
    this.validateSchedule(input.operatingHours, input.priceRules, input);
    return this.database.transaction(async (client) => {
      const current = await client.query<{ venue_id: string; name: string; court_type: string | null }>(
        'SELECT c.venue_id, c.name, c.court_type FROM courts c ' +
        'JOIN venues v ON v.id = c.venue_id AND v.business_id = c.business_id ' +
        "WHERE c.id = $1 AND c.business_id = $2 AND c.active = true FOR UPDATE OF c",
        [courtId, businessId],
      );
      const court = current.rows[0];
      if (!court) throw new NotFoundException('Không tìm thấy sân');
      await this.requireManager(client, userId, businessId);
      const bookings = await client.query<{
        weekday: number; start_minute: number; end_minute: number;
      }>(
        'SELECT extract(dow FROM b.start_at AT TIME ZONE v.timezone)::int AS weekday, ' +
        '(extract(hour FROM b.start_at AT TIME ZONE v.timezone) * 60 + extract(minute FROM b.start_at AT TIME ZONE v.timezone))::int AS start_minute, ' +
        '(extract(hour FROM b.end_at AT TIME ZONE v.timezone) * 60 + extract(minute FROM b.end_at AT TIME ZONE v.timezone))::int AS end_minute ' +
        'FROM bookings b JOIN venues v ON v.id = $3 AND v.business_id = b.business_id ' +
        "WHERE b.business_id = $1 AND b.court_id = $2 AND (b.status = 'confirmed' OR " +
        "(b.status = 'pending_payment' AND b.hold_expires_at > now())) AND b.end_at > now()",
        [businessId, courtId, court.venue_id],
      );
      const operatingHours = input.operatingHours.map((row) => ({
        weekday: row.weekday,
        start: timeToMinutes(row.opensAt),
        end: timeToMinutes(row.closesAt),
      }));
      const priceWindows = input.priceRules.map((row) => ({
        weekday: row.weekday,
        start: timeToMinutes(row.startsAt),
        end: timeToMinutes(row.endsAt),
        pricePerHour: row.pricePerHour,
      }));
      for (const booking of bookings.rows) {
        const duration = booking.end_minute - booking.start_minute;
        const open = operatingHours.some((window) =>
          window.weekday === booking.weekday &&
          window.start <= booking.start_minute &&
          window.end >= booking.end_minute);
        if (!open || quotePrice(booking.start_minute, duration, priceWindows.filter((row) => row.weekday === booking.weekday)) === null) {
          throw new BadRequestException('Cấu hình mới sẽ làm mất giờ hoạt động hoặc giá của booking đang giữ chỗ');
        }
      }
      await client.query(
        'UPDATE courts SET name = $3, court_type = $4, updated_at = now() WHERE business_id = $1 AND id = $2',
        [businessId, courtId, input.name.trim(), input.courtType?.trim() || null],
      );
      await client.query(
        'UPDATE court_booking_rules SET default_duration_minutes = $3, minimum_duration_minutes = $4, ' +
        'maximum_duration_minutes = $5, slot_interval_minutes = $6, updated_at = now() ' +
        'WHERE business_id = $1 AND court_id = $2',
        [businessId, courtId, input.defaultDurationMinutes, input.minimumDurationMinutes,
          input.maximumDurationMinutes, input.slotIntervalMinutes],
      );
      await client.query(
        'DELETE FROM court_operating_hours WHERE business_id = $1 AND court_id = $2',
        [businessId, courtId],
      );
      await client.query(
        'UPDATE price_rules SET active = false WHERE business_id = $1 AND court_id = $2 AND active = true',
        [businessId, courtId],
      );
      for (const hours of input.operatingHours) {
        await client.query(
          'INSERT INTO court_operating_hours (business_id, court_id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, $4, $5)',
          [businessId, courtId, hours.weekday, hours.opensAt, hours.closesAt],
        );
      }
      for (const price of input.priceRules) {
        await client.query(
          'INSERT INTO price_rules (business_id, court_id, weekday, starts_at, ends_at, price_per_hour) ' +
          'VALUES ($1, $2, $3, $4, $5, $6)',
          [businessId, courtId, price.weekday, price.startsAt, price.endsAt, price.pricePerHour],
        );
      }
      return {
        id: courtId,
        venueId: court.venue_id,
        name: input.name.trim(),
        courtType: input.courtType?.trim() || null,
        updated: true,
      };
    });
  }


  async listCourtBlocks(userId: string, businessId: string, courtId: string, query: CourtBlocksQueryDto) {
    const from = new Date(query.from + 'T00:00:00.000Z');
    const to = new Date(query.to + 'T00:00:00.000Z');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) ||
        from.toISOString().slice(0, 10) !== query.from || to.toISOString().slice(0, 10) !== query.to ||
        from > to || to.getTime() - from.getTime() >= 31 * 24 * 60 * 60_000) {
      throw new BadRequestException('Khoảng ngày không hợp lệ (tối đa 31 ngày)');
    }
    return this.database.transaction(async (client) => {
      const venue = await client.query<{ venue_id: string }>(
        'SELECT venue_id FROM courts WHERE id = $1 AND business_id = $2 AND active = true',
        [courtId, businessId],
      );
      if (!venue.rows[0]) throw new NotFoundException('Không tìm thấy sân');
      await this.requireVenueManager(client, userId, businessId, venue.rows[0].venue_id);
      const result = await client.query(
        'SELECT cb.id, cb.court_id, cb.starts_at, cb.ends_at, cb.reason, cb.source, cb.created_at ' +
        'FROM court_blocks cb JOIN venues v ON v.id = $3 AND v.business_id = cb.business_id ' +
        'WHERE cb.business_id = $1 AND cb.court_id = $2 ' +
        "AND cb.ends_at > (($4::date + time '00:00') AT TIME ZONE v.timezone) " +
        "AND cb.starts_at < ((($5::date + 1) + time '00:00') AT TIME ZONE v.timezone) " +
        'ORDER BY cb.starts_at LIMIT 500',
        [businessId, courtId, venue.rows[0].venue_id, query.from, query.to],
      );
      return result.rows;
    });
  }

  async listStaff(userId: string, businessId: string) {
    return this.database.transaction(async (client) => {
      await this.requireManager(client, userId, businessId);
      const result = await client.query(
        'SELECT vs.user_id, vs.venue_id, vs.venue_role, u.email, u.full_name, v.name AS venue_name ' +
        'FROM venue_staff vs ' +
        'JOIN business_memberships bm ON bm.business_id = vs.business_id AND bm.user_id = vs.user_id AND bm.active = true ' +
        'JOIN user_accounts u ON u.id = vs.user_id ' +
        'JOIN venues v ON v.id = vs.venue_id AND v.business_id = vs.business_id ' +
        'WHERE vs.business_id = $1 ORDER BY v.name, u.full_name NULLS LAST, u.email',
        [businessId],
      );
      return result.rows;
    });
  }

  async assignStaff(userId: string, businessId: string, input: AssignStaffDto) {
    return this.database.transaction(async (client) => {
      await this.requireManager(client, userId, businessId);
      const venue = await client.query(
        'SELECT id FROM venues WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [input.venueId, businessId],
      );
      if (!venue.rows[0]) throw new NotFoundException('Không tìm thấy địa điểm');

      const account = await client.query<{ id: string }>(
        'SELECT id FROM user_accounts WHERE lower(email) = lower($1) AND active = true',
        [input.email],
      );
      if (!account.rows[0]) throw new NotFoundException('Email chưa đăng ký tài khoản datsan247');
      const staffUserId = account.rows[0].id;

      await client.query(
        "INSERT INTO business_memberships (business_id, user_id, membership_role, active) VALUES ($1, $2, 'staff', true) " +
        'ON CONFLICT (business_id, user_id) DO UPDATE SET active = true, ' +
        "membership_role = CASE WHEN business_memberships.membership_role IN ('owner', 'manager') " +
        'THEN business_memberships.membership_role ELSE \'staff\' END',
        [businessId, staffUserId],
      );
      const assigned = await client.query(
        'INSERT INTO venue_staff (business_id, venue_id, user_id, venue_role) VALUES ($1, $2, $3, $4) ' +
        'ON CONFLICT (venue_id, user_id) DO UPDATE SET venue_role = EXCLUDED.venue_role ' +
        'RETURNING user_id, venue_id, venue_role',
        [businessId, input.venueId, staffUserId, input.venueRole],
      );
      return assigned.rows[0];
    });
  }

  async removeStaff(userId: string, businessId: string, venueId: string, staffUserId: string) {
    return this.database.transaction(async (client) => {
      await this.requireManager(client, userId, businessId);
      const removed = await client.query(
        'DELETE FROM venue_staff WHERE business_id = $1 AND venue_id = $2 AND user_id = $3 RETURNING user_id',
        [businessId, venueId, staffUserId],
      );
      if (!removed.rows[0]) throw new NotFoundException('Không tìm thấy phân công nhân viên');
      await client.query(
        'UPDATE business_memberships bm SET active = false ' +
        "WHERE bm.business_id = $1 AND bm.user_id = $2 AND bm.membership_role = 'staff' " +
        'AND NOT EXISTS (SELECT 1 FROM venue_staff vs WHERE vs.business_id = bm.business_id AND vs.user_id = bm.user_id)',
        [businessId, staffUserId],
      );
      return { userId: staffUserId, venueId, removed: true };
    });
  }

  async updateBusiness(userId: string, businessId: string, input: UpdateBusinessDto) {
    const displayName = input.displayName.trim();
    if (displayName.length < 2) throw new BadRequestException('Tên doanh nghiệp không hợp lệ');
    const result = await this.database.query(
      'UPDATE businesses b SET display_name = $3, updated_at = now() ' +
      'FROM business_memberships bm ' +
      "WHERE b.id = $1 AND bm.business_id = b.id AND bm.user_id = $2 AND bm.active = true AND bm.membership_role IN ('owner', 'manager') " +
      'RETURNING b.id, b.display_name, b.status, b.review_reason, b.updated_at',
      [businessId, userId, displayName],
    );
    if (!result.rows[0]) throw new ForbiddenException('Bạn không có quyền chỉnh sửa doanh nghiệp này');
    return result.rows[0];
  }


  private async requireVenueManager(client: PoolClient, userId: string, businessId: string, venueId: string) {
    const result = await client.query<{ membership_role: string; status: string }>(
      'SELECT m.membership_role, b.status FROM business_memberships m ' +
      'JOIN businesses b ON b.id = m.business_id ' +
      'WHERE m.business_id = $1 AND m.user_id = $2 AND m.active = true',
      [businessId, userId],
    );
    const access = result.rows[0];
    if (!access || access.status !== 'approved') {
      throw new ForbiddenException('Bạn không có quyền quản lý địa điểm này');
    }
    if (['owner', 'manager'].includes(access.membership_role)) return;
    if (access.membership_role === 'staff') {
      const assignment = await client.query(
        "SELECT 1 FROM venue_staff WHERE business_id = $1 AND venue_id = $2 AND user_id = $3 AND venue_role = 'manager'",
        [businessId, venueId, userId],
      );
      if (assignment.rows[0]) return;
    }
    throw new ForbiddenException('Cần quyền quản lý được phân công tại địa điểm này');
  }

}
