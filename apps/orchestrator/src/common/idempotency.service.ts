import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

const TTL_SECONDS = Number(process.env.IDEMPOTENCY_KEY_TTL_SECONDS ?? 86_400);
const KEY_PREFIX = 'idempotency:applications:';

/**
 * A mobile client retrying POST /applications on a flaky network must not create a
 * second loan. The first successful response for a given Idempotency-Key is cached for
 * 24h; a replay of the same key returns the original response instead of re-running the
 * pipeline.
 */
@Injectable()
export class IdempotencyService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  async get(key: string): Promise<unknown | null> {
    const raw = await this.redis.get(KEY_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  }

  async put(key: string, response: unknown): Promise<void> {
    await this.redis.set(KEY_PREFIX + key, JSON.stringify(response), 'EX', TTL_SECONDS);
  }

  /** Guards against two concurrent requests with the same key both racing through the
   * pipeline before either has cached a response -- NX makes the claim atomic. */
  async claim(key: string): Promise<boolean> {
    const result = await this.redis.set(KEY_PREFIX + key + ':lock', '1', 'EX', 60, 'NX');
    return result === 'OK';
  }

  async releaseClaim(key: string): Promise<void> {
    await this.redis.del(KEY_PREFIX + key + ':lock');
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
