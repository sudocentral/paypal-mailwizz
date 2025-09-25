import { Controller, Post, Req, Res, HttpStatus } from '@nestjs/common';
import { PaypalService } from './paypal.service';
import { Request, Response } from 'express';

@Controller('webhooks/paypal')
export class PaypalController {
  constructor(private readonly paypalService: PaypalService) {}

  @Post()
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    try {
      console.log('📩 DEBUG: Received PayPal Webhook:', req.body);

      // Pass raw payload to service
      await this.paypalService.processWebhook(req.body);

      return res.status(HttpStatus.OK).send({ status: 'ok' });
    } catch (error) {
      console.error('❌ ERROR: PayPal Webhook processing failed:', error);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send({ error: error.message });
    }
  }
}

