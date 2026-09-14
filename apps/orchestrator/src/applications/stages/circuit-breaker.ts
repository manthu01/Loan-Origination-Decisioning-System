export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Standard three-state circuit breaker. After `failureThreshold` consecutive failures the
 * circuit OPENs and every call is short-circuited (no attempt made) until `cooldownMs`
 * elapses; then one trial call is allowed through (HALF_OPEN) -- success CLOSES the
 * circuit, failure re-OPENs it and restarts the cooldown.
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  getState(): CircuitState {
    if (this.state === 'OPEN' && this.openedAt !== null && this.now() - this.openedAt >= this.cooldownMs) {
      return 'HALF_OPEN';
    }
    return this.state;
  }

  /** Whether a call should even be attempted right now. */
  canAttempt(): boolean {
    return this.getState() !== 'OPEN';
  }

  recordSuccess(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.getState() === 'HALF_OPEN' || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
  }
}
