export type RuleOutcome = 'DECLINE' | 'REFER';
export type DecisionOutcome = 'APPROVE' | 'REFER' | 'DECLINE';

export interface RuleDefinition {
  id: string;
  priority: number;
  expr: string;
  onFail: RuleOutcome;
  reason: string;
}

export interface PolicyDocument {
  policyVersion: string;
  product: string;
  rules: RuleDefinition[];
}

export interface FiredRule {
  id: string;
  onFail: RuleOutcome;
  reason: string;
}

export interface RuleEvaluationResult {
  outcome: DecisionOutcome;
  reasonCodes: string[];
  firedRules: FiredRule[];
}

export interface RuleEvaluationContext {
  applicant: Record<string, unknown>;
  application: Record<string, unknown>;
  bureau: Record<string, unknown>;
  score: Record<string, unknown>;
}
