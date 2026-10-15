import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateGameDto {
  @IsUUID()
  venueId!: string;

  @IsString()
  @IsString()
  @MaxLength(80)
  sportCode!: string;

  @IsDateString({ strict: true })
  startsAt!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(100)
  targetPlayers!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class GameQueryDto {
  @IsOptional()
  @IsString()
  @IsString()
  @MaxLength(80)
  sport?: string;

  @IsOptional()
  @IsUUID()
  venueId?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  startsAfter?: string;
}

export class ReportGameDto {
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;
}

export class ReviewReportDto {
  @IsIn(['resolved', 'dismissed'])
  outcome!: 'resolved' | 'dismissed';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resolutionNote?: string;
}
