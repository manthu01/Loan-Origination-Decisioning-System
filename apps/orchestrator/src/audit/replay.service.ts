import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { RulesEngineService } from '../common/rules-engine.service';
import { PolicyDocument, RuleEvaluationContext } from '../common/rules-engine.types';
import { RawApplicationPayload, BureauPayload } from '../common/domain.types';
import { LimitPricingService } from '../applications/stages/limit-pricing.service';
import { buildScoringFeatures, ScoringClientService } from '../applications/stages/scoring-client.service';
import { deriveAge } from '../applications/stages/kyc.service';

export interface ReplayDifference {
  field: string;
  original: unknown;
  replayed: unknown;
}

export interface ReplayResult {
  decisionId: string;
  applicationId: string;
  policyVersion: string;
  modelVersion: string;
  matches: boolean;
  differences: ReplayDifference[];
}

/**
 * Re-runs a decision's deterministic stages (SCORE, RULES, LIMIT, PRICE) against the
 * exact policy version and model version recorded on it, and diffs the result against
 * what was actually stored. The BUREAU stage is NOT re-executed -- the mock's timeout/
 * error simulation is deliberately non-deterministic (see bureau.service.ts), so replay
 * reuses the bureau data captured in that decision's own DecisionEvent, which is the
 * correct "what did the pipeline actually see" input for reproducing a past decision.
 * A mismatch here means something in the deterministic path drifted -- a scoring service
 * upgrade, a policy row mutated out of band, or a real bug -- which is the whole point of
 * being able to run this.
 */
@Injectable()
export class ReplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rulesEngine: RulesEngineService,
    private readonly scoringClient: ScoringClientService,
    private readonly limitPricing: LimitPricingService,
  ) {}

  async replay(decisionId: string): Promise<ReplayResult> {
    const decision = await this.prisma.decision.findUnique({
      where: { id: decisionId },
      include: { application: true, policyVersion: true, modelVersion: true },
    });
    if (!decision) throw new NotFoundException(`decision ${decisionId} not found`);

    const bureauEvent = await this.prisma.decisionEvent.findFirst({
      where: { applicationId: decision.applicationId, stage: 'BUREAU' },
      orderBy: { id: 'desc' },
    });
    if (!bureauEvent) throw new NotFoundException(`no BUREAU event recorded for application ${decision.applicationId}`);
    const bureau = JSON.parse(bureauEvent.output) as BureauPayload;

    const payload = decision.application.payload as unknown as RawApplicationPayload;
    const age = deriveAge(new Date(payload.applicant.dob), decision.createdAt);
    const applicantWithAge = { ...payload.applicant, age };

    const scoringFeatures = buildScoringFeatures(applicantWithAge, bureau);
    const score = await this.scoringClient.score(decision.applicationId, scoringFeatures);

    const policyDoc: PolicyDocument = {
      policyVersion: decision.policyVersion.version,
      product: decision.policyVersion.product,
      rules: decision.policyVersion.rules as unknown as PolicyDocument['rules'],
    };
    const ruleContext: RuleEvaluationContext = {
      applicant: applicantWithAge as unknown as Record<string, unknown>,
      application: payload.application as unknown as Record<string, unknown>,
      bureau: bureau as unknown as Record<string, unknown>,
      score: { value: score.score },
    };
    const ruleResult = this.rulesEngine.evaluate(policyDoc, ruleContext);

    let approvedAmount: number | null = null;
    let interestRate: number | null = null;
    if (ruleResult.outcome === 'APPROVE') {
      const priced = this.limitPricing.price({
        monthlyIncome: payload.applicant.monthlyIncome,
        annualIncome: payload.applicant.monthlyIncome * 12,
        existingObligations: payload.applicant.obligations,
        foirCap: 0.55,
        tenureMonths: payload.application.tenureMonths,
        annualInterestRate: 0.14,
        incomeMultiplier: 10,
        productCeiling: 2_000_000,
        riskGrade: score.riskGrade,
      });
      approvedAmount = priced.limit;
      interestRate = priced.interestRate;
    }

    const differences: ReplayDifference[] = [];
    const check = (field: string, original: unknown, replayed: unknown) => {
      if (JSON.stringify(original) !== JSON.stringify(replayed)) {
        differences.push({ field, original, replayed });
      }
    };
    check('outcome', decision.outcome, ruleResult.outcome);
    check('score', decision.score, score.score);
    check('riskGrade', decision.riskGrade, score.riskGrade);
    check('reasonCodes', [...decision.reasonCodes].sort(), [...ruleResult.reasonCodes].sort());
    check('approvedAmount', decision.approvedAmount ? Number(decision.approvedAmount) : null, approvedAmount);
    check('interestRate', decision.interestRate ? Number(decision.interestRate) : null, interestRate);

    return {
      decisionId: decision.id,
      applicationId: decision.applicationId,
      policyVersion: decision.policyVersion.version,
      modelVersion: decision.modelVersion.name,
      matches: differences.length === 0,
      differences,
    };
  }
}
