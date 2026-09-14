import { Controller, Get, Param, Post } from '@nestjs/common';
import { HashChainService } from '../common/hash-chain.service';
import { ReplayService } from './replay.service';

@Controller()
export class AuditController {
  constructor(
    private readonly hashChain: HashChainService,
    private readonly replayService: ReplayService,
  ) {}

  @Get('audit/verify')
  verify() {
    return this.hashChain.verifyChain();
  }

  @Post('decisions/:id/replay')
  replay(@Param('id') id: string) {
    return this.replayService.replay(id);
  }
}
