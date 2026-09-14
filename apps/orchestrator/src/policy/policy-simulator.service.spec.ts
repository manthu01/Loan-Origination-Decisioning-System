import { RulesEngineService } from '../common/rules-engine.service';
import { PolicySimulatorService } from './policy-simulator.service';
import { PolicyDocument, SimulationRecord } from './policy.types';

const currentPolicy: PolicyDocument = {
  policyVersion: 'current',
  product: 'PL',
  rules: [{ id: 'SCORE_FLOOR', priority: 50, expr: 'score.value >= 620', onFail: 'DECLINE', reason: 'R400' }],
};

const stricterDraft: PolicyDocument = {
  policyVersion: 'draft',
  product: 'PL',
  rules: [{ id: 'SCORE_FLOOR', priority: 50, expr: 'score.value >= 680', onFail: 'DECLINE', reason: 'R400' }],
};

function record(applicationId: string, scoreValue: number, pd: number): SimulationRecord {
  const context = { applicant: {}, application: {}, bureau: {}, score: { value: scoreValue } };
  const engine = new RulesEngineService();
  const currentOutcome = engine.evaluate(currentPolicy, context).outcome;
  return { applicationId, context, currentOutcome, probabilityOfDefault: pd, score: scoreValue };
}

describe('PolicySimulatorService', () => {
  let simulator: PolicySimulatorService;

  beforeEach(() => {
    simulator = new PolicySimulatorService(new RulesEngineService());
  });

  it('reports approvedNowDeclined for applicants a stricter draft newly declines', () => {
    const records = [
      record('A1', 700, 0.02), // stays approved under both
      record('A2', 650, 0.03), // approved today (>=620), declined under stricter draft (<680)
      record('A3', 600, 0.05), // declined under both
    ];

    const result = simulator.simulate(stricterDraft, records);

    expect(result.current.approvalRate).toBeCloseTo(2 / 3);
    expect(result.draft.approvalRate).toBeCloseTo(1 / 3);
    expect(result.swapSet.approvedNowDeclined).toBe(1);
    expect(result.swapSet.declinedNowApproved).toBe(0);
    expect(result.swapSet.byReason).toEqual({ R400: 1 });
    expect(result.delta.approvalRate).toBeLessThan(0);
  });

  it('reports declinedNowApproved for a looser draft', () => {
    const looserDraft: PolicyDocument = {
      policyVersion: 'draft',
      product: 'PL',
      rules: [{ id: 'SCORE_FLOOR', priority: 50, expr: 'score.value >= 580', onFail: 'DECLINE', reason: 'R400' }],
    };
    const records = [record('A1', 600, 0.05)]; // declined today, approved under looser draft

    const result = simulator.simulate(looserDraft, records);

    expect(result.swapSet.declinedNowApproved).toBe(1);
    expect(result.swapSet.approvedNowDeclined).toBe(0);
    expect(result.draft.approvalRate).toBe(1);
  });

  it('projectedBadRate only averages PD over applicants that split would approve', () => {
    const records = [record('SAFE', 750, 0.01), record('RISKY', 750, 0.4)];
    const result = simulator.simulate(currentPolicy, records);
    // both approved under a policy this loose -- projectedBadRate is the mean of both
    expect(result.current.projectedBadRate).toBeCloseTo((0.01 + 0.4) / 2);
  });

  it('rejects a draft policy with an invalid rule expression before replaying anything', () => {
    const brokenDraft: PolicyDocument = {
      policyVersion: 'broken',
      product: 'PL',
      rules: [{ id: 'BAD', priority: 1, expr: 'score.value >=>', onFail: 'DECLINE', reason: 'R000' }],
    };
    expect(() => simulator.simulate(brokenDraft, [record('A1', 700, 0.01)])).toThrow();
  });
});
