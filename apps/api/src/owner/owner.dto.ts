import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested, IsEmail, IsUUID, IsDateString, IsUrl } from 'class-validator';

export class CreateVenueDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  address!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^[a-z0-9_-]+$/, { each: true })
  sportCodes!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  mediaUrls?: string[];
}

export class OperatingHourDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  opensAt!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  closesAt!: string;
}

export class PriceRuleDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startsAt!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endsAt!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  pricePerHour!: number;
}

export class CreateCourtDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  courtType?: string;

  @IsString()
  @Matches(/^[a-z0-9_-]+$/)
  sportCode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(15)
  defaultDurationMinutes!: number;

  @Type(() => Number)
  @IsInt()
  @Min(15)
  minimumDurationMinutes!: number;

  @Type(() => Number)
  @IsInt()
  @Min(15)
  maximumDurationMinutes!: number;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  slotIntervalMinutes!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OperatingHourDto)
  operatingHours!: OperatingHourDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PriceRuleDto)
  priceRules!: PriceRuleDto[];
}

export class OwnerBookingQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;

  @IsOptional()
  @IsUUID()
  venueId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['pending_payment', 'confirmed', 'cancelled', 'completed', 'expired'])
  status?: string;
}

export class ManualBookingDto {
  @IsUUID()
  courtId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime!: string;

  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(600)
  durationMinutes!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactName!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(30)
  contactPhone!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;
}

export class UpdateBookingStatusDto {
  @IsIn(['cancelled', 'completed'])
  status!: 'cancelled' | 'completed';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateVenueDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  mediaUrls?: string[];
}

export class CreateCourtBlockDto {
  @IsDateString({ strict: true })
  startsAt!: string;

  @IsDateString({ strict: true })
  endsAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsIn(['maintenance', 'event', 'external_booking'])
  source?: 'maintenance' | 'event' | 'external_booking';
}


export class CourtBlocksQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}


export class UpdateBusinessDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName!: string;
}

export class AssignStaffDto {
  @IsUUID()
  venueId!: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsIn(['manager', 'staff'])
  venueRole!: 'manager' | 'staff';
}
