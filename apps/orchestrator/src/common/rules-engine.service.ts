import { Injectable, Logger } from '@nestjs/common';
import { Parser } from 'expr-eval';
import {
  DecisionOutcome,
  FiredRule,
  PolicyDocument,
  RuleEvaluationContext,
  RuleEvaluationResult,
} from './rules-engine.types';

export class RuleEvaluationError extends Error {
  constructor(
    public readonly ruleId: string,
    cause: unknown,
  ) {
    super(`rule ${ruleId} failed to evaluate: ${(cause as Error)?.message ?? cause}`);
  }
}

/**
 * Evaluates policy rules against an application context.
 *
 * Deliberately does NOT use eval() or new Function(): policy JSON is user-editable data
 * (credit-ops teams edit and activate it through the console), so evaluating it as
 * arbitrary JavaScript would be a remote-code-execution hole. expr-eval parses a
 * restricted arithmetic/comparison/boolean grammar with no access to the JS runtime,
 * globals, or object prototypes -- it can only read the plain-data context passed to it.
 */
@Injectable()
export class RulesEngineService {
  private readonly logger = new Logger(RulesEngineService.name);
  private readonly parser = new Parser();

  evaluate(policy: PolicyDocument, context: RuleEvaluationContext): RuleEvaluationResult {
    const sortedRules = [...policy.rules].sort((a, b) => a.priority - b.priority);

    let outcome: DecisionOutcome = 'APPROVE';
    const reasonCodes: string[] = [];
    const firedRules: FiredRule[] = [];

    for (const rule of sortedRules) {
      let passed: boolean;
      try {
        passed = !!this.parser.evaluate(rule.expr, context as unknown as Record<string, any>);
      } catch (cause) {
        throw new RuleEvaluationError(rule.id, cause);
      }

      if (passed) continue;

      firedRules.push({ id: rule.id, onFail: rule.onFail, reason: rule.reason });
      reasonCodes.push(rule.reason);

      if (rule.onFail === 'DECLINE') {
        outcome = 'DECLINE';
        this.logger.debug(`policy ${policy.policyVersion}: rule ${rule.id} declined, short-circuiting`);
        break; // DECLINE short-circuits -- no further rules matter, and outcome can never
        // revert to REFER/APPROVE below since we exit the loop immediately
      }

      // REFER is sticky: it downgrades the outcome but every remaining rule still runs,
      // so a referred application still surfaces every reason code, not just the first.
      // Reaching here means no DECLINE has fired yet (that path always breaks above).
      outcome = 'REFER';
    }

    return { outcome, reasonCodes, firedRules };
  }

  /** Throws if any rule's expression fails to parse -- used at draft-save and
   * activation time so a syntax error is caught long before an application hits it. */
  validate(policy: PolicyDocument): void {
    for (const rule of policy.rules) {
      try {
        this.parser.parse(rule.expr);
      } catch (cause) {
        throw new RuleEvaluationError(rule.id, cause);
      }
    }
  }
}
