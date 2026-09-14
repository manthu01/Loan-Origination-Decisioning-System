import { Injectable } from '@nestjs/common';

export interface LimitPricingInput {
  monthlyIncome: number;
  annualIncome: number;
  existingObligations: number;
  foirCap: number; // e.g. 0.55
  tenureMonths: number;
  annualInterestRate: number; // e.g. 0.14 for 14% p.a.
  incomeMultiplier: number; // cap: limit <= incomeMultiplier * annualIncome
  productCeiling: number;
  riskGrade: string;
}

export interface LimitPricingResult {
  maxEmi: number;
  limit: number;
  interestRate: number;
}

const GRADE_SPREADS: Record<string, number> = {
  A1: 0.0,
  A2: 0.0075,
  B1: 0.015,
  B2: 0.0225,
  C1: 0.035,
  C2: 0.05,
};

/**
 * FOIR-based limit assignment and risk-based pricing. A grid, not a formula, for the
 * spread -- see MODEL_CARD.md / docs/design-doc.md for why: a grid is auditable by a
 * pricing committee line by line, a continuous formula is not.
 */
@Injectable()
export class LimitPricingService {
  annuityFactor(monthlyRate: number, tenureMonths: number): number {
    if (monthlyRate === 0) return tenureMonths;
    return (1 - Math.pow(1 + monthlyRate, -tenureMonths)) / monthlyRate;
  }

  /** D-grade (PD > 12%) never reaches pricing -- the SCORE_FLOOR policy rule declines it
   * before this stage runs. If it ever does, treat it as un-priceable. */
  spreadForGrade(riskGrade: string): number {
    const spread = GRADE_SPREADS[riskGrade];
    if (spread === undefined) {
      throw new Error(`grade ${riskGrade} is not priced (D grade should have been declined by policy)`);
    }
    return spread;
  }

  price(input: LimitPricingInput): LimitPricingResult {
    const interestRate = input.annualInterestRate + this.spreadForGrade(input.riskGrade);
    const monthlyRate = interestRate / 12;

    const maxEmi = Math.max(0, input.monthlyIncome * input.foirCap - input.existingObligations);
    const affordabilityLimit = maxEmi * this.annuityFactor(monthlyRate, input.tenureMonths);
    const incomeCap = input.incomeMultiplier * input.annualIncome;

    const limit = Math.floor(Math.min(affordabilityLimit, incomeCap, input.productCeiling) / 10_000) * 10_000;

    return { maxEmi: Math.round(maxEmi), limit: Math.max(0, limit), interestRate: Math.round(interestRate * 10000) / 10000 };
  }
}
