import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('stays CLOSED below the failure threshold', () => {
    const breaker = new CircuitBreaker(5, 30_000);
    for (let i = 0; i < 4; i++) breaker.recordFailure();
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('OPENs after the failure threshold is reached and blocks further attempts', () => {
    const breaker = new CircuitBreaker(5, 30_000);
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.canAttempt()).toBe(false);
  });

  it('a success resets the failure count and closes the circuit', () => {
    const breaker = new CircuitBreaker(5, 30_000);
    for (let i = 0; i < 4; i++) breaker.recordFailure();
    breaker.recordSuccess();
    for (let i = 0; i < 4; i++) breaker.recordFailure(); // would have tripped without the reset
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('transitions OPEN -> HALF_OPEN once the cooldown elapses', () => {
    let now = 0;
    const breaker = new CircuitBreaker(5, 30_000, () => now);
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    expect(breaker.getState()).toBe('OPEN');

    now += 29_999;
    expect(breaker.getState()).toBe('OPEN');

    now += 2;
    expect(breaker.getState()).toBe('HALF_OPEN');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('a failed trial call in HALF_OPEN re-opens the circuit and restarts the cooldown', () => {
    let now = 0;
    const breaker = new CircuitBreaker(5, 30_000, () => now);
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    now += 30_000; // -> HALF_OPEN
    expect(breaker.getState()).toBe('HALF_OPEN');

    breaker.recordFailure(); // trial call failed
    expect(breaker.getState()).toBe('OPEN');

    now += 29_999;
    expect(breaker.getState()).toBe('OPEN'); // cooldown restarted from the trial failure
  });

  it('a successful trial call in HALF_OPEN closes the circuit', () => {
    let now = 0;
    const breaker = new CircuitBreaker(5, 30_000, () => now);
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    now += 30_000;
    expect(breaker.getState()).toBe('HALF_OPEN');

    breaker.recordSuccess();
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.canAttempt()).toBe(true);
  });
});
