import { BureauClientService, BureauMockService, BureauUnavailableError } from './bureau.service';

function fakeMock(behavior: 'succeed' | 'fail'): BureauMockService {
  return {
    fetch: jest.fn(async () => {
      if (behavior === 'fail') throw new BureauUnavailableError('simulated failure');
      return { tradelines: 3, dpd30PlusLast12M: 0, enquiriesLast3M: 1 };
    }),
  } as unknown as BureauMockService;
}

describe('BureauClientService', () => {
  it('returns available=1 with real data on a successful call', async () => {
    const client = new BureauClientService(fakeMock('succeed'));
    const result = await client.fetch('APP1');
    expect(result.available).toBe(1);
    expect(result.tradelines).toBe(3);
  });

  it('returns a degraded available=0 payload when the bureau call fails, instead of throwing', async () => {
    const client = new BureauClientService(fakeMock('fail'));
    const result = await client.fetch('APP1');
    expect(result.available).toBe(0);
    expect(result.tradelines).toBe(0);
  });

  it('opens the circuit after 5 consecutive failures and stops calling the bureau at all', async () => {
    const mock = fakeMock('fail');
    const client = new BureauClientService(mock);
    for (let i = 0; i < 5; i++) await client.fetch(`APP${i}`);
    expect(client.circuitState()).toBe('OPEN');

    (mock.fetch as jest.Mock).mockClear();
    const result = await client.fetch('APP_AFTER_OPEN');
    expect(result.available).toBe(0);
    expect(mock.fetch).not.toHaveBeenCalled(); // short-circuited, no call attempted
  });

  it('a success resets the breaker so a subsequent failure streak needs a fresh 5', async () => {
    let shouldFail = true;
    const flaky = {
      fetch: jest.fn(async () => {
        if (shouldFail) throw new BureauUnavailableError('fail');
        return { tradelines: 1, dpd30PlusLast12M: 0, enquiriesLast3M: 0 };
      }),
    } as unknown as BureauMockService;
    const client = new BureauClientService(flaky);

    for (let i = 0; i < 4; i++) await client.fetch(`APP${i}`); // 4 failures, below threshold
    shouldFail = false;
    await client.fetch('RECOVER'); // success resets consecutive-failure count
    shouldFail = true;
    for (let i = 0; i < 4; i++) await client.fetch(`APP2_${i}`);
    expect(client.circuitState()).toBe('CLOSED'); // only 4 consecutive failures since reset
  });
});
