import { LimitPricingService } from './limit-pricing.service';

function baseInput(overrides: Partial<Parameters<LimitPricingService['price']>[0]> = {}) {
  return {
    monthlyIncome: 50000,
    annualIncome: 600000,
    existingObligations: 5000,
    foirCap: 0.55,
    tenureMonths: 36,
    annualInterestRate: 0.14,
    incomeMultiplier: 10,
    productCeiling: 2_000_000,
    riskGrade: 'B1',
    ...overrides,
  };
}

describe('LimitPricingService', () => {
  let service: LimitPricingService;

  beforeEach(() => {
    service = new LimitPricingService();
  });

  describe('annuityFactor', () => {
    it('equals the tenure when the rate is zero', () => {
      expect(service.annuityFactor(0, 36)).toBe(36);
    });

    it('matches the closed-form single-period case: (1-(1+r)^-1)/r = 1/(1+r)', () => {
      expect(service.annuityFactor(0.1, 1)).toBeCloseTo(1 / 1.1, 10);
    });
  });

  describe('spreadForGrade', () => {
    it.each([
      ['A1', 0],
      ['A2', 0.0075],
      ['B1', 0.015],
      ['B2', 0.0225],
      ['C1', 0.035],
      ['C2', 0.05],
    ])('returns the pricing-grid spread for grade %s', (grade, expected) => {
      expect(service.spreadForGrade(grade)).toBeCloseTo(expected as number);
    });

    it('throws for D grade (never priced -- policy declines it first)', () => {
      expect(() => service.spreadForGrade('D')).toThrow();
    });
  });

  describe('price', () => {
    it('computes maxEmi as monthlyIncome * foirCap - existingObligations', () => {
      const result = service.price(baseInput());
      expect(result.maxEmi).toBe(Math.round(50000 * 0.55 - 5000));
    });

    it('never lets maxEmi go negative when obligations exceed the FOIR-capped income', () => {
      const result = service.price(baseInput({ existingObligations: 100000 }));
      expect(result.maxEmi).toBe(0);
      expect(result.limit).toBe(0);
    });

    it('caps the limit at the product ceiling when affordability and income allow more', () => {
      const result = service.price(
        baseInput({ monthlyIncome: 5_000_000, annualIncome: 60_000_000, productCeiling: 500_000 }),
      );
      expect(result.limit).toBe(500_000);
    });

    it('caps the limit at incomeMultiplier * annualIncome when that is the binding constraint', () => {
      const result = service.price(
        baseInput({ incomeMultiplier: 1, annualIncome: 600_000, productCeiling: 50_000_000 }),
      );
      expect(result.limit).toBeLessThanOrEqual(600_000);
    });

    it('floors the limit to the nearest 10,000', () => {
      const result = service.price(baseInput());
      expect(result.limit % 10_000).toBe(0);
    });

    it('a riskier grade (higher spread) never produces a larger limit than a safer one, all else equal', () => {
      const safe = service.price(baseInput({ riskGrade: 'A1' }));
      const risky = service.price(baseInput({ riskGrade: 'C2' }));
      expect(risky.limit).toBeLessThanOrEqual(safe.limit);
      expect(risky.interestRate).toBeGreaterThan(safe.interestRate);
    });

    it('interest rate is base rate plus the grade spread', () => {
      const result = service.price(baseInput({ annualInterestRate: 0.14, riskGrade: 'B2' }));
      expect(result.interestRate).toBeCloseTo(0.14 + 0.0225, 6);
    });
  });
});
