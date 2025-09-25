import { Module } from '@nestjs/common';
import { PaypalController } from './paypal.controller';
import { PaypalService } from './paypal.service';
import { MailWizzService } from '../mailwizz/mailwizz.service';
import { SyncQueueService } from '../queue/sync-queue.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [PaypalController],
  providers: [
    PaypalService,
    MailWizzService,
    SyncQueueService, // ✅ now available for injection
  ],
})
export class PaypalModule {}