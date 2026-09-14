/**
 * Canonical shape of Application.payload (Prisma Json column) and of the context every
 * pipeline stage builds on. Kept in one place so the applicant portal / seed script /
 * orchestrator pipeline / policy simulator all agree on field names -- a rule expr like
 * "applicant.age >= 21" only works if every producer of a context object uses this shape.
 */
export interface ApplicantPayload {
  fullName: string;
  pan: string; // AAAAA9999A format, validated at KYC
  dob: string; // ISO date; age is derived server-side at KYC, never trusted from the client
  mobile: string;
  email?: string;
  employmentType: string;
  employmentTenureMonths: number;
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
  available: number; // 0 or 1 -- 0 means the bureau pull failed or the circuit was open;
  // see applications/stages/bureau.service.ts. A policy's BUREAU_UNAVAILABLE rule reads
  // this to REFER for manual bureau pull instead of scoring on absent data.
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
