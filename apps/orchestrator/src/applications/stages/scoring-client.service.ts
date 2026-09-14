import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ApplicantPayload, BureauPayload, ScorePayload } from '../../common/domain.types';

const SCORING_SERVICE_URL = process.env.SCORING_SERVICE_URL ?? 'http://localhost:8000';

/** Maps our domain context onto the scoring service's snake_case feature contract (see
 * apps/scoring-service/app/scorecard.py and app/challenger.py::CHALLENGER_FEATURES). The
 * champion only needs 4 of these; the rest are included so the shadow challenger can
 * score too -- see ScoringClientService.score for what happens when bureau is degraded. */
export function buildScoringFeatures(
  applicant: ApplicantPayload & { age: number },
  bureau: BureauPayload,
): Record<string, number> {
  return {
    age: applicant.age,
    monthly_income: applicant.monthlyIncome,
    employment_tenure_months: applicant.employmentTenureMonths,
    num_dependents: applicant.numDependents,
    obligations_to_income: applicant.monthlyIncome > 0 ? applicant.obligations / applicant.monthlyIncome : 3,
    tradelines: bureau.tradelines,
    oldest_tradeline_age_months: bureau.oldestTradelineAgeMonths ?? 0,
    credit_utilization: bureau.creditUtilization ?? 0,
    enquiries_last_3m: bureau.enquiriesLast3M,
    dpd30_plus_last_12m: bureau.dpd30PlusLast12M,
    num_previous_defaults: bureau.numPreviousDefaults ?? 0,
  };
}

@Injectable()
export class ScoringClientService {
  async score(applicationId: string, features: Record<string, unknown>): Promise<ScorePayload> {
    let response: Response;
    try {
      response = await fetch(`${SCORING_SERVICE_URL}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, features }),
      });
    } catch (cause) {
      throw new ServiceUnavailableException(`scoring service unreachable: ${(cause as Error).message}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new ServiceUnavailableException(`scoring service returned ${response.status}: ${body}`);
    }

    return (await response.json()) as ScorePayload;
  }
}
