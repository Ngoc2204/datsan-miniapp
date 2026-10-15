import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { AvailabilityQueryDto, ExploreQueryDto } from './explore.dto';
import { ExploreService } from './explore.service';

@Controller('venues')
export class ExploreController {
  constructor(private readonly explore: ExploreService) {}

  @Get()
  list(@Query() query: ExploreQueryDto) {
    return this.explore.listVenues(query);
  }

  @Get(':venueId/courts/:courtId/availability')
  availability(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Param('courtId', ParseUUIDPipe) courtId: string,
    @Query() query: AvailabilityQueryDto,
  ) {
    return this.explore.getAvailability(venueId, courtId, query);
  }

  @Get(':venueId')
  detail(@Param('venueId', ParseUUIDPipe) venueId: string) {
    return this.explore.getVenue(venueId);
  }
}
