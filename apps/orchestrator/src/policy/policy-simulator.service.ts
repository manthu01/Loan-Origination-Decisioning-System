import { Injectable } from '@nestjs/common';
import { RulesEngineService } from '../common/rules-engine.service';
import { DecisionOutcome, PolicyDocument, SimulationRecord, SimulationResult, SplitSummary } from './policy.types';

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function summarize(outcomes: DecisionOutcome[], scores: number[], pds: number[]): SplitSummary {
  const n = outcomes.length;
  const approved = outcomes.filter((o) => o === 'APPROVE').length;
  const referred = outcomes.filter((o) => o === 'REFER').length;
  const declined = outcomes.filter((o) => o === 'DECLINE').length;
  const approvedPds = pds.filter((_, i) => outcomes[i] === 'APPROVE');

  return {
    approvalRate: round(n ? approved / n : 0),
    referRate: round(n ? referred / n : 0),
    declineRate: round(n ? declined / n : 0),
    avgScore: round(scores.reduce((a, b) => a + b, 0) / (n || 1), 1),
    projectedBadRate: round(approvedPds.length ? approvedPds.reduce((a, b) => a + b, 0) / approvedPds.length : 0),
  };
}

/**
 * Replays stored applications against a draft policy without writing any decisions, and
 * reports the swap set: which specific applicants change outcome. This is what a credit
 * head actually asks before approving a policy change -- "what's the approval-rate and
 * bad-rate impact, and who exactly flips" -- not just an aggregate delta.
 */
@Injectable()
export class PolicySimulatorService {
  constructor(private readonly rulesEngine: RulesEngineService) {}

  simulate(draftPolicy: PolicyDocument, records: SimulationRecord[]): SimulationResult {
    this.rulesEngine.validate(draftPolicy);

    const currentOutcomes: DecisionOutcome[] = [];
    const draftOutcomes: DecisionOutcome[] = [];
    const scores: number[] = [];
    const pds: number[] = [];

    let approvedNowDeclined = 0;
    let declinedNowApproved = 0;
    const byReason: Record<string, number> = {};

    for (const record of records) {
      const draftResult = this.rulesEngine.evaluate(draftPolicy, record.context);
      currentOutcomes.push(record.currentOutcome);
      draftOutcomes.push(draftResult.outcome);
      scores.push(record.score);
      pds.push(record.probabilityOfDefault);

      if (record.currentOutcome === 'APPROVE' && draftResult.outcome === 'DECLINE') {
        approvedNowDeclined += 1;
        for (const reason of draftResult.reasonCodes) {
          byReason[reason] = (byReason[reason] ?? 0) + 1;
        }
      } else if (record.currentOutcome === 'DECLINE' && draftResult.outcome === 'APPROVE') {
        declinedNowApproved += 1;
      }
    }

    const current = summarize(currentOutcomes, scores, pds);
    const draft = summarize(draftOutcomes, scores, pds);

    return {
      current,
      draft,
      delta: {
        approvalRate: round(draft.approvalRate - current.approvalRate),
        projectedBadRate: round(draft.projectedBadRate - current.projectedBadRate),
      },
      swapSet: { approvedNowDeclined, declinedNowApproved, byReason },
      sampleSize: records.length,
    };
  }
}
