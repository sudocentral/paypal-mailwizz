import { Controller, Post, Req, Res, HttpStatus } from '@nestjs/common';
import { PaypalService } from './paypal.service';
import { Request, Response } from 'express';
import * as qs from 'querystring';

@Controller('webhooks/paypal')
export class PaypalController {
  constructor(private readonly paypalService: PaypalService) {}

  @Post()
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    try {
      const contentType = req.headers['content-type'] || '';

      if (contentType.includes('application/json')) {
        // ✅ REST Webhook
        console.log('📩 DEBUG: Received PayPal REST Webhook:', req.body);
        await this.paypalService.processWebhook(req.body);
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        // ✅ IPN
        const raw = req.body instanceof Buffer ? req.body.toString() : req.body;
        const ipn = typeof raw === 'string' ? qs.parse(raw) : raw;
        console.log('📩 DEBUG: Received PayPal IPN:', ipn);

        // 🚀 Pass raw IPN straight to service
        await this.paypalService.processWebhook(ipn);
      } else {
        console.warn('⚠️ Unknown content type from PayPal:', contentType);
        return res
          .status(HttpStatus.BAD_REQUEST)
          .send({ error: 'Unsupported content type' });
      }

      return res.status(HttpStatus.OK).send({ status: 'ok' });
    } catch (error) {
      console.error('❌ ERROR: PayPal Webhook processing failed:', error);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send({ error: error.message });
    }
  }
}
