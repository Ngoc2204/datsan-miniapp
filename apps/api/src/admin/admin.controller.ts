import { Controller, Get, Param, Patch, Query, Req, UseGuards, Body, ParseUUIDPipe, Post } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminService } from './admin.service';
import { CreateSportDto, ReviewBusinessDto, UpdateSportDto, UpdateUserActiveDto } from './admin.dto';
import { ReviewReportDto } from '../community/community.dto';

@Controller('admin')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('audit-log')
  auditLog() {
    return this.admin.listAuditLog();
  }

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('sports')
  listSports() {
    return this.admin.listSports();
  }

  @Post('sports')
  createSport(@Body() input: CreateSportDto) {
    return this.admin.createSport(input);
  }

  @Patch('sports/:id')
  updateSport(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateSportDto) {
    return this.admin.updateSport(id, input);
  }

  @Get('users')
  listUsers(@Query('q') query?: string) {
    return this.admin.listUsers(query);
  }

  @Patch('users/:id/active')
  setUserActive(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request, @Body() input: UpdateUserActiveDto) {
    return this.admin.setUserActive(id, request.authUser!.id, input);
  }

  @Get('venues')
  listVenues(@Query('status') status?: string) {
    return this.admin.listVenues(status);
  }

  @Patch('venues/:id/review')
  reviewVenue(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Body() input: ReviewBusinessDto,
  ) {
    return this.admin.reviewVenue(id, request.authUser!.id, input);
  }

  @Get('community/reports')
  listCommunityReports(@Query('status') status?: string) {
    return this.admin.listCommunityReports(status);
  }

  @Patch('community/reports/:id/review')
  reviewCommunityReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Body() input: ReviewReportDto,
  ) {
    return this.admin.reviewCommunityReport(id, request.authUser!.id, input);
  }

  @Get('businesses')
  listBusinesses(@Query('status') status?: string) {
    return this.admin.listBusinesses(status);
  }

  @Patch('businesses/:id/review')
  reviewBusiness(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Body() input: ReviewBusinessDto,
  ) {
    return this.admin.reviewBusiness(id, request.authUser!.id, input);
  }
}
