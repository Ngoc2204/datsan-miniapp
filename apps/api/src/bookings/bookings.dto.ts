import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateBookingDto {
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

  @IsIn(['onsite', 'demo'])
  paymentMethod!: 'onsite' | 'demo';

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactName!: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(6)
  @MaxLength(30)
  contactPhone!: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;
}

export class DemoPaymentDto {
  @IsIn(['succeeded', 'failed'])
  outcome!: 'succeeded' | 'failed';
}
