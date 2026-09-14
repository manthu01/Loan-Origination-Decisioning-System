import { Injectable, Logger } from '@nestjs/common';
import { BureauPayload } from '../../common/domain.types';
import { CircuitBreaker } from './circuit-breaker';

export class BureauUnavailableError extends Error {}

const LATENCY_MS_MIN = Number(process.env.BUREAU_MOCK_LATENCY_MS_MIN ?? 200);
const LATENCY_MS_MAX = Number(process.env.BUREAU_MOCK_LATENCY_MS_MAX ?? 800);
const TIMEOUT_RATE = Number(process.env.BUREAU_MOCK_TIMEOUT_RATE ?? 0.02);
const ERROR_RATE = Number(process.env.BUREAU_MOCK_ERROR_RATE ?? 0.01);
const CIRCUIT_FAILURE_THRESHOLD = Number(process.env.BUREAU_CIRCUIT_BREAKER_FAILURE_THRESHOLD ?? 5);
const CIRCUIT_COOLDOWN_MS = Number(process.env.BUREAU_CIRCUIT_BREAKER_COOLDOWN_MS ?? 30_000);

const DEGRADED_BUREAU: Omit<BureauPayload, 'available'> = {
  tradelines: 0,
  dpd30PlusLast12M: 0,
  enquiriesLast3M: 0,
  oldestTradelineAgeMonths: 0,
  creditUtilization: 0,
  numPreviousDefaults: 0,
};

/**
 * Simulates an external bureau with realistic latency, a timeout rate, and a 500-error
 * rate -- there's no real bureau to integrate against for this project, so the interesting
 * engineering problem (what happens when it's down) is what gets built, not the
 * integration itself.
 */
@Injectable()
export class BureauMockService {
  async fetch(applicantId: string): Promise<Omit<BureauPayload, 'available'>> {
    const latency = LATENCY_MS_MIN + Math.random() * (LATENCY_MS_MAX - LATENCY_MS_MIN);
    await new Promise((resolve) => setTimeout(resolve, latency));

    const roll = Math.random();
    if (roll < TIMEOUT_RATE) {
      throw new BureauUnavailableError(`bureau timeout for applicant ${applicantId}`);
    }
    if (roll < TIMEOUT_RATE + ERROR_RATE) {
      throw new BureauUnavailableError(`bureau 500 for applicant ${applicantId}`);
    }

    // deterministic-ish pseudo bureau profile derived from the applicant id so repeated
    // calls for the same applicant return a stable profile in dev/demo
    const seed = hashToUnit(applicantId);
    return {
      tradelines: Math.floor(seed * 8),
      dpd30PlusLast12M: seed > 0.85 ? Math.floor(seed * 3) : 0,
      enquiriesLast3M: Math.floor(seed * 10) % 8,
      oldestTradelineAgeMonths: Math.floor(seed * 240),
      creditUtilization: Math.round(seed * 100) / 100,
      numPreviousDefaults: seed > 0.92 ? 1 : 0,
    };
  }
}

function hashToUnit(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0) / 0xffffffff;
}

/**
 * Wraps the bureau call with a circuit breaker: after 5 consecutive failures the circuit
 * opens and every application is routed to REFER (via bureau.available = 0, which a
 * BUREAU_UNAVAILABLE policy rule reads) without even attempting the call, until a
 * cooldown elapses and a trial call is let through. This is the deliberate answer to
 * "what happens when the bureau is down": neither fail the application nor silently
 * decision on absent data -- REFER for manual bureau pull, with a distinct reason code.
 */
@Injectable()
export class BureauClientService {
  private readonly logger = new Logger(BureauClientService.name);
  private readonly breaker = new CircuitBreaker(CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_COOLDOWN_MS);

  constructor(private readonly mock: BureauMockService = new BureauMockService()) {}

  async fetch(applicantId: string): Promise<BureauPayload> {
    if (!this.breaker.canAttempt()) {
      this.logger.warn(`bureau circuit OPEN, skipping call for applicant ${applicantId}`);
      return { available: 0, ...DEGRADED_BUREAU };
    }

    try {
      const result = await this.mock.fetch(applicantId);
      this.breaker.recordSuccess();
      return { available: 1, ...result };
    } catch (err) {
      this.breaker.recordFailure();
      this.logger.warn(`bureau call failed for applicant ${applicantId}: ${(err as Error).message}`);
      return { available: 0, ...DEGRADED_BUREAU };
    }
  }

  circuitState() {
    return this.breaker.getState();
  }
}
