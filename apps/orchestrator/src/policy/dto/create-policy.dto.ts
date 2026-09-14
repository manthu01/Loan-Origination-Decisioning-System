import { IsArray, IsIn, IsNotEmpty, IsString } from 'class-validator';
import { RuleDefinition } from '../../common/rules-engine.types';

export class CreatePolicyDto {
  @IsString()
  @IsNotEmpty()
  version!: string;

  @IsString()
  @IsIn(['PL', 'BL', 'AUTO'])
  product!: string;

  @IsArray()
  rules!: RuleDefinition[];

  @IsString()
  @IsNotEmpty()
  createdBy!: string;
}

export class ActivatePolicyDto {
  @IsString()
  @IsNotEmpty()
  approvedBy!: string;
}

export class SimulatePolicyDto {
  @IsString()
  @IsNotEmpty()
  product!: string;

  @IsArray()
  rules!: RuleDefinition[];

  sampleSize?: number;
}
