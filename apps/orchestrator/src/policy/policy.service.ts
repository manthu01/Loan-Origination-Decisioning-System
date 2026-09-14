import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { deriveAge } from '../common/date';
import { RawApplicationPayload } from '../common/domain.types';
import { RulesEngineService } from '../common/rules-engine.service';
import { PolicyDocument, RuleEvaluationContext } from '../common/rules-engine.types';
import { CreatePolicyDto } from './dto/create-policy.dto';
import { SimulationRecord } from './policy.types';

/**
 * Policy is versioned data, not code -- see docs/design-doc.md. A DRAFT can be created by
 * one user and only ACTIVATED by a different one (maker-checker), which is enforced here
 * at the service layer rather than trusted to the caller.
 */
@Injectable()
export class PolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rulesEngine: RulesEngineService,
  ) {}

  async createDraft(dto: CreatePolicyDto) {
    const policyDoc: PolicyDocument = { policyVersion: dto.version, product: dto.product, rules: dto.rules };
    this.rulesEngine.validate(policyDoc);

    const existing = await this.prisma.policyVersion.findUnique({ where: { version: dto.version } });
    if (existing) {
      throw new ConflictException(`policy version ${dto.version} already exists`);
    }

    return this.prisma.policyVersion.create({
      data: {
        version: dto.version,
        product: dto.product,
        rules: dto.rules as any,
        status: 'DRAFT',
        createdBy: dto.createdBy,
      },
    });
  }

  async activate(version: string, approvedBy: string) {
    const draft = await this.prisma.policyVersion.findUnique({ where: { version } });
    if (!draft) throw new NotFoundException(`policy version ${version} not found`);
    if (draft.status !== 'DRAFT') {
      throw new ConflictException(`policy version ${version} is ${draft.status}, only a DRAFT can be activated`);
    }
    if (draft.createdBy === approvedBy) {
      throw new BadRequestException(
        'maker-checker violation: the user who created a draft policy cannot also approve it',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.policyVersion.updateMany({
        where: { product: draft.product, status: 'ACTIVE' },
        data: { status: 'RETIRED', retiredAt: new Date() },
      });
      return tx.policyVersion.update({
        where: { version },
        data: { status: 'ACTIVE', approvedBy, activatedAt: new Date() },
      });
    });
  }

  async findActive(product: string) {
    const policy = await this.prisma.policyVersion.findFirst({ where: { product, status: 'ACTIVE' } });
    if (!policy) throw new NotFoundException(`no ACTIVE policy for product ${product}`);
    return policy;
  }

  async findByVersion(version: string) {
    const policy = await this.prisma.policyVersion.findUnique({ where: { version } });
    if (!policy) throw new NotFoundException(`policy version ${version} not found`);
    return policy;
  }

  list(product?: string, status?: string) {
    return this.prisma.policyVersion.findMany({
      where: { ...(product ? { product } : {}), ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Pulls the most recent `sampleSize` decided applications for a product as replay
   * fixtures for the simulator. Reconstructs each rule-evaluation context from the
   * application's stored payload plus its BUREAU and SCORE pipeline events -- see
   * common/domain.types.ts for the payload shapes this assumes.
   */
  async getSimulationRecords(product: string, sampleSize: number): Promise<SimulationRecord[]> {
    const applications = await this.prisma.application.findMany({
      where: { product, status: 'DECIDED' },
      take: sampleSize,
      orderBy: { createdAt: 'desc' },
      include: {
        decisions: { orderBy: { createdAt: 'desc' }, take: 1 },
        events: { where: { stage: 'BUREAU' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    const records: SimulationRecord[] = [];
    for (const app of applications) {
      const decision = app.decisions[0];
      const bureauEvent = app.events[0];
      if (!decision || !bureauEvent) continue;

      const payload = app.payload as unknown as RawApplicationPayload;
      // payload.applicant only has dob, not the computed `age` the live pipeline derives
      // at KYC time and merges into its rule context -- reconstruct it the same way, or
      // every AGE_* rule would see `age: undefined` and fail for every replayed record.
      const applicantWithAge = { ...payload.applicant, age: deriveAge(new Date(payload.applicant.dob), decision.createdAt) };
      const context: RuleEvaluationContext = {
        applicant: applicantWithAge as unknown as Record<string, unknown>,
        application: payload.application as unknown as Record<string, unknown>,
        bureau: JSON.parse(bureauEvent.output) as Record<string, unknown>,
        score: { value: decision.score },
      };

      records.push({
        applicationId: app.id,
        context,
        currentOutcome: decision.outcome as SimulationRecord['currentOutcome'],
        probabilityOfDefault: Number(decision.probabilityOfDefault),
        score: decision.score,
      });
    }
    return records;
  }
}
