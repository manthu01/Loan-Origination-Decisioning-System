import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { RulesEngineService } from '../common/rules-engine.service';
import { PolicySimulatorService } from './policy-simulator.service';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';

@Module({
  controllers: [PolicyController],
  providers: [PolicyService, PolicySimulatorService, RulesEngineService, PrismaService],
  exports: [PolicyService, RulesEngineService],
})
export class PolicyModule {}
