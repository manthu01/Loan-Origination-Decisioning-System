import { Module } from '@nestjs/common';
import { HashChainService } from '../common/hash-chain.service';
import { PrismaService } from '../common/prisma.service';
import { DecisionsController } from './decisions.controller';
import { DecisionsService } from './decisions.service';

@Module({
  controllers: [DecisionsController],
  providers: [DecisionsService, PrismaService, HashChainService],
  exports: [DecisionsService],
})
export class DecisionsModule {}
