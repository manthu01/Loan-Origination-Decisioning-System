import { DecisionOutcome } from './rules-engine.types';

/** A REFER/DECLINE's stored reason codes are the union of the policy rules that fired
 * and the scorecard's own point-contributor codes (an APPROVE has none of the latter --
 * there's nothing adverse to explain). Both the persist path (applications.service.ts)
 * and the replay path (audit/replay.service.ts) must build this union identically, or
 * replay reports a spurious divergence that isn't actually non-determinism. */
export function mergeReasonCodes(
  outcome: DecisionOutcome,
  ruleReasonCodes: string[],
  scoreReasonCodes: { code: string }[],
): string[] {
  return Array.from(
    new Set([...ruleReasonCodes, ...(outcome !== 'APPROVE' ? scoreReasonCodes.map((r) => r.code) : [])]),
  );
}
