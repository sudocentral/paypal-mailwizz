import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { MailWizzService } from '../mailwizz/mailwizz.service';
import { DatabaseModule } from '../database/database.module';
import { SyncQueueService } from './sync-queue.service';

@Module({
  imports: [DatabaseModule],
  providers: [SyncService, SyncQueueService, MailWizzService],
  controllers: [SyncController],
  exports: [SyncQueueService],  // ✅ make queue available to PaypalModule
})
export class SyncModule {}
