import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DecisionsService } from './decisions.service';

function makePrismaMock() {
  return {
    decision: { findUnique: jest.fn(), update: jest.fn() },
    application: { update: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn({ decision: { update: jest.fn().mockResolvedValue({ id: 'D1', outcome: 'APPROVE' }) }, application: { update: jest.fn() } })),
  };
}

function makeHashChainMock() {
  return { appendEvent: jest.fn().mockResolvedValue(undefined) };
}

const overrideDto = { newOutcome: 'APPROVE' as const, justification: 'verified income manually via payslip', proposedBy: 'alice', approvedBy: 'bob' };

describe('DecisionsService.override', () => {
  it('rejects when the same user proposes and approves', async () => {
    const prisma = makePrismaMock();
    const service = new DecisionsService(prisma as any, makeHashChainMock() as any);
    await expect(
      service.override('D1', { ...overrideDto, approvedBy: 'alice' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.decision.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when the decision does not exist', async () => {
    const prisma = makePrismaMock();
    prisma.decision.findUnique.mockResolvedValue(null);
    const service = new DecisionsService(prisma as any, makeHashChainMock() as any);
    await expect(service.override('missing', overrideDto)).rejects.toThrow(NotFoundException);
  });

  it('rejects overriding a decision that is not REFER', async () => {
    const prisma = makePrismaMock();
    prisma.decision.findUnique.mockResolvedValue({ id: 'D1', outcome: 'DECLINE', applicationId: 'A1' });
    const service = new DecisionsService(prisma as any, makeHashChainMock() as any);
    await expect(service.override('D1', overrideDto)).rejects.toThrow(BadRequestException);
  });

  it('overrides a REFER with a valid maker-checker pair and logs an OVERRIDE audit event', async () => {
    const prisma = makePrismaMock();
    prisma.decision.findUnique.mockResolvedValue({ id: 'D1', outcome: 'REFER', applicationId: 'A1' });
    const hashChain = makeHashChainMock();
    const txDecisionUpdate = jest.fn().mockResolvedValue({ id: 'D1', outcome: 'APPROVE' });
    const txApplicationUpdate = jest.fn();
    prisma.$transaction.mockImplementation(async (fn: any) =>
      fn({ decision: { update: txDecisionUpdate }, application: { update: txApplicationUpdate } }),
    );
    const service = new DecisionsService(prisma as any, hashChain as any);

    const result = await service.override('D1', overrideDto);

    expect(txDecisionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'D1' },
        data: expect.objectContaining({
          outcome: 'APPROVE',
          overrideProposedById: 'alice',
          overriddenById: 'bob',
          overrideJustification: overrideDto.justification,
        }),
      }),
    );
    expect(hashChain.appendEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ applicationId: 'A1', stage: 'OVERRIDE' }),
    );
    expect(txApplicationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'A1' }, data: { status: 'DECIDED' } }),
    );
    expect(result.outcome).toBe('APPROVE');
  });
});
