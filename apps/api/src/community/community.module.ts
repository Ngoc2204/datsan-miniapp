import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [CommunityController],
  providers: [CommunityService],
})
export class CommunityModule {}
