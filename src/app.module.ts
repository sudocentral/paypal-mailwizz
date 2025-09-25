import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MailWizzService } from './mailwizz/mailwizz.service';
import { PaypalModule } from './paypal/paypal.module';
import { DatabaseModule } from './database/database.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    PaypalModule,   // ✅ PayPal webhook + service
    DatabaseModule, // ✅ Postgres connection provider
    SyncModule,     // ✅ NEW: Donor ↔ MailWizz sync endpoints
  ],
  controllers: [
    AppController,
    // ❌ MailWizzController removed
  ],
  providers: [
    AppService,
    MailWizzService,
    SyncQueueService,
  ],
})
export class AppModule {}

