import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingLifecycleService } from './booking-lifecycle.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingLifecycleService],
})
export class BookingsModule {}
