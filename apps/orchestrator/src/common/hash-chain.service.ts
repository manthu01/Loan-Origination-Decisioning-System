import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, PipelineStage } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface AppendEventInput {
  applicationId: string;
  stage: PipelineStage;
  input: unknown;
  output: unknown;
  durationMs: number;
}

// One fixed lock key for the whole chain -- every writer serializes through it so
// "read the tip, then insert" can never race across concurrent requests. A single global
// chain (not per-application) is deliberate: it lets one verification pass over the whole
// DecisionEvent table prove nothing anywhere was ever altered, reordered, or deleted, not
// just within one application's own events.
const CHAIN_LOCK_KEY = 0x43524446; // 'CRDF' as a 32-bit int, arbitrary but stable

const GENESIS_HASH = '0'.repeat(64);

/** Deep-sorts object keys before JSON.stringify so the hash is stable regardless of key
 * insertion order at any nesting level -- the build plan's own canonical() sketch only
 * sorts the top level via a replacer array; this extends that to nested objects, which
 * matters here since `input`/`output` are themselves nested JSON. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

@Injectable()
export class HashChainService {
  constructor(private readonly prisma: PrismaService) {}

  /** Appends one DecisionEvent to the global hash chain. Must run inside a transaction
   * that also holds the advisory lock for the whole request's set of events, or two
   * concurrent requests could both read the same tip and fork the chain. */
  async appendEvent(tx: Prisma.TransactionClient, event: AppendEventInput) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK_KEY})`;

    const tip = await tx.decisionEvent.findFirst({ orderBy: { id: 'desc' } });
    const prevHash = tip?.hash ?? GENESIS_HASH;

    const canonical = canonicalize({
      applicationId: event.applicationId,
      stage: event.stage,
      input: event.input,
      output: event.output,
      durationMs: event.durationMs,
    });
    const hash = createHash('sha256').update(prevHash + canonical).digest('hex');

    return tx.decisionEvent.create({
      data: {
        applicationId: event.applicationId,
        stage: event.stage,
        input: event.input as Prisma.InputJsonValue,
        output: event.output as Prisma.InputJsonValue,
        durationMs: event.durationMs,
        prevHash,
        hash,
      },
    });
  }

  /** Walks the whole chain in insertion order and reports the first row whose hash
   * doesn't match sha256(prevHash + canonical(payload)) -- tampering with any historical
   * row invalidates its own hash and every hash after it. */
  async verifyChain(): Promise<{ valid: boolean; firstBreakId: string | null }> {
    const events = await this.prisma.decisionEvent.findMany({ orderBy: { id: 'asc' } });
    let expectedPrevHash = GENESIS_HASH;

    for (const event of events) {
      const canonical = canonicalize({
        applicationId: event.applicationId,
        stage: event.stage,
        input: event.input,
        output: event.output,
        durationMs: event.durationMs,
      });
      const expectedHash = createHash('sha256').update(expectedPrevHash + canonical).digest('hex');

      if (event.prevHash !== expectedPrevHash || event.hash !== expectedHash) {
        return { valid: false, firstBreakId: event.id.toString() };
      }
      expectedPrevHash = event.hash;
    }
    return { valid: true, firstBreakId: null };
  }
}
