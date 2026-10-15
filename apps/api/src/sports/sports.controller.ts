import { Controller, Get } from '@nestjs/common';
import { SportDto, SportsService } from './sports.service';

@Controller('sports')
export class SportsController {
  constructor(private readonly sportsService: SportsService) {}

  @Get()
  listActive(): Promise<SportDto[]> {
    return this.sportsService.listActive();
  }
}
