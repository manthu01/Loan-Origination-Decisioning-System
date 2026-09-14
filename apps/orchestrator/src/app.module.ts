import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApplicationsModule } from './applications/applications.module';
import { AuditModule } from './audit/audit.module';
import { PolicyModule } from './policy/policy.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PolicyModule, ApplicationsModule, AuditModule],
})
export class AppModule {}
