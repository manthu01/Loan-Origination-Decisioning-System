import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HashChainService } from '../common/hash-chain.service';
import { PrismaService } from '../common/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { RulesEngineService } from '../common/rules-engine.service';
import { PolicyDocument, RuleEvaluationContext } from '../common/rules-engine.types';
import { CreateApplicationDto } from './dto/create-application.dto';
import { BureauClientService } from './stages/bureau.service';
import { DedupeService } from './stages/dedupe.service';
import { deriveAge, KycService } from './stages/kyc.service';
import { LimitPricingService } from './stages/limit-pricing.service';
import { buildScoringFeatures, ScoringClientService } from './stages/scoring-client.service';

// Not part of the versioned policy JSON -- the rules engine decides APPROVE/REFER/DECLINE
// only. Limit/pricing parameters are a separate, simpler config axis for this project;
// a real bank would likely version these too, but that's beyond this project's scope.
const PRICING_DEFAULTS = {
  foirCap: 0.55,
  annualInterestRate: 0.14,
  incomeMultiplier: 10,
  productCeilings: { PL: 2_000_000, BL: 5_000_000, AUTO: 3_000_000 } as Record<string, number>,
};

export interface SubmitResult {
  applicationId: string;
  status: string;
  decision?: {
    outcome: string;
    score: number;
    probabilityOfDefault: number;
    riskGrade: string;
    approvedAmount: number | null;
    interestRate: number | null;
    reasonCodes: string[];
  };
}

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dedupeService: DedupeService,
    private readonly kycService: KycService,
    private readonly bureauClient: BureauClientService,
    private readonly scoringClient: ScoringClientService,
    private readonly policyService: PolicyService,
    private readonly rulesEngine: RulesEngineService,
    private readonly limitPricing: LimitPricingService,
    private readonly hashChain: HashChainService,
  ) {}

  async submit(dto: CreateApplicationDto): Promise<SubmitResult> {
    // 1. DEDUPE -- hash of (PAN + DOB + mobile); rejects if an open application exists.
    // Runs before any Application row for this submission exists, so a hard failure here
    // never leaves an orphaned row blocking the applicant's next real attempt. (There is
    // a small TOCTOU race window between this check and step 3's create under heavy
    // concurrent duplicate submissions -- acceptable for this project's scope; closing it
    // fully would mean wrapping both in one transaction with an advisory lock, the same
    // pattern HashChainService uses.)
    const dedupe = await this.dedupeService.run(dto.applicant);

    // 2. KYC -- format validation + server-derived age (never trust client-supplied age).
    const kyc = this.kycService.run(dto.applicant);

    // 3. Application row now exists; every later stage's DecisionEvent hangs off its id.
    const application = await this.prisma.application.create({
      data: {
        applicantId: dedupe.applicantId,
        product: dto.application.product,
        requestedAmount: dto.application.requestedAmount,
        tenureMonths: dto.application.tenureMonths,
        income: dto.applicant.monthlyIncome,
        obligations: dto.applicant.obligations,
        employmentType: dto.applicant.employmentType,
        payload: { applicant: dto.applicant, application: dto.application } as unknown as Prisma.InputJsonValue,
        status: 'PROCESSING',
      },
    });

    const applicantWithAge = { ...dto.applicant, age: kyc.age };

    // 4. BUREAU -- see bureau.service.ts for the circuit breaker / degraded-payload story.
    const bureauStart = Date.now();
    const bureau = await this.bureauClient.fetch(application.id);
    const bureauDurationMs = Date.now() - bureauStart;

    // 5. SCORE -- runs before RULES (deliberately reordered from the plan's numbered
    // list) because the policy's SCORE_FLOOR rule needs score.value to already exist.
    const scoringFeatures = buildScoringFeatures(applicantWithAge, bureau);
    const scoreStart = Date.now();
    const score = await this.scoringClient.score(application.id, scoringFeatures);
    const scoreDurationMs = Date.now() - scoreStart;

    // 6. RULES -- policy evaluation against the live ACTIVE policy for this product.
    const activePolicy = await this.policyService.findActive(dto.application.product);
    const policyDoc: PolicyDocument = {
      policyVersion: activePolicy.version,
      product: activePolicy.product,
      rules: activePolicy.rules as unknown as PolicyDocument['rules'],
    };
    const ruleContext: RuleEvaluationContext = {
      applicant: applicantWithAge as unknown as Record<string, unknown>,
      application: dto.application as unknown as Record<string, unknown>,
      bureau: bureau as unknown as Record<string, unknown>,
      score: { value: score.score },
    };
    const rulesStart = Date.now();
    const ruleResult = this.rulesEngine.evaluate(policyDoc, ruleContext);
    const rulesDurationMs = Date.now() - rulesStart;

    // 7. LIMIT + PRICE -- only meaningful for an approval.
    let limitResult: ReturnType<LimitPricingService['price']> | null = null;
    if (ruleResult.outcome === 'APPROVE') {
      limitResult = this.limitPricing.price({
        monthlyIncome: dto.applicant.monthlyIncome,
        annualIncome: dto.applicant.monthlyIncome * 12,
        existingObligations: dto.applicant.obligations,
        foirCap: PRICING_DEFAULTS.foirCap,
        tenureMonths: dto.application.tenureMonths,
        annualInterestRate: PRICING_DEFAULTS.annualInterestRate,
        incomeMultiplier: PRICING_DEFAULTS.incomeMultiplier,
        productCeiling: PRICING_DEFAULTS.productCeilings[dto.application.product] ?? 1_000_000,
        riskGrade: score.riskGrade,
      });
    }

    const reasonCodes = Array.from(
      new Set([...ruleResult.reasonCodes, ...(ruleResult.outcome !== 'APPROVE' ? score.reasonCodes.map((r) => r.code) : [])]),
    );

    // 8. PERSIST -- one transaction: every stage's DecisionEvent (hash-chained), the
    // Decision row, and the Application status flip, committed together.
    const decision = await this.prisma.$transaction(async (tx) => {
      await this.hashChain.appendEvent(tx, {
        applicationId: application.id,
        stage: 'BUREAU',
        input: { applicantId: dedupe.applicantId },
        output: bureau,
        durationMs: bureauDurationMs,
      });
      await this.hashChain.appendEvent(tx, {
        applicationId: application.id,
        stage: 'SCORE',
        input: scoringFeatures,
        output: score,
        durationMs: scoreDurationMs,
      });
      await this.hashChain.appendEvent(tx, {
        applicationId: application.id,
        stage: 'RULES',
        input: ruleContext,
        output: ruleResult,
        durationMs: rulesDurationMs,
      });
      await this.hashChain.appendEvent(tx, {
        applicationId: application.id,
        stage: 'LIMIT',
        input: { outcome: ruleResult.outcome },
        output: limitResult ? { maxEmi: limitResult.maxEmi, limit: limitResult.limit } : { skipped: true },
        durationMs: 0,
      });
      await this.hashChain.appendEvent(tx, {
        applicationId: application.id,
        stage: 'PRICE',
        input: { riskGrade: score.riskGrade },
        output: limitResult ? { interestRate: limitResult.interestRate } : { skipped: true },
        durationMs: 0,
      });

      const modelVersionId = await this.ensureModelVersion(tx, score.modelVersion, 'SCORECARD');
      const challengerModelId = score.challenger
        ? await this.ensureModelVersion(tx, score.challenger.modelVersion, 'CHALLENGER')
        : null;

      const created = await tx.decision.create({
        data: {
          applicationId: application.id,
          outcome: ruleResult.outcome,
          score: score.score,
          probabilityOfDefault: score.probabilityOfDefault,
          riskGrade: score.riskGrade,
          approvedAmount: limitResult?.limit ?? null,
          interestRate: limitResult?.interestRate ?? null,
          reasonCodes,
          policyVersionId: activePolicy.id,
          modelVersionId,
          challengerScore: score.challenger?.score ?? null,
          challengerModelId,
          latencyMs: bureauDurationMs + scoreDurationMs + rulesDurationMs,
        },
      });

      await tx.application.update({ where: { id: application.id }, data: { status: 'DECIDED' } });

      await this.hashChain.appendEvent(tx, {
        applicationId: application.id,
        stage: 'PERSIST',
        input: {},
        output: { decisionId: created.id },
        durationMs: 0,
      });

      return created;
    });

    this.logger.log(`application ${application.id} decided ${decision.outcome} (score ${decision.score})`);

    return {
      applicationId: application.id,
      status: 'DECIDED',
      decision: {
        outcome: decision.outcome,
        score: decision.score,
        probabilityOfDefault: Number(decision.probabilityOfDefault),
        riskGrade: decision.riskGrade,
        approvedAmount: decision.approvedAmount ? Number(decision.approvedAmount) : null,
        interestRate: decision.interestRate ? Number(decision.interestRate) : null,
        reasonCodes: decision.reasonCodes,
      },
    };
  }

  async findById(id: string) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: {
        decisions: { orderBy: { createdAt: 'desc' } },
        events: { orderBy: { id: 'asc' } },
      },
    });
    if (!application) return null;
    // events store input/output as canonical JSON text (see hash-chain.service.ts) --
    // parse back to objects for API consumers; hash verification itself never goes
    // through this path, so this parsing has no bearing on chain integrity.
    return {
      ...application,
      events: application.events.map((e) => ({ ...e, input: JSON.parse(e.input), output: JSON.parse(e.output) })),
    };
  }

  private async ensureModelVersion(tx: Prisma.TransactionClient, name: string, kind: 'SCORECARD' | 'CHALLENGER') {
    const existing = await tx.modelVersion.findUnique({ where: { name } });
    if (existing) return existing.id;
    const created = await tx.modelVersion.create({
      data: { name, kind, artifactUri: `ml/scorecard/artifacts/${name}.json`, metrics: {}, isChampion: kind === 'SCORECARD' },
    });
    return created.id;
  }
}
