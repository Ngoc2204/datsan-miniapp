import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Patch, Delete, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CreateCourtDto, CreateVenueDto, AssignStaffDto, CourtBlocksQueryDto, CreateCourtBlockDto, ManualBookingDto, OwnerBookingQueryDto, UpdateBookingStatusDto, UpdateBusinessDto, UpdateVenueDto } from './owner.dto';
import { OwnerService } from './owner.service';

@Controller('owner')
@UseGuards(AuthGuard)
export class OwnerController {
  constructor(private readonly owner: OwnerService) {}

  @Get('businesses/:businessId/staff')
  listStaff(@Req() request: Request, @Param('businessId', ParseUUIDPipe) businessId: string) {
    return this.owner.listStaff(request.authUser!.id, businessId);
  }

  @Post('businesses/:businessId/staff')
  assignStaff(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Body() input: AssignStaffDto,
  ) {
    return this.owner.assignStaff(request.authUser!.id, businessId, input);
  }

  @Delete('businesses/:businessId/staff/:venueId/:userId')
  removeStaff(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.owner.removeStaff(request.authUser!.id, businessId, venueId, userId);
  }

  @Patch('businesses/:businessId')
  updateBusiness(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Body() input: UpdateBusinessDto,
  ) {
    return this.owner.updateBusiness(request.authUser!.id, businessId, input);
  }

  @Get('businesses')
  listBusinesses(@Req() request: Request) {
    return this.owner.listBusinesses(request.authUser!.id);
  }

  @Get('businesses/:businessId/venues')
  listVenues(@Req() request: Request, @Param('businessId', ParseUUIDPipe) businessId: string) {
    return this.owner.listVenues(request.authUser!.id, businessId);
  }

  @Get('businesses/:businessId/reports')
  reports(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Query() query: OwnerBookingQueryDto,
  ) {
    return this.owner.reports(request.authUser!.id, businessId, query);
  }
  @Get('businesses/:businessId/bookings')
  listBookings(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Query() query: OwnerBookingQueryDto,
  ) {
    return this.owner.listBookings(request.authUser!.id, businessId, query);
  }

  @Post('businesses/:businessId/bookings/manual')
  createManualBooking(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Body() input: ManualBookingDto,
  ) {
    return this.owner.createManualBooking(request.authUser!.id, businessId, input);
  }

  @Patch('businesses/:businessId/bookings/:bookingId')
  updateBookingStatus(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() input: UpdateBookingStatusDto,
  ) {
    return this.owner.updateBookingStatus(request.authUser!.id, businessId, bookingId, input);
  }

  @Post('businesses/:businessId/venues')
  createVenue(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Body() input: CreateVenueDto,
  ) {
    return this.owner.createVenue(request.authUser!.id, businessId, input);
  }

  @Patch('businesses/:businessId/venues/:venueId')
  updateVenue(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Body() input: UpdateVenueDto,
  ) {
    return this.owner.updateVenue(request.authUser!.id, businessId, venueId, input);
  }

  @Get('businesses/:businessId/courts/:courtId/blocks')
  listCourtBlocks(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Param('courtId', ParseUUIDPipe) courtId: string,
    @Query() query: CourtBlocksQueryDto,
  ) {
    return this.owner.listCourtBlocks(request.authUser!.id, businessId, courtId, query);
  }

  @Post('businesses/:businessId/courts/:courtId/blocks')
  createCourtBlock(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Param('courtId', ParseUUIDPipe) courtId: string,
    @Body() input: CreateCourtBlockDto,
  ) {
    return this.owner.createCourtBlock(request.authUser!.id, businessId, courtId, input);
  }

  @Delete('businesses/:businessId/blocks/:blockId')
  deleteCourtBlock(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
  ) {
    return this.owner.deleteCourtBlock(request.authUser!.id, businessId, blockId);
  }

  @Post('businesses/:businessId/venues/:venueId/courts')
  createCourt(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Body() input: CreateCourtDto,
  ) {
    return this.owner.createCourt(request.authUser!.id, businessId, venueId, input);
  }

  @Patch('businesses/:businessId/courts/:courtId/configuration')
  updateCourtConfiguration(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Param('courtId', ParseUUIDPipe) courtId: string,
    @Body() input: CreateCourtDto,
  ) {
    return this.owner.updateCourtConfiguration(request.authUser!.id, businessId, courtId, input);
  }

  @Post('businesses/:businessId/venues/:venueId/submit')
  submitVenue(
    @Req() request: Request,
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
  ) {
    return this.owner.submitVenue(request.authUser!.id, businessId, venueId);
  }
}
