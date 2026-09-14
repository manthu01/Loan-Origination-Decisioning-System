import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PolicyModule } from './policy/policy.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PolicyModule],
})
export class AppModule {}
