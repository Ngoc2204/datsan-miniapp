import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { DatabaseService } from '../database/database.service';
import { buildBookingEmail, BookingNotificationKind } from './booking-email';
import { readMailConfiguration } from './mail-config';

type OutboxRow = { id: string; business_id: string; booking_id: string; recipient_email: string; kind: string; attempts: number };
type MessageRow = {
  status: string;
  start_at: Date;
  end_at: Date;
  venue_name: string;
  address: string;
  court_name: string;
  contact_name: string | null;
  timezone: string;
  quoted_total: string;
  currency: string;
};

function safeMailError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown email error';
  return message
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/re_[A-Za-z0-9_-]{8,}/g, '[api-key]')
    .slice(0, 500);
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly transporter?: Transporter;
  private readonly from?: string;

  constructor(private readonly database: DatabaseService) {
    const config = readMailConfiguration();
    if (config) {
      this.from = config.from;
      this.transporter = createTransport(config.transport);
    }
  }

  onModuleInit() {
    if (!this.transporter) {
      this.logger.warn('SMTP chưa cấu hình; email được giữ trong outbox.');
      return;
    }
    void this.transporter.verify()
      .then(() => this.logger.log('SMTP đã kết nối và xác thực thành công.'))
      .catch(() => this.logger.error('Không xác thực được SMTP; email sẽ tiếp tục được thử lại theo hàng đợi.'));
    this.timer = setInterval(() => void this.deliverBatch(), 15_000);
    void this.deliverBatch();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.transporter?.close();
  }

  private async deliverBatch() {
    if (this.busy || !this.transporter) return;
    this.busy = true;
    try {
      const claimed = await this.database.transaction(async (client) =>
        client.query<OutboxRow>(
          'WITH ready AS (SELECT id FROM notification_outbox ' +
          "WHERE (status = 'pending' AND scheduled_for <= now() AND next_attempt_at <= now()) " +
          "OR (status = 'sending' AND updated_at < now() - interval '5 minutes') " +
          'ORDER BY scheduled_for FOR UPDATE SKIP LOCKED LIMIT 10) ' +
          "UPDATE notification_outbox o SET status = 'sending', attempts = o.attempts + 1, updated_at = now() " +
          'FROM ready WHERE o.id = ready.id ' +
          'RETURNING o.id, o.business_id, o.booking_id, o.recipient_email, o.kind, o.attempts',
        ),
      );

      for (const item of claimed.rows) {
        await this.deliverOne(item);
      }
    } catch (error) {
      this.logger.error('Không thể xử lý hàng đợi email.', error instanceof Error ? error.stack : undefined);
    } finally {
      this.busy = false;
    }
  }

  private async deliverOne(item: OutboxRow) {
    const message = await this.database.query<MessageRow>(
      'SELECT b.status, b.start_at, b.end_at, b.quoted_total::text, b.currency, ' +
      'v.name AS venue_name, v.address, v.timezone, c.name AS court_name, b.contact_name ' +
      'FROM bookings b JOIN courts c ON c.id = b.court_id AND c.business_id = b.business_id ' +
      'JOIN venues v ON v.id = c.venue_id AND v.business_id = c.business_id ' +
      'WHERE b.id = $1 AND b.business_id = $2',
      [item.booking_id, item.business_id],
    );
    const booking = message.rows[0];
    if (!booking || booking.status !== 'confirmed') {
      await this.database.query(
        "UPDATE notification_outbox SET status = 'skipped', updated_at = now() WHERE id = $1",
        [item.id],
      );
      return;
    }

    const email = buildBookingEmail({
      kind: item.kind as BookingNotificationKind,
      bookingId: item.booking_id,
      contactName: booking.contact_name,
      venueName: booking.venue_name,
      address: booking.address,
      courtName: booking.court_name,
      startAt: booking.start_at,
      endAt: booking.end_at,
      timezone: booking.timezone,
      total: booking.quoted_total,
      currency: booking.currency,
    });

    try {
      const result = await this.transporter!.sendMail({
        from: this.from,
        to: item.recipient_email,
        ...email,
      });
      await this.database.query(
        "UPDATE notification_outbox SET status = 'sent', sent_at = now(), last_error = NULL, updated_at = now() WHERE id = $1",
        [item.id],
      );
      this.logger.log(`Nhà cung cấp SMTP đã nhận email ${item.kind} (messageId: ${result.messageId}).`);
    } catch (error) {
      const messageText = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown email error';
      this.logger.error(`Gửi email ${item.kind} thất bại ở lần thử ${item.attempts}: ${safeMailError(error)}`);
      const nextStatus = item.attempts >= 5 ? 'failed' : 'pending';
      const backoffSeconds = Math.min(3600, 30 * Math.pow(2, item.attempts - 1));
      await this.database.query(
        'UPDATE notification_outbox SET status = $2, last_error = $3, ' +
        "next_attempt_at = now() + ($4::text || ' seconds')::interval, updated_at = now() WHERE id = $1",
        [item.id, nextStatus, messageText, backoffSeconds],
      );
    }
  }
}
