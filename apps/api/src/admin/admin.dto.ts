import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ReviewBusinessDto {
  @IsIn(['approved', 'rejected', 'suspended'])
  outcome!: 'approved' | 'rejected' | 'suspended';

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

export class CreateSportDto {
  @IsString()
  @Matches(/^[a-z0-9_-]+$/)
  @MaxLength(80)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
}

export class UpdateSportDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateUserActiveDto {
  @IsBoolean()
  active!: boolean;
}
