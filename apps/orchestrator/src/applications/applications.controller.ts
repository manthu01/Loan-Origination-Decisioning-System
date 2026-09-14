import { Body, ConflictException, Controller, Get, Headers, NotFoundException, Param, Post } from '@nestjs/common';
import { IdempotencyService } from '../common/idempotency.service';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';

@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly applicationsService: ApplicationsService,
    private readonly idempotency: IdempotencyService,
  ) {}

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
