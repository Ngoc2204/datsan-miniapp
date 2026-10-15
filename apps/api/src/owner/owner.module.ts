import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { OwnerController } from './owner.controller';
import { OwnerService } from './owner.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [OwnerController],
  providers: [OwnerService],
})
export class OwnerModule {}
