import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class BookingLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingLifecycleService.name);
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;

  constructor(private readonly database: DatabaseService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.runTransitions(), 30_000);
    void this.runTransitions();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async runTransitions() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.database.transaction(async (client) => {
        await client.query(
          "WITH expired AS (UPDATE bookings SET status = 'expired', updated_at = now() " +
          "WHERE status = 'pending_payment' AND hold_expires_at <= now() RETURNING business_id, id) " +
          "INSERT INTO booking_status_history (business_id, booking_id, from_status, to_status, reason) " +
          "SELECT business_id, id, 'pending_payment', 'expired', 'hold_expired' FROM expired",
        );
        await client.query(
          "WITH completed AS (UPDATE bookings SET status = 'completed', updated_at = now() " +
          "WHERE status = 'confirmed' AND end_at <= now() RETURNING business_id, id) " +
          "INSERT INTO booking_status_history (business_id, booking_id, from_status, to_status, reason) " +
          "SELECT business_id, id, 'confirmed', 'completed', 'time_elapsed' FROM completed",
        );
      });
    } catch (error) {
      this.logger.error('Không thể cập nhật trạng thái booking.', error instanceof Error ? error.stack : undefined);
    } finally {
      this.busy = false;
    }
  }
}
