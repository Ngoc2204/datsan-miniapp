import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { SportsModule } from './sports/sports.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { OwnerModule } from './owner/owner.module';
import { ExploreModule } from './explore/explore.module';
import { BookingsModule } from './bookings/bookings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CommunityModule } from './community/community.module';

@Module({
  imports: [DatabaseModule, HealthModule, SportsModule, AuthModule, AdminModule, OwnerModule, ExploreModule, BookingsModule, NotificationsModule, CommunityModule],
})
export class AppModule {}
