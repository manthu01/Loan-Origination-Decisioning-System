import { DecisionOutcome, PolicyDocument, RuleEvaluationContext } from '../common/rules-engine.types';

export { PolicyDocument, RuleEvaluationContext, DecisionOutcome };

/** One historical application's replay context: what the pipeline actually saw at
 * decision time, plus the outcome the currently-active policy produced for it. Kept
 * decoupled from Prisma so the simulator's math is unit-testable without a database. */
export interface SimulationRecord {
  applicationId: string;
  context: RuleEvaluationContext;
  currentOutcome: DecisionOutcome;
  probabilityOfDefault: number; // from the score already computed for this application
  score: number;
}

export interface SplitSummary {
  approvalRate: number;
  referRate: number;
  declineRate: number;
  avgScore: number;
  projectedBadRate: number; // mean PD among applicants this split would APPROVE
}

export interface SwapSet {
  approvedNowDeclined: number; // who you lose
  declinedNowApproved: number; // who you gain
  byReason: Record<string, number>;
}

export interface SimulationResult {
  current: SplitSummary;
  draft: SplitSummary;
  delta: { approvalRate: number; projectedBadRate: number };
  swapSet: SwapSet;
  sampleSize: number;
}
