import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async check(): Promise<{ status: string; database: string }> {
    try {
      await this.database.ping();
      return { status: 'ok', database: 'connected' };
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }
  }
}
