import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { assertDateOnly, dateWeekday, quotePrice, timeToMinutes, PriceWindow } from '../common/slot-pricing';
import { CreateBookingDto, DemoPaymentDto } from './bookings.dto';

type BookingSetup = {
  business_id: string;
  venue_id: string;
  court_id: string;
  timezone: string;
  default_duration_minutes: number;
  minimum_duration_minutes: number;
  maximum_duration_minutes: number;
  slot_interval_minutes: number;
  cancellation_rules: { cancelBeforeHours?: number; refundPercent?: number };
};

type WindowRow = { opens_at?: string; closes_at?: string; starts_at?: string; ends_at?: string; price_per_hour?: string };

@Injectable()
export class BookingsService {
  constructor(private readonly database: DatabaseService) {}

  async create(customerId: string, courtId: string, input: CreateBookingDto) {
    try {
      assertDateOnly(input.date);
      return await this.database.transaction(async (client) => {
        const setupResult = await client.query<BookingSetup>(
          "SELECT c.business_id, c.venue_id, c.id AS court_id, v.timezone, " +
          "r.default_duration_minutes, r.minimum_duration_minutes, r.maximum_duration_minutes, r.slot_interval_minutes, " +
          "COALESCE(cp.rules, '{}'::jsonb) AS cancellation_rules " +
          "FROM courts c JOIN venues v ON v.business_id = c.business_id AND v.id = c.venue_id " +
          "JOIN businesses b ON b.id = v.business_id " +
          "JOIN court_booking_rules r ON r.business_id = c.business_id AND r.court_id = c.id " +
          "LEFT JOIN venue_cancellation_policies cp ON cp.business_id = v.business_id AND cp.venue_id = v.id " +
          "WHERE c.id = $1 AND c.active = true AND v.status = 'approved' AND b.status = 'approved' FOR UPDATE OF c",
          [courtId],
        );
        const setup = setupResult.rows[0];
        if (!setup) throw new NotFoundException('Không tìm thấy sân đang hoạt động');
        if (input.durationMinutes < setup.minimum_duration_minutes ||
            input.durationMinutes > setup.maximum_duration_minutes ||
            input.durationMinutes % setup.slot_interval_minutes !== 0) {
          throw new BadRequestException('Thời lượng không hợp lệ theo cấu hình của sân');
        }

        await client.query(
          "WITH expired AS (UPDATE bookings SET status = 'expired', updated_at = now() WHERE court_id = $1 " +
          "AND status = 'pending_payment' AND hold_expires_at <= now() RETURNING business_id, id) " +
          "INSERT INTO booking_status_history (business_id, booking_id, from_status, to_status, reason) " +
          "SELECT business_id, id, 'pending_payment', 'expired', 'hold_expired' FROM expired",
          [courtId],
        );
        const weekday = dateWeekday(input.date);
        const hoursResult = await client.query<WindowRow>(
          "SELECT opens_at::text, closes_at::text FROM court_operating_hours " +
          "WHERE business_id = $1 AND court_id = $2 AND weekday = $3 AND active = true",
          [setup.business_id, courtId, weekday],
        );
        const startMinute = timeToMinutes(input.startTime);
        const endMinute = startMinute + input.durationMinutes;
        const withinHours = hoursResult.rows.some((hours) =>
          startMinute >= timeToMinutes(hours.opens_at!) &&
          endMinute <= timeToMinutes(hours.closes_at!));
        if (!withinHours) throw new BadRequestException('Khung giờ nằm ngoài giờ hoạt động');

        const pricesResult = await client.query<WindowRow>(
          "SELECT starts_at::text, ends_at::text, price_per_hour::text FROM price_rules " +
          "WHERE business_id = $1 AND court_id = $2 AND weekday = $3 AND active = true " +
          "AND effective_from <= $4::date AND (effective_to IS NULL OR effective_to >= $4::date) ORDER BY starts_at",
          [setup.business_id, courtId, weekday, input.date],
        );
        const priceWindows: PriceWindow[] = pricesResult.rows.map((rule) => ({
          start: timeToMinutes(rule.starts_at!),
          end: timeToMinutes(rule.ends_at!),
          pricePerHour: Number(rule.price_per_hour),
        }));
        const total = quotePrice(startMinute, input.durationMinutes, priceWindows);
        if (total === null) throw new BadRequestException('Sân chưa có giá cho toàn bộ khung giờ đã chọn');

        const times = await client.query<{ start_at: Date; end_at: Date; future: boolean }>(
          "SELECT ($1::date + $2::time) AT TIME ZONE $3 AS start_at, " +
          "($1::date + $4::time) AT TIME ZONE $3 AS end_at, " +
          "(($1::date + $2::time) AT TIME ZONE $3) > now() AS future",
          [input.date, input.startTime, setup.timezone, this.formatTime(endMinute)],
        );
        const slot = times.rows[0];
        if (!slot.future) throw new BadRequestException('Không thể đặt khung giờ đã bắt đầu');

        const block = await client.query<{ blocked: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM court_blocks cb WHERE cb.business_id = $1 AND cb.court_id = $2 " +
          "AND tstzrange(cb.starts_at, cb.ends_at, '[)') && tstzrange($3, $4, '[)')) AS blocked",
          [setup.business_id, courtId, slot.start_at, slot.end_at],
        );
        if (block.rows[0].blocked) throw new ConflictException('Sân đã bị khóa trong khung giờ này');

        const account = await client.query<{ full_name: string | null; phone: string | null; email: string | null }>(
          "SELECT full_name, phone, email FROM user_accounts WHERE id = $1 AND active = true",
          [customerId],
        );
        if (!account.rows[0]) throw new NotFoundException('Không tìm thấy tài khoản khách hàng');
        const contactName = input.contactName || account.rows[0].full_name || 'Khách hàng';
        const contactPhone = input.contactPhone || account.rows[0].phone;
        const contactEmail = input.contactEmail || account.rows[0].email;
        if (!contactEmail) {
          throw new BadRequestException('Vui lòng cung cấp email để nhận xác nhận và nhắc lịch đặt sân');
        }

        const configuredHoldMinutes = Number(process.env.DEMO_HOLD_MINUTES ?? 10);
        const holdMinutes = Number.isFinite(configuredHoldMinutes)
          ? Math.max(1, Math.min(30, configuredHoldMinutes))
          : 10;
        const isDemo = input.paymentMethod === 'demo';
        const status = isDemo ? 'pending_payment' : 'confirmed';
        const bookingResult = await client.query<{ id: string; status: string; start_at: Date; end_at: Date }>(
          "INSERT INTO bookings (business_id, court_id, customer_id, source, status, start_at, end_at, hold_expires_at, " +
          "quoted_total, contact_name, contact_phone, contact_email, cancellation_policy_snapshot, created_by_user_id) " +
          "VALUES ($1, $2, $3, 'mini_app', $4, $5, $6, " +
          "CASE WHEN $4 = 'pending_payment' THEN now() + ($7::text || ' minutes')::interval ELSE NULL END, " +
          "$8, $9, $10, $11, $12::jsonb, $3) RETURNING id, status, start_at, end_at",
          [
            setup.business_id, courtId, customerId, status, slot.start_at, slot.end_at, holdMinutes,
            total, contactName, contactPhone, contactEmail, JSON.stringify(setup.cancellation_rules),
          ],
        );
        const booking = bookingResult.rows[0];
        await client.query(
          "INSERT INTO booking_status_history (business_id, booking_id, from_status, to_status, actor_user_id, reason) " +
          "VALUES ($1, $2, NULL, $3, $4, $5)",
          [setup.business_id, booking.id, status, customerId, 'customer_booking'],
        );
        await client.query(
          "INSERT INTO booking_payments (business_id, booking_id, method, status, amount, currency, expires_at) " +
          "VALUES ($1, $2, $3, $4, $5, 'VND', CASE WHEN $4 = 'pending' THEN now() + ($6::text || ' minutes')::interval ELSE NULL END)",
          [setup.business_id, booking.id, input.paymentMethod, isDemo ? 'pending' : 'unpaid', total, holdMinutes],
        );
        if (!isDemo) await this.enqueueNotifications(client, booking.id);
        return {
          ...booking,
          totalPrice: total,
          currency: 'VND',
          paymentMethod: input.paymentMethod,
          paymentStatus: isDemo ? 'pending' : 'unpaid',
          holdExpiresAt: isDemo ? new Date(Date.now() + holdMinutes * 60_000).toISOString() : null,
        };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23P01') {
        throw new ConflictException('Khung giờ vừa được người khác đặt. Hãy chọn giờ khác.');
      }
      throw error;
    }
  }

  async listMine(customerId: string) {
    const result = await this.database.query(
      "SELECT b.id, b.status, b.start_at, b.end_at, b.quoted_total AS total_price, b.currency, " +
      "b.contact_name, b.contact_phone, b.contact_email, v.id AS venue_id, v.name AS venue_name, " +
      "v.address, c.id AS court_id, c.name AS court_name, p.method AS payment_method, p.status AS payment_status " +
      "FROM bookings b JOIN courts c ON c.id = b.court_id AND c.business_id = b.business_id " +
      "JOIN venues v ON v.id = c.venue_id AND v.business_id = c.business_id " +
      "LEFT JOIN LATERAL (SELECT method, status FROM booking_payments bp " +
      "WHERE bp.booking_id = b.id AND bp.business_id = b.business_id ORDER BY bp.created_at DESC LIMIT 1) p ON true " +
      "WHERE b.customer_id = $1 ORDER BY b.start_at DESC LIMIT 100",
      [customerId],
    );
    return result.rows;
  }

  async demoPayment(customerId: string, bookingId: string, input: DemoPaymentDto) {
    return this.database.transaction(async (client) => {
      const result = await client.query<{ id: string; business_id: string; status: string; hold_expires_at: Date | null }>(
        "SELECT id, business_id, status, hold_expires_at FROM bookings " +
        "WHERE id = $1 AND customer_id = $2 FOR UPDATE",
        [bookingId, customerId],
      );
      const booking = result.rows[0];
      if (!booking) throw new NotFoundException('Không tìm thấy lượt đặt');
      if (booking.status !== 'pending_payment') throw new BadRequestException('Lượt đặt không chờ thanh toán thử nghiệm');
      if (!booking.hold_expires_at || booking.hold_expires_at.getTime() <= Date.now()) {
        await client.query(
          "UPDATE bookings SET status = 'expired', updated_at = now() WHERE id = $1",
          [bookingId],
        );
        await client.query(
          "UPDATE booking_payments SET status = 'failed', updated_at = now() WHERE business_id = $1 AND booking_id = $2 AND status = 'pending'",
          [booking.business_id, bookingId],
        );
        await client.query(
          "INSERT INTO booking_status_history (business_id, booking_id, from_status, to_status, actor_user_id, reason) " +
          "VALUES ($1, $2, 'pending_payment', 'expired', $3, 'hold_expired')",
          [booking.business_id, bookingId, customerId],
        );
        return { id: bookingId, status: 'expired', paymentStatus: 'failed' };
      }
      const nextStatus = input.outcome === 'succeeded' ? 'confirmed' : 'expired';
      const paymentStatus = input.outcome === 'succeeded' ? 'succeeded' : 'failed';
      const payment = await client.query(
        "UPDATE booking_payments SET status = $3, updated_at = now() " +
        "WHERE business_id = $1 AND booking_id = $2 AND method = 'demo' AND status = 'pending' RETURNING id",
        [booking.business_id, bookingId, paymentStatus],
      );
      if (payment.rowCount !== 1) throw new BadRequestException('Không tìm thấy khoản thanh toán thử nghiệm đang chờ');
      await client.query(
        "UPDATE bookings SET status = $2, hold_expires_at = NULL, updated_at = now() WHERE id = $1",
        [bookingId, nextStatus],
      );
      await client.query(
        "INSERT INTO booking_status_history (business_id, booking_id, from_status, to_status, actor_user_id, reason) " +
        "VALUES ($1, $2, $3, $4, $5, $6)",
        [booking.business_id, bookingId, booking.status, nextStatus, customerId, 'demo_payment_' + input.outcome],
      );
      if (input.outcome === 'succeeded') await this.enqueueNotifications(client, bookingId);
      return { id: bookingId, status: nextStatus, paymentStatus };
    });
  }

  async cancel(customerId: string, bookingId: string) {
    return this.database.transaction(async (client) => {
      const result = await client.query<{
        id: string;
        business_id: string;
        status: string;
        start_at: Date;
        cancellation_policy_snapshot: { cancelBeforeHours?: number };
      }>(
        "SELECT id, business_id, status, start_at, cancellation_policy_snapshot FROM bookings " +
        "WHERE id = $1 AND customer_id = $2 FOR UPDATE",
        [bookingId, customerId],
      );
      const booking = result.rows[0];
      if (!booking) throw new NotFoundException('Không tìm thấy lượt đặt');
      if (!['confirmed', 'pending_payment'].includes(booking.status)) {
        throw new BadRequestException('Lượt đặt hiện không thể hủy');
      }
      const cancelBeforeHours = booking.cancellation_policy_snapshot.cancelBeforeHours ?? 24;
      const remainingMs = booking.start_at.getTime() - Date.now();
      if (booking.status === 'confirmed' && remainingMs <= cancelBeforeHours * 60 * 60_000) {
        throw new BadRequestException('Đã quá thời hạn hủy theo chính sách của địa điểm');
      }
      const updated = await client.query(
        "UPDATE bookings SET status = 'cancelled', hold_expires_at = NULL, updated_at = now() " +
        "WHERE id = $1 RETURNING id, status",
        [bookingId],
      );
      await client.query(
        "UPDATE booking_payments SET status = 'failed', updated_at = now() WHERE business_id = $1 AND booking_id = $2 AND status = 'pending'",
        [booking.business_id, bookingId],
      );
      await client.query(
        "INSERT INTO booking_status_history (business_id, booking_id, from_status, to_status, actor_user_id, reason) " +
        "VALUES ($1, $2, $3, 'cancelled', $4, 'customer_cancelled')",
        [booking.business_id, bookingId, booking.status, customerId],
      );
      return updated.rows[0];
    });
  }


  private async enqueueNotifications(client: import('pg').PoolClient, bookingId: string) {
    await client.query(
      "INSERT INTO notification_outbox (business_id, booking_id, recipient_email, kind, scheduled_for) " +
      "SELECT business_id, id, contact_email, 'booking_confirmation', now() FROM bookings " +
      "WHERE id = $1 AND contact_email IS NOT NULL ON CONFLICT (booking_id, kind) DO NOTHING",
      [bookingId],
    );
    await client.query(
      "INSERT INTO notification_outbox (business_id, booking_id, recipient_email, kind, scheduled_for) " +
      "SELECT business_id, id, contact_email, 'reminder_24h', start_at - interval '24 hours' FROM bookings " +
      "WHERE id = $1 AND contact_email IS NOT NULL AND start_at - interval '24 hours' > now() " +
      "ON CONFLICT (booking_id, kind) DO NOTHING",
      [bookingId],
    );
    await client.query(
      "INSERT INTO notification_outbox (business_id, booking_id, recipient_email, kind, scheduled_for) " +
      "SELECT business_id, id, contact_email, 'reminder_2h', start_at - interval '2 hours' FROM bookings " +
      "WHERE id = $1 AND contact_email IS NOT NULL AND start_at - interval '2 hours' > now() " +
      "ON CONFLICT (booking_id, kind) DO NOTHING",
      [bookingId],
    );
  }

  private formatTime(minutes: number): string {
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' +
      String(minutes % 60).padStart(2, '0');
  }
}
