import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CreateBookingDto, DemoPaymentDto } from './bookings.dto';
import { BookingsService } from './bookings.service';

@Controller('bookings')
@UseGuards(AuthGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('courts/:courtId')
  create(
    @Req() request: Request,
    @Param('courtId', ParseUUIDPipe) courtId: string,
    @Body() input: CreateBookingDto,
  ) {
    return this.bookings.create(request.authUser!.id, courtId, input);
  }

  @Get('mine')
  listMine(@Req() request: Request) {
    return this.bookings.listMine(request.authUser!.id);
  }

  @Post(':bookingId/demo-payment')
  demoPayment(
    @Req() request: Request,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() input: DemoPaymentDto,
  ) {
    return this.bookings.demoPayment(request.authUser!.id, bookingId, input);
  }

  @Post(':bookingId/cancel')
  cancel(
    @Req() request: Request,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ) {
    return this.bookings.cancel(request.authUser!.id, bookingId);
  }
}
