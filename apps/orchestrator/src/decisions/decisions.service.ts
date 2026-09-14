import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { HashChainService } from '../common/hash-chain.service';
import { OverrideDecisionDto } from './dto/override-decision.dto';

export interface QueueFilters {
  status?: string;
  outcome?: string;
  reasonCode?: string;
  product?: string;
  scoreMin?: number;
  scoreMax?: number;
  limit?: number;
  offset?: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return cov / Math.sqrt(varX * varY);
}

@Injectable()
export class DecisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashChain: HashChainService,
  ) {}

  async queue(filters: QueueFilters) {
    const where: any = {};
    if (filters.outcome) where.outcome = filters.outcome;
    if (filters.reasonCode) where.reasonCodes = { has: filters.reasonCode };
    if (filters.scoreMin !== undefined || filters.scoreMax !== undefined) {
      where.score = {};
      if (filters.scoreMin !== undefined) where.score.gte = filters.scoreMin;
      if (filters.scoreMax !== undefined) where.score.lte = filters.scoreMax;
    }
    if (filters.status || filters.product) {
      where.application = {};
      if (filters.status) where.application.status = filters.status;
      if (filters.product) where.application.product = filters.product;
    }

    const [rows, total] = await Promise.all([
      this.prisma.decision.findMany({
        where,
        include: { application: { include: { applicant: true } } },
        orderBy: { createdAt: 'desc' },
        take: filters.limit ?? 50,
        skip: filters.offset ?? 0,
      }),
      this.prisma.decision.count({ where }),
    ]);

    return {
      total,
      rows: rows.map((d) => ({
        applicationId: d.applicationId,
        decisionId: d.id,
        applicantName: d.application.applicant.fullName,
        product: d.application.product,
        status: d.application.status,
        outcome: d.outcome,
        score: d.score,
        riskGrade: d.riskGrade,
        reasonCodes: d.reasonCodes,
        approvedAmount: d.approvedAmount ? Number(d.approvedAmount) : null,
        createdAt: d.createdAt,
      })),
    };
  }

  async stats(product?: string, days = 90) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const decisions = await this.prisma.decision.findMany({
      where: {
        createdAt: { gte: since },
        ...(product ? { application: { product } } : {}),
      },
      select: {
        outcome: true,
        score: true,
        reasonCodes: true,
        latencyMs: true,
        challengerScore: true,
        createdAt: true,
      },
    });

    // approval rate by day
    const byDay = new Map<string, { approve: number; refer: number; decline: number }>();
    for (const d of decisions) {
      const day = d.createdAt.toISOString().slice(0, 10);
      const bucket = byDay.get(day) ?? { approve: 0, refer: 0, decline: 0 };
      if (d.outcome === 'APPROVE') bucket.approve++;
      else if (d.outcome === 'REFER') bucket.refer++;
      else bucket.decline++;
      byDay.set(day, bucket);
    }
    const approvalRateOverTime = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, b]) => {
        const total = b.approve + b.refer + b.decline;
        return { day, approvalRate: total ? b.approve / total : 0, total };
      });

    // score distribution (10 buckets across observed range)
    const scores = decisions.map((d) => d.score);
    const scoreDistribution = histogram(scores, 10);

    // reason code frequency
    const reasonFrequency = new Map<string, number>();
    for (const d of decisions) {
      for (const code of d.reasonCodes) {
        reasonFrequency.set(code, (reasonFrequency.get(code) ?? 0) + 1);
      }
    }

    // latency percentiles
    const latencies = decisions.map((d) => d.latencyMs).sort((a, b) => a - b);

    // champion vs challenger
    const paired = decisions.filter((d) => d.challengerScore !== null) as (typeof decisions[number] & { challengerScore: number })[];
    const correlation = pearsonCorrelation(paired.map((d) => d.score), paired.map((d) => d.challengerScore));

    return {
      windowDays: days,
      totalDecisions: decisions.length,
      approvalRateOverTime,
      scoreDistribution,
      reasonCodeFrequency: [...reasonFrequency.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
      latencyMs: {
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
      },
      championVsChallenger: {
        correlation,
        points: paired.slice(0, 500).map((d) => ({ score: d.score, challengerScore: d.challengerScore })),
      },
    };
  }

  async override(decisionId: string, dto: OverrideDecisionDto) {
    if (dto.proposedBy === dto.approvedBy) {
      throw new BadRequestException('maker-checker violation: the same user cannot both propose and approve an override');
    }

    const decision = await this.prisma.decision.findUnique({ where: { id: decisionId } });
    if (!decision) throw new NotFoundException(`decision ${decisionId} not found`);
    if (decision.outcome !== 'REFER') {
      throw new BadRequestException(`only a REFER decision can be manually overridden (this one is ${decision.outcome})`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.decision.update({
        where: { id: decisionId },
        data: {
          outcome: dto.newOutcome,
          overrideProposedById: dto.proposedBy,
          overriddenById: dto.approvedBy,
          overrideJustification: dto.justification,
        },
      });

      await this.hashChain.appendEvent(tx, {
        applicationId: decision.applicationId,
        stage: 'OVERRIDE',
        input: { decisionId, previousOutcome: decision.outcome, proposedBy: dto.proposedBy, approvedBy: dto.approvedBy },
        output: { newOutcome: dto.newOutcome, justification: dto.justification },
        durationMs: 0,
      });

      await tx.application.update({ where: { id: decision.applicationId }, data: { status: 'DECIDED' } });

      return updated;
    });
  }
}

function histogram(values: number[], bucketCount: number) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / bucketCount || 1;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    rangeStart: Math.round(min + i * width),
    rangeEnd: Math.round(min + (i + 1) * width),
    count: 0,
  }));
  for (const v of values) {
    const idx = Math.min(bucketCount - 1, Math.floor((v - min) / width));
    buckets[Math.max(0, idx)].count++;
  }
  return buckets;
}
