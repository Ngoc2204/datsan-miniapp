import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExploreController } from './explore.controller';
import { ExploreService } from './explore.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ExploreController],
  providers: [ExploreService],
})
export class ExploreModule {}
