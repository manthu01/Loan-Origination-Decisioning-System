import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RulesEngineService } from '../common/rules-engine.service';
import { RuleDefinition } from '../common/rules-engine.types';
import { PolicyService } from './policy.service';

function makePrismaMock() {
  return {
    policyVersion: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    application: { findMany: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn({ policyVersion: (undefined as any) })),
  };
}

const validRule: RuleDefinition = {
  id: 'AGE_MIN',
  priority: 10,
  expr: 'applicant.age >= 21',
  onFail: 'DECLINE',
  reason: 'R101',
};

describe('PolicyService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: PolicyService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new PolicyService(prisma as any, new RulesEngineService());
  });

  describe('createDraft', () => {
    it('rejects a policy whose rule expression does not parse', async () => {
      await expect(
        service.createDraft({
          version: 'v1',
          product: 'PL',
          createdBy: 'alice',
          rules: [{ ...validRule, expr: 'applicant.age >=>' }],
        }),
      ).rejects.toThrow();
      expect(prisma.policyVersion.create).not.toHaveBeenCalled();
    });

    it('rejects creating a version that already exists', async () => {
      prisma.policyVersion.findUnique.mockResolvedValue({ version: 'v1' });
      await expect(
        service.createDraft({ version: 'v1', product: 'PL', createdBy: 'alice', rules: [validRule] }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates a DRAFT policy when the payload is valid and new', async () => {
      prisma.policyVersion.findUnique.mockResolvedValue(null);
      prisma.policyVersion.create.mockResolvedValue({ version: 'v1', status: 'DRAFT' });
      const result = await service.createDraft({
        version: 'v1',
        product: 'PL',
        createdBy: 'alice',
        rules: [validRule],
      });
      expect(prisma.policyVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT', createdBy: 'alice' }) }),
      );
      expect(result.status).toBe('DRAFT');
    });
  });

  describe('activate (maker-checker)', () => {
    it('rejects activation by the same user who created the draft', async () => {
      prisma.policyVersion.findUnique.mockResolvedValue({
        version: 'v1',
        status: 'DRAFT',
        createdBy: 'alice',
        product: 'PL',
      });
      await expect(service.activate('v1', 'alice')).rejects.toThrow(BadRequestException);
    });

    it('rejects activating a version that is not in DRAFT status', async () => {
      prisma.policyVersion.findUnique.mockResolvedValue({
        version: 'v1',
        status: 'ACTIVE',
        createdBy: 'alice',
        product: 'PL',
      });
      await expect(service.activate('v1', 'bob')).rejects.toThrow(ConflictException);
    });

    it('rejects activating a version that does not exist', async () => {
      prisma.policyVersion.findUnique.mockResolvedValue(null);
      await expect(service.activate('missing', 'bob')).rejects.toThrow(NotFoundException);
    });

    it('activates when a different user approves a DRAFT, retiring the prior ACTIVE policy', async () => {
      prisma.policyVersion.findUnique.mockResolvedValue({
        version: 'v2',
        status: 'DRAFT',
        createdBy: 'alice',
        product: 'PL',
      });
      const tx = {
        policyVersion: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({ version: 'v2', status: 'ACTIVE', approvedBy: 'bob' }),
        },
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.activate('v2', 'bob');

      expect(tx.policyVersion.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { product: 'PL', status: 'ACTIVE' } }),
      );
      expect(tx.policyVersion.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { version: 'v2' }, data: expect.objectContaining({ approvedBy: 'bob' }) }),
      );
      expect(result.status).toBe('ACTIVE');
    });
  });

  describe('getSimulationRecords', () => {
    it('derives applicant.age from dob (stored payload only has dob, not age) so AGE_* rules work on replay', async () => {
      const decisionCreatedAt = new Date('2026-06-15');
      prisma.application.findMany.mockResolvedValue([
        {
          id: 'APP1',
          payload: {
            applicant: { dob: '2000-06-15', monthlyIncome: 50000, obligations: 5000 },
            application: { estimatedEmi: 8000 },
          },
          decisions: [{ outcome: 'APPROVE', score: 650, probabilityOfDefault: 0.03, createdAt: decisionCreatedAt }],
          events: [{ output: JSON.stringify({ tradelines: 2 }) }],
        },
      ]);

      const records = await service.getSimulationRecords('PL', 10);

      expect(records).toHaveLength(1);
      expect((records[0].context.applicant as any).age).toBe(26); // 2000-06-15 -> 2026-06-15
    });

    it('skips applications missing a decision or a BUREAU event', async () => {
      prisma.application.findMany.mockResolvedValue([
        { id: 'APP1', payload: {}, decisions: [], events: [{ output: '{}' }] },
        { id: 'APP2', payload: {}, decisions: [{ outcome: 'APPROVE', score: 600, probabilityOfDefault: 0.05, createdAt: new Date() }], events: [] },
      ]);

      const records = await service.getSimulationRecords('PL', 10);

      expect(records).toHaveLength(0);
    });
  });
});
