import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DecisionsService } from './decisions.service';
import { OverrideDecisionDto } from './dto/override-decision.dto';

@Controller('decisions')
export class DecisionsController {
  constructor(private readonly decisionsService: DecisionsService) {}

  @Get('stats')
  stats(@Query('product') product?: string, @Query('days') days?: string) {
    return this.decisionsService.stats(product, days ? Number(days) : undefined);
  }

  @Post(':id/override')
  override(@Param('id') id: string, @Body() dto: OverrideDecisionDto) {
    return this.decisionsService.override(id, dto);
  }
}
