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

/** Deep-sorts object keys before JSON.stringify so the string is stable regardless of key
 * insertion order at any nesting level -- the build plan's own canonical() sketch only
 * sorts the top level via a replacer array; this extends that to nested objects. */
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

/** Builds the exact string that gets hashed for one event, given its already-canonical
 * (pre-stringified) input/output text. Wrapping already-string fields in an outer object
 * and JSON.stringify-ing that is safe -- JSON string-escaping is lossless and never
 * reformats digits, unlike re-serializing a nested number through jsonb. */
function eventCanonicalString(applicationId: string, stage: string, inputText: string, outputText: string, durationMs: number): string {
  return canonicalize({ applicationId, stage, input: inputText, output: outputText, durationMs });
}

@Injectable()
export class HashChainService {
  constructor(private readonly prisma: PrismaService) {}

  /** Appends one DecisionEvent to the global hash chain. Must run inside a transaction
   * that also holds the advisory lock for the whole request's set of events, or two
   * concurrent requests could both read the same tip and fork the chain.
   *
   * input/output are canonicalized to JSON text ONCE here and stored as TEXT columns
   * (see schema.prisma) -- never re-serialized through Postgres jsonb, which is what
   * keeps every future re-hash byte-identical to this one. */
  async appendEvent(tx: Prisma.TransactionClient, event: AppendEventInput) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK_KEY})`;

    const tip = await tx.decisionEvent.findFirst({ orderBy: { id: 'desc' } });
    const prevHash = tip?.hash ?? GENESIS_HASH;

    const inputText = canonicalize(event.input);
    const outputText = canonicalize(event.output);
    const canonical = eventCanonicalString(event.applicationId, event.stage, inputText, outputText, event.durationMs);
    const hash = createHash('sha256').update(prevHash + canonical).digest('hex');

    return tx.decisionEvent.create({
      data: {
        applicationId: event.applicationId,
        stage: event.stage,
        input: inputText,
        output: outputText,
        durationMs: event.durationMs,
        prevHash,
        hash,
      },
    });
  }

  /** Walks the whole chain in insertion order and reports the first row whose hash
   * doesn't match sha256(prevHash + canonical(payload)) -- tampering with any historical
   * row invalidates its own hash and every hash after it. Recomputes directly from the
   * stored input/output TEXT columns, which is what makes this immune to the jsonb
   * round-trip issue: those columns are never reformatted between write and read. */
  async verifyChain(): Promise<{ valid: boolean; firstBreakId: string | null }> {
    const events = await this.prisma.decisionEvent.findMany({ orderBy: { id: 'asc' } });
    let expectedPrevHash = GENESIS_HASH;

    for (const event of events) {
      const canonical = eventCanonicalString(event.applicationId, event.stage, event.input, event.output, event.durationMs);
      const expectedHash = createHash('sha256').update(expectedPrevHash + canonical).digest('hex');

      if (event.prevHash !== expectedPrevHash || event.hash !== expectedHash) {
        return { valid: false, firstBreakId: event.id.toString() };
      }
      expectedPrevHash = event.hash;
    }
    return { valid: true, firstBreakId: null };
  }
}
