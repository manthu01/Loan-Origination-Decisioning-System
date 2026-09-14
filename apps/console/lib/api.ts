const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      message = JSON.parse(body).message ?? body;
    } catch {
      // body wasn't JSON, use as-is
    }
    throw new ApiError(response.status, Array.isArray(message) ? message.join('; ') : message);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

// ---- types (mirror the orchestrator's response shapes) --------------------------------

export type Outcome = 'APPROVE' | 'REFER' | 'DECLINE';

export interface QueueRow {
  applicationId: string;
  decisionId: string;
  applicantName: string;
  product: string;
  status: string;
  outcome: Outcome;
  score: number;
  riskGrade: string;
  reasonCodes: string[];
  approvedAmount: number | null;
  createdAt: string;
}

export interface QueueResponse {
  total: number;
  rows: QueueRow[];
}

export interface DecisionEventRow {
  id: string;
  applicationId: string;
  stage: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  prevHash: string;
  hash: string;
  createdAt: string;
}

export interface ApplicationDetail {
  id: string;
  applicantId: string;
  product: string;
  requestedAmount: string;
  tenureMonths: number;
  income: string;
  obligations: string;
  employmentType: string;
  payload: { applicant: Record<string, unknown>; application: Record<string, unknown> };
  status: string;
  createdAt: string;
  decisions: Array<{
    id: string;
    outcome: Outcome;
    score: number;
    probabilityOfDefault: string;
    riskGrade: string;
    approvedAmount: string | null;
    interestRate: string | null;
    reasonCodes: string[];
    policyVersionId: string;
    modelVersionId: string;
    challengerScore: number | null;
    latencyMs: number;
    overrideProposedById: string | null;
    overriddenById: string | null;
    overrideJustification: string | null;
    createdAt: string;
  }>;
  events: DecisionEventRow[];
}

export interface PolicyRule {
  id: string;
  priority: number;
  expr: string;
  onFail: 'DECLINE' | 'REFER';
  reason: string;
}

export interface Policy {
  id: string;
  version: string;
  product: string;
  rules: PolicyRule[];
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  createdBy: string;
  approvedBy: string | null;
  activatedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
}

export interface SimulationResult {
  current: { approvalRate: number; referRate: number; declineRate: number; avgScore: number; projectedBadRate: number };
  draft: { approvalRate: number; referRate: number; declineRate: number; avgScore: number; projectedBadRate: number };
  delta: { approvalRate: number; projectedBadRate: number };
  swapSet: { approvedNowDeclined: number; declinedNowApproved: number; byReason: Record<string, number> };
  sampleSize: number;
}

export interface DashboardStats {
  windowDays: number;
  totalDecisions: number;
  approvalRateOverTime: Array<{ day: string; approvalRate: number; total: number }>;
  scoreDistribution: Array<{ rangeStart: number; rangeEnd: number; count: number }>;
  reasonCodeFrequency: Array<{ code: string; count: number }>;
  latencyMs: { p50: number; p95: number; p99: number };
  championVsChallenger: { correlation: number | null; points: Array<{ score: number; challengerScore: number }> };
}

// ---- API calls --------------------------------------------------------------------------

export const api = {
  queue: (params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<QueueResponse>(`/applications?${qs.toString()}`);
  },
  application: (id: string) => request<ApplicationDetail>(`/applications/${id}`),
  policies: (product?: string) => request<Policy[]>(`/policy${product ? `?product=${product}` : ''}`),
  policy: (version: string) => request<Policy>(`/policy/${version}`),
  createPolicy: (dto: { version: string; product: string; createdBy: string; rules: PolicyRule[] }) =>
    request<Policy>('/policy', { method: 'POST', body: JSON.stringify(dto) }),
  activatePolicy: (version: string, approvedBy: string) =>
    request<Policy>(`/policy/${version}/activate`, { method: 'POST', body: JSON.stringify({ approvedBy }) }),
  simulate: (dto: { product: string; rules: PolicyRule[]; sampleSize?: number }) =>
    request<SimulationResult>('/policy/simulate', { method: 'POST', body: JSON.stringify(dto) }),
  override: (decisionId: string, dto: { newOutcome: 'APPROVE' | 'DECLINE'; justification: string; proposedBy: string; approvedBy: string }) =>
    request(`/decisions/${decisionId}/override`, { method: 'POST', body: JSON.stringify(dto) }),
  replay: (decisionId: string) => request(`/decisions/${decisionId}/replay`, { method: 'POST' }),
  verifyChain: () => request<{ valid: boolean; firstBreakId: string | null }>('/audit/verify'),
  stats: (product?: string, days?: number) => {
    const qs = new URLSearchParams();
    if (product) qs.set('product', product);
    if (days) qs.set('days', String(days));
    return request<DashboardStats>(`/decisions/stats?${qs.toString()}`);
  },
};
