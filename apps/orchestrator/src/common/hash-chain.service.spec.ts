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

/** Mirrors HashChainService's private eventCanonicalString: wraps already-canonical
 * input/output TEXT in an outer object and canonicalizes that. */
function eventCanonical(applicationId: string, stage: string, inputText: string, outputText: string, durationMs: number) {
  return canonicalize({ applicationId, stage, input: inputText, output: outputText, durationMs });
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

  it('stores input/output as canonical JSON text, not native objects', async () => {
    const service = new HashChainService({} as any);
    const tx = makeTx(null);
    const event = { applicationId: 'A1', stage: 'DEDUPE' as const, input: { b: 2, a: 1 }, output: { ok: true }, durationMs: 5 };

    const created = await service.appendEvent(tx, event);

    expect(typeof created.input).toBe('string');
    expect(typeof created.output).toBe('string');
    expect(created.input).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it('uses the genesis hash as prevHash when the chain is empty', async () => {
    const service = new HashChainService({} as any);
    const tx = makeTx(null);
    const event = { applicationId: 'A1', stage: 'DEDUPE' as const, input: {}, output: { ok: true }, durationMs: 5 };

    const created = await service.appendEvent(tx, event);

    expect(tx.$executeRaw).toHaveBeenCalled(); // advisory lock taken
    const genesis = '0'.repeat(64);
    expect(created.prevHash).toBe(genesis);
    const expectedCanonical = eventCanonical('A1', 'DEDUPE', canonicalize({}), canonicalize({ ok: true }), 5);
    expect(created.hash).toBe(sha256(genesis + expectedCanonical));
  });

  it('chains off the current tip hash when events already exist', async () => {
    const service = new HashChainService({} as any);
    const tx = makeTx({ hash: 'deadbeef' });
    const event = { applicationId: 'A2', stage: 'KYC' as const, input: {}, output: {}, durationMs: 1 };

    const created = await service.appendEvent(tx, event);

    expect(created.prevHash).toBe('deadbeef');
  });

  it('verifyChain is immune to a value that would reformat differently on a jsonb round-trip', async () => {
    // regression case: 2000/120000 stringifies as "...666666" in JS but a naive jsonb
    // round-trip through Postgres can come back as "...66667" -- since input/output are
    // stored as TEXT (never reformatted), verification must reproduce the exact same
    // hash from a value like this every time.
    const service = new HashChainService({} as any);
    const genesis = '0'.repeat(64);
    const trickyValue = 2000 / 120000;
    const inputText = canonicalize({ ratio: trickyValue });
    const outputText = canonicalize({ ok: true });
    const c1 = eventCanonical('A1', 'SCORE', inputText, outputText, 7);
    const h1 = sha256(genesis + c1);

    (service as any).prisma = {
      decisionEvent: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1n, applicationId: 'A1', stage: 'SCORE', input: inputText, output: outputText, durationMs: 7, prevHash: genesis, hash: h1 },
        ]),
      },
    };

    const result = await service.verifyChain();
    expect(result.valid).toBe(true);
  });

  it('verifyChain detects a tampered row', async () => {
    const service = new HashChainService({} as any);
    const genesis = '0'.repeat(64);
    const in1 = canonicalize({});
    const out1 = canonicalize({ x: 1 });
    const c1 = eventCanonical('A1', 'DEDUPE', in1, out1, 1);
    const h1 = sha256(genesis + c1);
    const in2 = canonicalize({});
    const out2 = canonicalize({ x: 2 });
    const c2 = eventCanonical('A1', 'KYC', in2, out2, 1);
    const h2 = sha256(h1 + c2);

    (service as any).prisma = {
      decisionEvent: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1n, applicationId: 'A1', stage: 'DEDUPE', input: in1, output: out1, durationMs: 1, prevHash: genesis, hash: h1 },
          // tampered: output text changed after the hash was computed, so h2 no longer matches
          { id: 2n, applicationId: 'A1', stage: 'KYC', input: in2, output: canonicalize({ x: 999 }), durationMs: 1, prevHash: h1, hash: h2 },
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
    const in1 = canonicalize({});
    const out1 = canonicalize({ x: 1 });
    const c1 = eventCanonical('A1', 'DEDUPE', in1, out1, 1);
    const h1 = sha256(genesis + c1);

    (service as any).prisma = {
      decisionEvent: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1n, applicationId: 'A1', stage: 'DEDUPE', input: in1, output: out1, durationMs: 1, prevHash: genesis, hash: h1 },
        ]),
      },
    };

    const result = await service.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.firstBreakId).toBeNull();
  });
});
