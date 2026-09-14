import { RulesEngineService, RuleEvaluationError } from './rules-engine.service';
import { PolicyDocument, RuleEvaluationContext } from './rules-engine.types';

const samplePolicy: PolicyDocument = {
  policyVersion: '2026.03.1',
  product: 'PL',
  rules: [
    { id: 'AGE_MIN', priority: 10, expr: 'applicant.age >= 21', onFail: 'DECLINE', reason: 'R101' },
    {
      id: 'AGE_MAX_AT_MATURITY',
      priority: 11,
      expr: 'applicant.age + (application.tenureMonths / 12) <= 60',
      onFail: 'DECLINE',
      reason: 'R102',
    },
    { id: 'MIN_INCOME', priority: 20, expr: 'applicant.monthlyIncome >= 25000', onFail: 'DECLINE', reason: 'R110' },
    {
      id: 'FOIR_CAP',
      priority: 30,
      expr: '(applicant.obligations + application.estimatedEmi) / applicant.monthlyIncome <= 0.55',
      onFail: 'REFER',
      reason: 'R204',
    },
    { id: 'THIN_FILE', priority: 40, expr: 'bureau.tradelines >= 1', onFail: 'REFER', reason: 'R310' },
    { id: 'RECENT_DELINQ', priority: 41, expr: 'bureau.dpd30PlusLast12M == 0', onFail: 'DECLINE', reason: 'R320' },
    { id: 'ENQUIRY_VELOCITY', priority: 42, expr: 'bureau.enquiriesLast3M <= 6', onFail: 'REFER', reason: 'R330' },
    { id: 'SCORE_FLOOR', priority: 50, expr: 'score.value >= 620', onFail: 'DECLINE', reason: 'R400' },
  ],
};

function baseContext(overrides: Partial<RuleEvaluationContext> = {}): RuleEvaluationContext {
  return {
    applicant: { age: 30, monthlyIncome: 50000, obligations: 5000 },
    application: { tenureMonths: 36, estimatedEmi: 8000 },
    bureau: { tradelines: 3, dpd30PlusLast12M: 0, enquiriesLast3M: 2 },
    score: { value: 700 },
    ...overrides,
  };
}

describe('RulesEngineService', () => {
  let engine: RulesEngineService;

  beforeEach(() => {
    engine = new RulesEngineService();
  });

  it('approves a clean applicant with no rule failures', () => {
    const result = engine.evaluate(samplePolicy, baseContext());
    expect(result.outcome).toBe('APPROVE');
    expect(result.reasonCodes).toEqual([]);
  });

  it('declines and short-circuits on the first DECLINE, skipping later rules', () => {
    const result = engine.evaluate(
      samplePolicy,
      baseContext({ applicant: { age: 19, monthlyIncome: 50000, obligations: 5000 } }),
    );
    expect(result.outcome).toBe('DECLINE');
    expect(result.reasonCodes).toEqual(['R101']);
    expect(result.firedRules).toHaveLength(1); // AGE_MAX_AT_MATURITY, MIN_INCOME etc never ran
  });

  it('is sticky on REFER: keeps evaluating and collects every reason code', () => {
    const result = engine.evaluate(
      samplePolicy,
      baseContext({
        application: { tenureMonths: 36, estimatedEmi: 25000 }, // fails FOIR_CAP -> REFER
        bureau: { tradelines: 3, dpd30PlusLast12M: 0, enquiriesLast3M: 9 }, // fails ENQUIRY_VELOCITY -> REFER
      }),
    );
    expect(result.outcome).toBe('REFER');
    expect(result.reasonCodes).toEqual(['R204', 'R330']);
  });

  it('a later DECLINE overrides an earlier REFER', () => {
    const result = engine.evaluate(
      samplePolicy,
      baseContext({
        application: { tenureMonths: 36, estimatedEmi: 25000 }, // REFER (R204)
        score: { value: 500 }, // DECLINE (R400)
      }),
    );
    expect(result.outcome).toBe('DECLINE');
    expect(result.reasonCodes).toEqual(['R204', 'R400']);
  });

  it('evaluates rules in priority order regardless of array order', () => {
    const reordered: PolicyDocument = {
      ...samplePolicy,
      rules: [...samplePolicy.rules].reverse(),
    };
    const result = engine.evaluate(reordered, baseContext({ applicant: { age: 19, monthlyIncome: 50000, obligations: 5000 } }));
    expect(result.reasonCodes).toEqual(['R101']); // AGE_MIN (priority 10) still fires and short-circuits first
  });

  it('cannot execute arbitrary JavaScript through a malicious expr', () => {
    const maliciousPolicy: PolicyDocument = {
      policyVersion: 'evil',
      product: 'PL',
      rules: [
        {
          id: 'EVIL',
          priority: 1,
          expr: 'applicant.constructor.constructor("return process")()',
          onFail: 'DECLINE',
          reason: 'R999',
        },
      ],
    };
    expect(() => engine.evaluate(maliciousPolicy, baseContext())).toThrow(RuleEvaluationError);
  });

  it('validate() throws on a malformed expression without evaluating anything', () => {
    const brokenPolicy: PolicyDocument = {
      policyVersion: 'broken',
      product: 'PL',
      rules: [{ id: 'BROKEN', priority: 1, expr: 'applicant.age >=>', onFail: 'DECLINE', reason: 'R000' }],
    };
    expect(() => engine.validate(brokenPolicy)).toThrow(RuleEvaluationError);
  });
});
