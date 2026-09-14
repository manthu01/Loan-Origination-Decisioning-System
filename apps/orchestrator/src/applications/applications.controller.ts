import { Body, ConflictException, Controller, Get, Headers, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { IdempotencyService } from '../common/idempotency.service';
import { DecisionsService } from '../decisions/decisions.service';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';

@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly applicationsService: ApplicationsService,
    private readonly idempotency: IdempotencyService,
    private readonly decisionsService: DecisionsService,
  ) {}

  /** The credit-ops queue: applications by status, filterable by outcome, reason code,
   * and score band. */
  @Get()
  queue(
    @Query('status') status?: string,
    @Query('outcome') outcome?: string,
    @Query('reasonCode') reasonCode?: string,
    @Query('product') product?: string,
    @Query('scoreMin') scoreMin?: string,
    @Query('scoreMax') scoreMax?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.decisionsService.queue({
      status,
      outcome,
      reasonCode,
      product,
      scoreMin: scoreMin ? Number(scoreMin) : undefined,
      scoreMax: scoreMax ? Number(scoreMax) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Post()
  async create(@Headers('idempotency-key') idempotencyKey: string | undefined, @Body() dto: CreateApplicationDto) {
    if (!idempotencyKey) {
      return this.applicationsService.submit(dto);
    }

    const cached = await this.idempotency.get(idempotencyKey);
    if (cached) return cached;

    const claimed = await this.idempotency.claim(idempotencyKey);
    if (!claimed) {
      throw new ConflictException('a request with this Idempotency-Key is already being processed');
    }

    try {
      const result = await this.applicationsService.submit(dto);
      await this.idempotency.put(idempotencyKey, result);
      return result;
    } finally {
      await this.idempotency.releaseClaim(idempotencyKey);
    }
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const application = await this.applicationsService.findById(id);
    if (!application) throw new NotFoundException(`application ${id} not found`);
    return application;
  }
}
