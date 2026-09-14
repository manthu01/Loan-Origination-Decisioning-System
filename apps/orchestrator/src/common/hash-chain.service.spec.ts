import { createHash } from 'crypto';
import { canonicalize, HashChainService } from './hash-chain.service';

describe('canonicalize', () => {
  it('produces the same string regardless of key insertion order, including nested objects', () => {
    const a = { b: 2, a: 1, nested: { y: 2, x: 1 } };
    const b = { a: 1, nested: { x: 1, y: 2 }, b: 2 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('is sensitive to actual value differences', () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }));
  });
});

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

describe('HashChainService', () => {
  function makeTx(tip: { hash: string } | null, createImpl?: (data: any) => any) {
    return {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      decisionEvent: {
        findFirst: jest.fn().mockResolvedValue(tip),
        create: jest.fn().mockImplementation(({ data }) => (createImpl ? createImpl(data) : { id: 1n, ...data })),
      },
    } as any;
  }

  it('uses the genesis hash as prevHash when the chain is empty', async () => {
    const service = new HashChainService({} as any);
    const tx = makeTx(null);
    const event = { applicationId: 'A1', stage: 'DEDUPE' as const, input: {}, output: { ok: true }, durationMs: 5 };

    const created = await service.appendEvent(tx, event);

    expect(tx.$executeRaw).toHaveBeenCalled(); // advisory lock taken
    const genesis = '0'.repeat(64);
    expect(created.prevHash).toBe(genesis);
    const expectedCanonical = canonicalize({
      applicationId: 'A1',
      stage: 'DEDUPE',
      input: {},
      output: { ok: true },
      durationMs: 5,
    });
    expect(created.hash).toBe(sha256(genesis + expectedCanonical));
  });

  it('chains off the current tip hash when events already exist', async () => {
    const service = new HashChainService({} as any);
    const tx = makeTx({ hash: 'deadbeef' });
    const event = { applicationId: 'A2', stage: 'KYC' as const, input: {}, output: {}, durationMs: 1 };

    const created = await service.appendEvent(tx, event);

    expect(created.prevHash).toBe('deadbeef');
  });

  it('verifyChain detects a tampered row', async () => {
    const service = new HashChainService({} as any);
    const genesis = '0'.repeat(64);
    const c1 = canonicalize({ applicationId: 'A1', stage: 'DEDUPE', input: {}, output: { x: 1 }, durationMs: 1 });
    const h1 = sha256(genesis + c1);
    const c2 = canonicalize({ applicationId: 'A1', stage: 'KYC', input: {}, output: { x: 2 }, durationMs: 1 });
    const h2 = sha256(h1 + c2);

    (service as any).prisma = {
      decisionEvent: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1n, applicationId: 'A1', stage: 'DEDUPE', input: {}, output: { x: 1 }, durationMs: 1, prevHash: genesis, hash: h1 },
          // tampered: output changed after the hash was computed, so h2 no longer matches
          { id: 2n, applicationId: 'A1', stage: 'KYC', input: {}, output: { x: 999 }, durationMs: 1, prevHash: h1, hash: h2 },
        ]),
      },
    };

    const result = await service.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.firstBreakId).toBe('2');
  });

  it('verifyChain reports valid for an untampered chain', async () => {
    const service = new HashChainService({} as any);
    const genesis = '0'.repeat(64);
    const c1 = canonicalize({ applicationId: 'A1', stage: 'DEDUPE', input: {}, output: { x: 1 }, durationMs: 1 });
    const h1 = sha256(genesis + c1);

    (service as any).prisma = {
      decisionEvent: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1n, applicationId: 'A1', stage: 'DEDUPE', input: {}, output: { x: 1 }, durationMs: 1, prevHash: genesis, hash: h1 },
        ]),
      },
    };

    const result = await service.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.firstBreakId).toBeNull();
  });
});
