import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { DatabaseService } from '../database/database.service';

type OutboxRow = { id: string; business_id: string; booking_id: string; recipient_email: string; kind: string; attempts: number };
type MessageRow = {
  status: string;
  start_at: Date;
  venue_name: string;
  address: string;
  court_name: string;
  contact_name: string | null;
  timezone: string;
};

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly transporter?: Transporter;

  constructor(private readonly database: DatabaseService) {
    const host = process.env.SMTP_HOST;
    if (host) {
      const port = Number(process.env.SMTP_PORT ?? 587);
      this.transporter = createTransport({
        host,
        port,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' }
          : undefined,
      });
    }
  }

  onModuleInit() {
    if (!this.transporter) {
      this.logger.warn('SMTP chưa cấu hình; email được giữ trong outbox.');
      return;
    }
    this.timer = setInterval(() => void this.deliverBatch(), 15_000);
    void this.deliverBatch();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
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
      'SELECT b.status, b.start_at, v.name AS venue_name, v.address, v.timezone, c.name AS court_name, b.contact_name ' +
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

    const dateText = new Intl.DateTimeFormat('vi-VN', {
      timeZone: booking.timezone,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(booking.start_at);
    const isReminder = item.kind.startsWith('reminder');
    const subject = isReminder
      ? 'DatSan | Nhắc lịch chơi sắp tới'
      : 'DatSan | Đặt sân đã xác nhận';
    const text = [
      'Xin chào ' + (booking.contact_name || 'bạn') + ',',
      isReminder ? 'Đây là lời nhắc lịch chơi của bạn.' : 'Lịch đặt sân của bạn đã được xác nhận.',
      'Địa điểm: ' + booking.venue_name,
      'Địa chỉ: ' + booking.address,
      'Sân: ' + booking.court_name,
      'Thời gian: ' + dateText,
      'Mã đặt chỗ: ' + item.booking_id,
    ].join('\n');

    try {
      await this.transporter!.sendMail({
        from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
        to: item.recipient_email,
        subject,
        text,
      });
      await this.database.query(
        "UPDATE notification_outbox SET status = 'sent', sent_at = now(), last_error = NULL, updated_at = now() WHERE id = $1",
        [item.id],
      );
    } catch (error) {
      const messageText = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown email error';
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
