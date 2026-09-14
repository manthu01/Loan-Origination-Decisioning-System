import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PolicySimulatorService } from './policy-simulator.service';
import { PolicyService } from './policy.service';
import { ActivatePolicyDto, CreatePolicyDto, SimulatePolicyDto } from './dto/create-policy.dto';

const DEFAULT_SAMPLE_SIZE = 10_000;

@Controller('policy')
export class PolicyController {
  constructor(
    private readonly policyService: PolicyService,
    private readonly simulator: PolicySimulatorService,
  ) {}

  @Post()
  create(@Body() dto: CreatePolicyDto) {
    return this.policyService.createDraft(dto);
  }

  @Get()
  list(@Query('product') product?: string, @Query('status') status?: string) {
    return this.policyService.list(product, status);
  }

  @Get('active')
  active(@Query('product') product: string) {
    return this.policyService.findActive(product);
  }

  @Get(':version')
  get(@Param('version') version: string) {
    return this.policyService.findByVersion(version);
  }

  @Post(':version/activate')
  activate(@Param('version') version: string, @Body() dto: ActivatePolicyDto) {
    return this.policyService.activate(version, dto.approvedBy);
  }

  @Post('simulate')
  async simulate(@Body() dto: SimulatePolicyDto) {
    const sampleSize = dto.sampleSize ?? DEFAULT_SAMPLE_SIZE;
    const records = await this.policyService.getSimulationRecords(dto.product, sampleSize);
    return this.simulator.simulate({ policyVersion: 'draft', product: dto.product, rules: dto.rules }, records);
  }
}
