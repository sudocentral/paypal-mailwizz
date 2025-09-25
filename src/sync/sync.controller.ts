import { Controller, Post } from '@nestjs/common';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('donors')
  async syncDonors() {
    return this.syncService.syncAllDonors();
  }
}

