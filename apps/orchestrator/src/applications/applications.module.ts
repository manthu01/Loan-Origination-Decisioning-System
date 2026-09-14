import { Module } from '@nestjs/common';
import { HashChainService } from '../common/hash-chain.service';
import { IdempotencyService } from '../common/idempotency.service';
import { PrismaService } from '../common/prisma.service';
import { RulesEngineService } from '../common/rules-engine.service';
import { DecisionsModule } from '../decisions/decisions.module';
import { PolicyModule } from '../policy/policy.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { BureauClientService, BureauMockService } from './stages/bureau.service';
import { DedupeService } from './stages/dedupe.service';
import { KycService } from './stages/kyc.service';
import { LimitPricingService } from './stages/limit-pricing.service';
import { ScoringClientService } from './stages/scoring-client.service';

@Module({
  imports: [PolicyModule, DecisionsModule],
  controllers: [ApplicationsController],
  providers: [
    ApplicationsService,
    PrismaService,
    HashChainService,
    IdempotencyService,
    RulesEngineService,
    DedupeService,
    KycService,
    BureauMockService,
    BureauClientService,
    ScoringClientService,
    LimitPricingService,
  ],
})
export class ApplicationsModule {}
