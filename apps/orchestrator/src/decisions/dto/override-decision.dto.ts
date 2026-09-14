import { IsIn, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class OverrideDecisionDto {
  @IsIn(['APPROVE', 'DECLINE'])
  newOutcome!: 'APPROVE' | 'DECLINE';

  @IsString()
  @MinLength(10, { message: 'justification must be at least 10 characters -- "looks fine" is not a reason' })
  justification!: string;

  @IsString()
  @IsNotEmpty()
  proposedBy!: string;

  @IsString()
  @IsNotEmpty()
  approvedBy!: string;
}
