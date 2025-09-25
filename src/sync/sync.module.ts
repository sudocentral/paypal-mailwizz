import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { MailWizzService } from '../mailwizz/mailwizz.service';
import { DatabaseModule } from '../database/database.module'; // ✅ bring in PG_CONNECTION

@Module({
  imports: [DatabaseModule],   // ✅ makes PG_CONNECTION available here
  providers: [SyncService, MailWizzService],
  controllers: [SyncController],
})
export class SyncModule {}
