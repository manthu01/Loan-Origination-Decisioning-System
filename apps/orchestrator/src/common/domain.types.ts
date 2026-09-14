/**
 * Canonical shape of Application.payload (Prisma Json column) and of the context every
 * pipeline stage builds on. Kept in one place so the applicant portal / seed script /
 * orchestrator pipeline / policy simulator all agree on field names -- a rule expr like
 * "applicant.age >= 21" only works if every producer of a context object uses this shape.
 */
export interface ApplicantPayload {
  fullName: string;
  dob: string; // ISO date
  age: number;
  mobile: string;
  email?: string;
  employmentType: string;
  monthlyIncome: number;
  obligations: number;
  numDependents: number;
}

export interface ApplicationPayload {
  product: string;
  requestedAmount: number;
  tenureMonths: number;
  estimatedEmi: number;
}

export interface RawApplicationPayload {
  applicant: ApplicantPayload;
  application: ApplicationPayload;
}

export interface BureauPayload {
  tradelines: number;
  dpd30PlusLast12M: number;
  enquiriesLast3M: number;
  oldestTradelineAgeMonths?: number;
  creditUtilization?: number;
  numPreviousDefaults?: number;
}

export interface ScorePayload {
  score: number;
  probabilityOfDefault: number;
  riskGrade: string;
  reasonCodes: { code: string; desc: string; pointImpact: number }[];
  modelVersion: string;
  challenger?: { score: number; probabilityOfDefault: number; modelVersion: string };
}
