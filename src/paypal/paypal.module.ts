import { Module } from '@nestjs/common';
import { PaypalController } from './paypal.controller';
import { PaypalService } from './paypal.service';
import { DatabaseModule } from '../database/database.module';
import { MailWizzService } from '../mailwizz/mailwizz.service';


@Module({
  imports: [DatabaseModule],
  controllers: [PaypalController],
  providers: [PaypalService, MailWizzService],
})
export class PaypalModule {}

