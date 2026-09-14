import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class ApplicantDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  pan!: string;

  @IsString()
  @IsNotEmpty()
  dob!: string;

  @IsString()
  @IsNotEmpty()
  mobile!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsString()
  @IsIn(['SALARIED', 'SELF_EMPLOYED', 'GOVERNMENT'])
  employmentType!: string;

  @IsNumber()
  @Min(0)
  employmentTenureMonths!: number;

  @IsNumber()
  @Min(0)
  monthlyIncome!: number;

  @IsNumber()
  @Min(0)
  obligations!: number;

  @IsNumber()
  @Min(0)
  numDependents!: number;
}

export class ApplicationDetailsDto {
  @IsString()
  @IsIn(['PL', 'BL', 'AUTO'])
  product!: string;

  @IsNumber()
  @Min(1)
  requestedAmount!: number;

  @IsNumber()
  @Min(1)
  tenureMonths!: number;

  @IsNumber()
  @Min(0)
  estimatedEmi!: number;
}

export class CreateApplicationDto {
  @ValidateNested()
  @Type(() => ApplicantDto)
  applicant!: ApplicantDto;

  @ValidateNested()
  @Type(() => ApplicationDetailsDto)
  application!: ApplicationDetailsDto;
}
