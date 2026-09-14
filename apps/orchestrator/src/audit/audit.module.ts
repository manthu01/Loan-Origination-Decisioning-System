import { Module } from '@nestjs/common';
import { HashChainService } from '../common/hash-chain.service';
import { PrismaService } from '../common/prisma.service';
import { RulesEngineService } from '../common/rules-engine.service';
import { LimitPricingService } from '../applications/stages/limit-pricing.service';
import { ScoringClientService } from '../applications/stages/scoring-client.service';
import { AuditController } from './audit.controller';
import { ReplayService } from './replay.service';

@Module({
  controllers: [AuditController],
  providers: [HashChainService, PrismaService, RulesEngineService, ScoringClientService, LimitPricingService, ReplayService],
})
export class AuditModule {}
