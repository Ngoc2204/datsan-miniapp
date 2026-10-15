import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CommunityService } from './community.service';
import { CreateGameDto, GameQueryDto, ReportGameDto } from './community.dto';

@Controller('community/games')
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get('mine')
  @UseGuards(AuthGuard)
  listMine(@Req() request: Request) {
    return this.community.listMine(request.authUser!.id);
  }

  @Get()
  list(@Query() query: GameQueryDto) {
    return this.community.list(query);
  }

  @Get(':gameId')
  get(@Param('gameId', ParseUUIDPipe) gameId: string) {
    return this.community.get(gameId);
  }

  @Post()
  @UseGuards(AuthGuard)
  create(@Req() request: Request, @Body() input: CreateGameDto) {
    return this.community.create(request.authUser!.id, input);
  }

  @Post(':gameId/join')
  @UseGuards(AuthGuard)
  join(@Req() request: Request, @Param('gameId', ParseUUIDPipe) gameId: string) {
    return this.community.join(request.authUser!.id, gameId);
  }

  @Delete(':gameId/join')
  @UseGuards(AuthGuard)
  leave(@Req() request: Request, @Param('gameId', ParseUUIDPipe) gameId: string) {
    return this.community.leave(request.authUser!.id, gameId);
  }

  @Post(':gameId/close')
  @UseGuards(AuthGuard)
  close(@Req() request: Request, @Param('gameId', ParseUUIDPipe) gameId: string) {
    return this.community.close(request.authUser!.id, gameId);
  }

  @Post(':gameId/report')
  @UseGuards(AuthGuard)
  report(
    @Req() request: Request,
    @Param('gameId', ParseUUIDPipe) gameId: string,
    @Body() input: ReportGameDto,
  ) {
    return this.community.report(request.authUser!.id, gameId, input);
  }
}
