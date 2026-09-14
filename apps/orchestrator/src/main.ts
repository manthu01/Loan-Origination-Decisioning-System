import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// DecisionEvent.id is a Prisma BigInt (chosen for an append-only ledger that must never
// wrap around); JSON.stringify doesn't know how to serialize BigInt natively.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // the console is a separate origin (Vercel in prod, a different dev port locally)
  app.enableCors({ origin: process.env.CONSOLE_ORIGIN ?? true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`orchestrator listening on :${port}`);
}
bootstrap();
